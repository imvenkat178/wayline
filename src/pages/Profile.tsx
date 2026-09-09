import { useEffect, useState } from "react";
import { useApp } from "../context";
import { api, readable, download } from "../api";
import type { SavedItem, User, Session } from "../types";
import { clearOffline } from "../offline";
import { resetPasswordToken } from "../routes";
import {
  Button,
  Icon,
  Badge,
  Field,
  Notice,
  Toggle,
  Empty,
  Modal,
  Section,
  useAsync,
} from "../components/ui";
// Converts the URL-safe base64 VAPID public key (server/push.mjs) into the raw byte array
// PushManager.subscribe's applicationServerKey requires. Standard, unavoidable boilerplate for
// this browser API -- there is no built-in decoder for this specific base64 variant.
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export default function Profile() {
  const { boot, setBoot, switchIdentity, notify, navigate, refresh } = useApp();
  const [tab, setTab] = useState("preferences"),
    [p, setP] = useState(boot.user.preferences),
    [name, setName] = useState(boot.user.name),
    [modal, setModal] = useState<string | null>(null),
    [items, setItems] = useState<SavedItem[]>([]),
    [shares, setShares] = useState<{ id: string; journeyId: string; expiresAt: number }[]>([]),
    [audit, setAudit] = useState<{ action: string; at: number }[]>([]),
    // null while the initial check (does this browser already have a live subscription?) is
    // still in flight, so the toggle doesn't briefly flash "off" before settling.
    [pushSubscribed, setPushSubscribed] = useState<boolean | null>(null),
    [sessions, setSessions] = useState<Session[]>([]),
    // Set once the login form gets back { mfaRequired: true, pendingToken } instead of a
    // completed session -- switches the same "login" modal to a second, code-entry step
    // without ever handing out a real session until that code verifies (server/router.mjs's
    // /api/auth/mfa-verify). Cleared on modal close so a cancelled attempt doesn't linger.
    [loginMfa, setLoginMfa] = useState<{ pendingToken: string } | null>(null),
    // Freshly issued TOTP secret + QR code from POST /mfa/setup, shown once while the user scans
    // it and enters a confirming code. Never persisted beyond this component's state.
    [mfaSetup, setMfaSetup] = useState<{ secret: string; qrCode: string } | null>(null),
    // The one-time recovery codes returned by a successful /mfa/confirm -- shown exactly once,
    // matching how the server only ever returns them at that moment (only their hashes are kept).
    [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null),
    // Pre-fills the reset-password form when the user arrived via a real reset link
    // (#reset-password?token=...); empty when they pasted a token in manually instead.
    [resetToken, setResetToken] = useState("");
  const { busy, error, run } = useAsync();
  const update = (key: string, value: unknown) => setP((s) => ({ ...s, [key]: value }));
  useEffect(() => {
    const token = resetPasswordToken(location.hash.slice(1));
    if (token) {
      setResetToken(token);
      setModal("reset-password");
    }
  }, []);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushSubscribed(false);
      return;
    }
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setPushSubscribed(Boolean(subscription)))
      .catch(() => setPushSubscribed(false));
  }, []);
  // Turns real Web Push (feature 89, server/push.mjs) on or off for this browser. Distinct from
  // the "Enable browser notifications" button below, which only grants permission to display a
  // notification while the tab is open -- this registers a subscription with the push service
  // so alerts can arrive even when Wayline is closed, and tells the server about it.
  const togglePush = (subscribe: boolean) =>
    run(async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        throw new Error("Push notifications are unavailable in this browser.");
      const registration = await navigator.serviceWorker.ready;
      if (subscribe) {
        if (!boot.pushPublicKey) throw new Error("Push is not configured on this server yet.");
        if ("Notification" in window && Notification.permission === "default")
          await Notification.requestPermission();
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(boot.pushPublicKey),
          }));
        const json = subscription.toJSON();
        await api("/records/push-subscription", "POST", {
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent,
        });
        setPushSubscribed(true);
        notify("Push notifications are on for this device.");
      } else {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          // Best-effort: remove the matching server-side record by endpoint before tearing down
          // the browser subscription, so a stray record isn't left to be delivered to nowhere
          // until its next delivery attempt discovers it's gone (see push.mjs's deliverPush).
          try {
            const existingRecords = await api<{ id: string; endpoint: string }[]>(
              "/records/push-subscription",
            );
            const match = existingRecords.find((r) => r.endpoint === subscription.endpoint);
            if (match) await api(`/records/push-subscription/${match.id}`, "DELETE");
          } catch {
            // Not fatal -- the browser-side unsubscribe below still stops delivery to this
            // device, and a stale server record self-corrects the next time it's used.
          }
          await subscription.unsubscribe();
        }
        setPushSubscribed(false);
        notify("Push notifications are off for this device.");
      }
    });
  const load = async () => {
    if (["traveler", "contact", "favorite"].includes(tab)) setItems(await api(`/records/${tab}`));
    if (tab === "privacy") {
      setShares(await api("/shares"));
      setAudit(await api("/audit"));
    }
    if (tab === "security") setSessions(await api("/sessions"));
  };
  useEffect(() => {
    void run(load);
  }, [tab]);
  const save = () =>
    run(async () => {
      const user = await api<User>("/profile", "PUT", { name, preferences: p });
      setBoot((b) => (b ? { ...b, user } : b));
      notify("Profile and preferences saved.");
    });
  const logout = () =>
    run(async () => {
      await api("/auth/logout", "POST");
      await clearOffline();
      location.href = "/";
    });
  const deleteModal = modal === "history" || modal === "account";
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TRAVEL YOUR WAY</span>
          <h1>Make Wayline yours</h1>
          <p>Your preferences stay with your account.</p>
        </div>
        <div className="button-row">
          {boot.user.registered ? (
            <Button onClick={() => void logout()}>Sign out</Button>
          ) : (
            <>
              <Button onClick={() => setModal("login")}>Sign in</Button>
              <Button kind="primary" onClick={() => setModal("register")}>
                Create account
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="profile-summary">
        <div className="large-avatar">
          {boot.user.name
            .split(" ")
            .map((x) => x[0])
            .slice(0, 2)
            .join("")}
        </div>
        <div>
          <h2>{boot.user.name}</h2>
          <p>
            {boot.user.email ?? "Guest session · create an account to return from another device"}
          </p>
        </div>
        <Badge tone="mint">
          <Icon name="lock" size={14} /> Private by default
        </Badge>
      </div>
      <div className="view-tabs scroll-tabs">
        {[
          ["preferences", "Preferences"],
          ["accessibility", "Accessibility"],
          ["traveler", "Travelers"],
          ["contact", "Contacts"],
          ["favorite", "Shortcuts"],
          ["notifications", "Notifications"],
          ["security", "Security"],
          ["privacy", "Privacy"],
          ["payments", "Payments"],
        ].map(([k, v]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {tab === "preferences" && (
        <Section title="Your default trip preferences">
          <div className="form-grid">
            <Field label="Display name">
              <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Routing priority">
              <select value={p.priority} onChange={(e) => update("priority", e.target.value)}>
                {["balanced", "price", "fastest", "reliable", "walking", "transfers", "carbon"].map(
                  (x) => (
                    <option key={x}>{x}</option>
                  ),
                )}
              </select>
            </Field>
            <Field label="Default total budget ($)">
              <input
                type="number"
                min="0"
                max="10000"
                value={p.budgetCents / 100}
                onChange={(e) => update("budgetCents", Math.round(+e.target.value * 100))}
              />
            </Field>
            <Field label="Maximum walking (minutes)">
              <input
                type="number"
                min="0"
                max="120"
                value={p.maxWalkMinutes}
                onChange={(e) => update("maxWalkMinutes", +e.target.value)}
              />
            </Field>
            <Field label="Walking speed (meters / second)">
              <input
                type="number"
                min="0.3"
                max="2.5"
                step="0.1"
                value={p.walkSpeed}
                onChange={(e) => update("walkSpeed", +e.target.value)}
              />
            </Field>
            <Field label="Extra connection buffer (minutes)">
              <input
                type="number"
                min="0"
                max="120"
                value={p.minConnectionMinutes}
                onChange={(e) => update("minConnectionMinutes", +e.target.value)}
              />
            </Field>
            <Field label="Risk tolerance">
              <select
                value={p.riskTolerance}
                onChange={(e) => update("riskTolerance", e.target.value)}
              >
                {["conservative", "balanced", "aggressive"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Language for navigation, phrasebook & Planner">
              <select value={p.language} onChange={(e) => update("language", e.target.value)}>
                <option value="en">English</option>
                <option value="es">Español (AI-translated, unreviewed)</option>
                <option value="hi">हिन्दी (navigation & phrasebook only)</option>
              </select>
            </Field>
          </div>
          <div className="toggle-grid">
            {[
              ["lessCrowded", "Prefer less crowded trips"],
              ["preferTrain", "Prefer trains"],
              ["avoidBus", "Avoid bus journeys"],
              ["nightWalking", "Reduce outdoor walking at night"],
              ["coveredTransfers", "Prefer shorter outdoor transfers"],
              ["visitor", "Visitor phrasebook"],
            ].map(([key, label]) => (
              <Toggle
                key={key}
                label={label}
                checked={Boolean(p[key as keyof typeof p])}
                onChange={(v) => update(key, v)}
              />
            ))}
          </div>
          <Button kind="primary" onClick={() => void save()} disabled={busy}>
            Save preferences
          </Button>
        </Section>
      )}
      {tab === "accessibility" && (
        <Section title="Accessibility and travel assistance">
          <Notice>
            Routing uses step-free and walking preferences where supported. Assistance requests,
            service animals and announcement preferences must still be arranged with the operator.
          </Notice>
          {[
            ["wheelchair", "Wheelchair access"],
            ["stepFree", "Step-free paths"],
            ["avoidStairs", "Avoid stairs"],
            ["elevatorRequired", "Elevator required"],
            ["lowFloor", "Low-floor vehicle preferred"],
            ["transferAssistance", "Transfer assistance requested"],
            ["serviceAnimal", "Traveling with a service animal"],
            ["visualAnnouncements", "Visual announcements preferred"],
            ["audioNavigation", "Audio guidance preferred"],
          ].map(([key, label]) => (
            <Toggle
              key={key}
              label={label}
              description={
                [
                  "lowFloor",
                  "transferAssistance",
                  "serviceAnimal",
                  "visualAnnouncements",
                  "audioNavigation",
                ].includes(key)
                  ? "Saved for trip preparation; operator confirmation required."
                  : undefined
              }
              checked={Boolean(p[key as keyof typeof p])}
              onChange={(v) => update(key, v)}
            />
          ))}
          <Button kind="primary" disabled={busy} onClick={() => void save()}>
            Save accessibility preferences
          </Button>
        </Section>
      )}
      {["traveler", "contact", "favorite"].includes(tab) && (
        <Section
          title={
            tab === "traveler"
              ? "Your travel companions"
              : tab === "contact"
                ? "Your trusted contacts"
                : "Your saved shortcuts"
          }
          action={
            tab !== "favorite" ? (
              <Button icon="plus" onClick={() => setModal(tab)}>
                Add {tab}
              </Button>
            ) : (
              <Button onClick={() => navigate("plan")}>Add from planner</Button>
            )
          }
        >
          {tab === "contact" && (
            <Notice>
              Contacts are saved privately. Automatic SMS and email are not connected; reminders
              prompt you to contact someone yourself.
            </Notice>
          )}
          {items.map((item) => (
            <div className="saved-item" key={item.id}>
              <div>
                <b>{item.name}</b>
                <p>
                  {item.contact ??
                    (item.fareClass
                      ? `${readable(item.fareClass)} · eligibility not verified`
                      : `${item.from} → ${item.to}`)}
                </p>
              </div>
              <Button
                icon="trash"
                title={`Remove ${item.name}`}
                kind="icon-only"
                onClick={() =>
                  void run(async () => {
                    await api(`/records/${tab}/${item.id}`, "DELETE");
                    await load();
                  })
                }
              />
            </div>
          ))}
          {!items.length && (
            <Empty
              icon={tab === "contact" ? "heart" : "user"}
              title={`No ${tab === "favorite" ? "shortcuts" : tab + "s"} yet`}
            >
              Save only the details you want available for your trips.
            </Empty>
          )}
        </Section>
      )}
      {tab === "notifications" && (
        <Section title="A useful nudge, at the right time">
          <Toggle
            label="Critical connection and check-in alerts"
            checked={p.notifyCritical}
            onChange={(v) => update("notifyCritical", v)}
          />
          <Toggle
            label="Routine travel updates"
            checked={p.notifyInfo}
            onChange={(v) => update("notifyInfo", v)}
          />
          <div className="form-grid">
            <Field label="Quiet hours start · device time">
              <input
                type="time"
                value={p.quietStart}
                onChange={(e) => update("quietStart", e.target.value)}
              />
            </Field>
            <Field label="Quiet hours end · device time">
              <input
                type="time"
                value={p.quietEnd}
                onChange={(e) => update("quietEnd", e.target.value)}
              />
            </Field>
            <Field label="Arrival check-in delay (minutes)">
              <input
                type="number"
                min="5"
                max="1440"
                value={p.emergencyMinutes}
                onChange={(e) => update("emergencyMinutes", +e.target.value)}
              />
            </Field>
            <Field label="Preferred recovery spending limit ($)">
              <input
                type="number"
                min="0"
                max="1000"
                value={p.recoveryLimitCents / 100}
                onChange={(e) => update("recoveryLimitCents", Math.round(+e.target.value * 100))}
              />
            </Field>
          </div>
          <Notice>
            Recovery limits are preferences only. Wayline cannot spend money or exchange tickets.
            Quiet hours apply to browser notifications; critical alerts can bypass quiet hours if
            enabled.
          </Notice>
          <div className="button-row">
            <Button
              icon="bell"
              onClick={() =>
                void run(async () => {
                  if (!("Notification" in window))
                    throw new Error("Notifications are unavailable in this browser.");
                  const result = await Notification.requestPermission();
                  notify(
                    result === "granted"
                      ? "Browser notifications enabled while Wayline is open."
                      : "Notification permission was not granted.",
                  );
                })
              }
            >
              Enable browser notifications
            </Button>
            <Button kind="primary" disabled={busy} onClick={() => void save()}>
              Save notification preferences
            </Button>
          </div>
        </Section>
      )}
      {tab === "notifications" && (
        <Section title="Real push notifications">
          <Toggle
            label="Send push notifications to this device"
            description="Delivers alerts even when Wayline isn't open, using your browser's push service."
            checked={pushSubscribed === true}
            onChange={(v) => void togglePush(v)}
          />
          <Toggle
            label="Show trip details in push notifications"
            description="Off by default: a push notification can appear on a locked screen, so it shows a generic phrase unless you turn this on."
            checked={p.pushDetails}
            onChange={(v) => update("pushDetails", v)}
          />
          {!boot.pushPublicKey && (
            <Notice tone="amber">Push is not configured on this server yet.</Notice>
          )}
          <div className="button-row">
            <Button kind="primary" disabled={busy} onClick={() => void save()}>
              Save push preference
            </Button>
          </div>
        </Section>
      )}
      {tab === "security" && (
        <div className="stack">
          <Section title="Two-factor authentication">
            {boot.mfaEnabled ? (
              <>
                <Notice tone="mint">
                  Two-factor authentication is on. Signing in also requires a code from your
                  authenticator app (or a recovery code).
                </Notice>
                <div className="button-row">
                  <Button kind="danger" onClick={() => setModal("mfa-disable")}>
                    Turn off two-factor authentication
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p>
                  Add a second step to sign-in using any TOTP authenticator app (Google
                  Authenticator, Authy, 1Password, Apple's built-in one, and similar).
                </p>
                <div className="button-row">
                  <Button
                    kind="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const setup = await api<{ secret: string; qrCode: string }>(
                          "/mfa/setup",
                          "POST",
                        );
                        setMfaSetup(setup);
                        setModal("mfa-setup");
                      })
                    }
                  >
                    Set up two-factor authentication
                  </Button>
                </div>
              </>
            )}
          </Section>
          <Section title="Where you're signed in">
            <div className="button-row">
              <Button
                disabled={busy || sessions.length < 2}
                onClick={() =>
                  void run(async () => {
                    await api("/sessions/revoke-others", "POST");
                    await load();
                    notify("Signed out everywhere else.");
                  })
                }
              >
                Sign out other devices
              </Button>
            </div>
            {sessions.map((s) => (
              <div className="saved-item" key={s.id}>
                <div>
                  <b>{s.userAgent || "Unknown device"}</b>
                  <p>Last active {new Date(s.lastSeenAt).toLocaleString()}</p>
                </div>
                {s.current ? (
                  <Badge tone="mint">This device</Badge>
                ) : (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/sessions/${encodeURIComponent(s.id)}`, "DELETE");
                        await load();
                        notify("Signed out that device.");
                      })
                    }
                  >
                    Sign out
                  </Button>
                )}
              </div>
            ))}
            {!sessions.length && <Empty icon="lock" title="Loading your sessions..." />}
          </Section>
        </div>
      )}
      {tab === "privacy" && (
        <div className="stack">
          <Section title="You control your travel history">
            <Toggle
              label="Save journey history"
              checked={p.saveHistory}
              onChange={(v) => update("saveHistory", v)}
            />
            <Field label="Retention for new journeys">
              <select
                value={p.historyDays}
                onChange={(e) => update("historyDays", +e.target.value)}
              >
                <option value="0">Remove after trip</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
            </Field>
            <div className="button-row wrap">
              <Button kind="primary" onClick={() => void save()}>
                Save retention
              </Button>
              <Button
                icon="download"
                onClick={() =>
                  void run(async () =>
                    download("wayline-personal-data.json", await api("/privacy/export")),
                  )
                }
              >
                Export my data
              </Button>
              <Button
                icon="lock"
                onClick={() =>
                  void run(async () => {
                    await clearOffline();
                    notify("All offline packs on this browser were removed.");
                  })
                }
              >
                Remove offline packs
              </Button>
            </div>
          </Section>
          <Section title="Active sharing links">
            {shares.map((s) => (
              <div className="saved-item" key={s.id}>
                <div>
                  <b>Journey share</b>
                  <p>Expires {new Date(s.expiresAt).toLocaleString()}</p>
                </div>
                <Button
                  onClick={() =>
                    void run(async () => {
                      await api(`/shares/${s.id}`, "DELETE");
                      await load();
                      notify("Sharing link revoked.");
                    })
                  }
                >
                  Revoke
                </Button>
              </div>
            ))}
            {!shares.length && <p>No active links. Your journeys are private.</p>}
          </Section>
          <Section title="Recent account activity">
            <div className="audit-list">
              {audit.slice(0, 10).map((a, i) => (
                <div key={i}>
                  <span>{readable(a.action)}</span>
                  <small>{new Date(a.at).toLocaleString()}</small>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Delete saved data">
            <p>
              Deletion removes app records and sharing links. It does not cancel carrier bookings.
            </p>
            <div className="button-row">
              <Button kind="danger" onClick={() => setModal("history")}>
                Delete travel history
              </Button>
              <Button kind="danger" onClick={() => setModal("account")}>
                Delete account
              </Button>
            </div>
          </Section>
        </div>
      )}
      {tab === "payments" && (
        <Section title="Book securely with your operator">
          <div className="payment-symbols">
            <Icon name="lock" size={42} />
          </div>
          <h3>Your payment information stays with the carrier</h3>
          <p>
            Unified checkout, payment methods, seat inventory and automatic rebooking require
            authorized carrier and payment integrations. No card information is collected here.
          </p>
          <div className="provider-grid">
            {Object.entries(boot.operatorLinks)
              .slice(0, 6)
              .map(([name, url]) => (
                <a className="provider-link" href={url} key={name} target="_blank" rel="noreferrer">
                  {name}
                  <Icon name="external" size={16} />
                </a>
              ))}
          </div>
        </Section>
      )}
      {["register", "login"].includes(modal ?? "") && (
        <Modal
          title={
            loginMfa
              ? "Enter your two-factor code"
              : modal === "register"
                ? "Create your Wayline account"
                : "Welcome back"
          }
          onClose={() => {
            setModal(null);
            setLoginMfa(null);
          }}
        >
          {loginMfa ? (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                const code = String(new FormData(e.currentTarget).get("code") ?? "");
                void run(async () => {
                  const out = await api<{ user: User; csrf: string }>("/auth/mfa-verify", "POST", {
                    pendingToken: loginMfa.pendingToken,
                    code,
                  });
                  await clearOffline();
                  switchIdentity(out);
                  setP(out.user.preferences);
                  setName(out.user.name);
                  await refresh();
                  setModal(null);
                  setLoginMfa(null);
                  notify("Signed in.");
                });
              }}
            >
              <Field
                label="Authenticator code or recovery code"
                hint="From your authenticator app, or one of the recovery codes you saved when you turned this on."
              >
                <input name="code" required autoComplete="one-time-code" autoFocus />
              </Field>
              {error && <Notice tone="error">{error}</Notice>}
              <Button type="submit" kind="primary" disabled={busy}>
                Verify and sign in
              </Button>
            </form>
          ) : (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                const d = Object.fromEntries(new FormData(e.currentTarget));
                void run(async () => {
                  const out = await api<
                    { user: User; csrf: string } | { mfaRequired: true; pendingToken: string }
                  >(`/auth/${modal}`, "POST", d);
                  if ("mfaRequired" in out) {
                    setLoginMfa({ pendingToken: out.pendingToken });
                    return;
                  }
                  // Clear any offline packs saved under the previous identity (guest or another
                  // account) before applying the new one -- they must not be reachable or mixed
                  // in once a different account is signed in on this device.
                  await clearOffline();
                  switchIdentity(out);
                  setP(out.user.preferences);
                  setName(out.user.name);
                  await refresh();
                  setModal(null);
                  notify("Signed in.");
                });
              }}
            >
              {modal === "register" && (
                <Field label="Your name">
                  <input
                    required
                    name="name"
                    maxLength={100}
                    autoComplete="name"
                    defaultValue={boot.user.name === "Traveler" ? "" : boot.user.name}
                  />
                </Field>
              )}
              <Field label="Email">
                <input name="email" required type="email" maxLength={254} autoComplete="email" />
              </Field>
              <Field
                label="Password"
                hint={modal === "register" ? "At least 12 characters." : undefined}
              >
                <input
                  name="password"
                  type="password"
                  required
                  minLength={modal === "register" ? 12 : 1}
                  maxLength={128}
                  autoComplete={modal === "register" ? "new-password" : "current-password"}
                />
              </Field>
              {error && <Notice tone="error">{error}</Notice>}
              <Button type="submit" kind="primary" disabled={busy}>
                {modal === "register" ? "Create account" : "Sign in"}
              </Button>
              {modal === "login" && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => setModal("forgot-password")}
                >
                  Forgot your password?
                </button>
              )}
            </form>
          )}
        </Modal>
      )}
      {modal === "forgot-password" && (
        <Modal title="Reset your password" onClose={() => setModal(null)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const email = String(new FormData(e.currentTarget).get("email") ?? "");
              void run(async () => {
                await api("/auth/recovery/request", "POST", { email });
                setModal(null);
                notify("If that email has an account, a reset link has been sent to it.");
              });
            }}
          >
            <Field label="Email">
              <input name="email" required type="email" maxLength={254} autoComplete="email" />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" kind="primary" disabled={busy}>
              Send reset link
            </Button>
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setResetToken("");
                setModal("reset-password");
              }}
            >
              Already have a reset code?
            </button>
          </form>
        </Modal>
      )}
      {modal === "reset-password" && (
        <Modal title="Choose a new password" onClose={() => setModal(null)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              void run(async () => {
                await api("/auth/recovery/reset", "POST", d);
                setModal(null);
                notify("Password changed. Sign in with your new password.");
              });
            }}
          >
            <Field label="Reset code" hint="From the link or message you were sent.">
              <input
                name="token"
                required
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="New password" hint="At least 12 characters.">
              <input
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" kind="primary" disabled={busy}>
              Change password
            </Button>
          </form>
        </Modal>
      )}
      {modal === "mfa-setup" && mfaSetup && (
        <Modal title="Set up two-factor authentication" onClose={() => setModal(null)}>
          <p>Scan this code with your authenticator app, or enter the key manually.</p>
          <img
            className="qr-code"
            src={mfaSetup.qrCode}
            alt="Authenticator QR code"
            width={200}
            height={200}
          />
          <p className="mono-secret">{mfaSetup.secret}</p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const code = String(new FormData(e.currentTarget).get("code") ?? "");
              void run(async () => {
                const codes = await api<{ recoveryCodes: string[] }>("/mfa/confirm", "POST", {
                  code,
                });
                setMfaSetup(null);
                setRecoveryCodes(codes.recoveryCodes);
                setModal("mfa-recovery-codes");
                setBoot((b) => (b ? { ...b, mfaEnabled: true } : b));
              });
            }}
          >
            <Field label="Code from your authenticator app">
              <input name="code" required autoComplete="one-time-code" autoFocus />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" kind="primary" disabled={busy}>
              Confirm and turn on
            </Button>
          </form>
        </Modal>
      )}
      {modal === "mfa-recovery-codes" && recoveryCodes && (
        <Modal title="Save your recovery codes" onClose={() => setModal(null)}>
          <Notice tone="amber">
            Each code works once, if you ever lose access to your authenticator app. They're shown
            only this one time -- save them somewhere safe now.
          </Notice>
          <div className="recovery-codes">
            {recoveryCodes.map((code) => (
              <code key={code}>{code}</code>
            ))}
          </div>
          <div className="button-row">
            <Button onClick={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))}>
              Copy codes
            </Button>
            <Button
              kind="primary"
              onClick={() => {
                setRecoveryCodes(null);
                setModal(null);
                notify("Two-factor authentication is on.");
              }}
            >
              I've saved these
            </Button>
          </div>
        </Modal>
      )}
      {modal === "mfa-disable" && (
        <Modal title="Turn off two-factor authentication" onClose={() => setModal(null)}>
          <p>Enter a current code from your authenticator app, or a recovery code, to confirm.</p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const code = String(new FormData(e.currentTarget).get("code") ?? "");
              void run(async () => {
                await api("/mfa/disable", "POST", { code });
                setModal(null);
                setBoot((b) => (b ? { ...b, mfaEnabled: false } : b));
                notify("Two-factor authentication is off.");
              });
            }}
          >
            <Field label="Code">
              <input name="code" required autoComplete="one-time-code" autoFocus />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" kind="danger" disabled={busy}>
              Turn off
            </Button>
          </form>
        </Modal>
      )}
      {["traveler", "contact"].includes(modal ?? "") && (
        <Modal title={`Add a ${modal}`} onClose={() => setModal(null)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget),
                d = Object.fromEntries(f);
              void run(async () => {
                await api(`/records/${modal}`, "POST", {
                  ...d,
                  consent: f.has("consent"),
                  assistance: f.has("assistance"),
                });
                await load();
                setModal(null);
                notify("Saved.");
              });
            }}
          >
            <Field label="Name">
              <input required name="name" maxLength={100} />
            </Field>
            {modal === "traveler" ? (
              <>
                <Field label="Fare class">
                  <select name="fareClass">
                    {["adult", "student", "senior", "military", "accessibility", "child"].map(
                      (x) => (
                        <option key={x}>{x}</option>
                      ),
                    )}
                  </select>
                </Field>
                <label className="check-row">
                  <input type="checkbox" name="assistance" />
                  Assistance requested
                </label>
                <Notice>Discount eligibility must be verified with the operator.</Notice>
              </>
            ) : (
              <>
                <Field label="Contact information">
                  <input
                    required
                    name="contact"
                    maxLength={200}
                    placeholder="Phone number or email"
                  />
                </Field>
                <label className="check-row">
                  <input type="checkbox" name="consent" />
                  This person agrees to be my trip contact.
                </label>
              </>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" kind="primary" disabled={busy}>
              Save {modal}
            </Button>
          </form>
        </Modal>
      )}
      {deleteModal && (
        <Modal
          title={
            modal === "account" ? "Permanently delete your account?" : "Delete travel history?"
          }
          onClose={() => setModal(null)}
        >
          <p>This cannot be undone. Type DELETE to confirm.</p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const confirm = new FormData(e.currentTarget).get("confirm");
              void run(async () => {
                await api(`/privacy/${modal}`, "DELETE", { confirm });
                await clearOffline();
                if (modal === "account") location.href = "/";
                else {
                  setModal(null);
                  await refresh();
                  await load();
                  notify("Travel history removed.");
                }
              });
            }}
          >
            <Field label="Confirmation">
              <input required name="confirm" pattern="DELETE" autoComplete="off" />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" kind="danger" disabled={busy}>
              Permanently delete
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
