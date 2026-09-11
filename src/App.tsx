import { useState, useEffect, lazy, Suspense, useCallback, useRef } from "react";
import type {
  Bootstrap,
  Journey,
  Page,
  SearchInput,
  SearchResult,
  ParsedRequest,
  Alert,
} from "./types";
import { AppContext, defaultPreferences } from "./context";
import { nav, resolveHash } from "./routes";
import { isNotificationAllowed, notificationContent } from "./notifications";
import { api, setCsrf, time, readable } from "./api";
import { Icon, Button, Badge, Notice, Empty, Section, ThemeToggle } from "./components/ui";
import { useT } from "./useT";
import { t as translate, type Locale } from "./i18n";
const AssistantPage = lazy(() => import("./pages/Assistant"));
import { lockOffline, refreshUnlockedOffline } from "./offline";
import type { Ticket } from "./types";
import Planner from "./pages/Planner";
import Offline from "./pages/Offline";
import SectionErrorBoundary from "./components/SectionErrorBoundary";
const JourneyPage = lazy(() => import("./pages/Journey"));
const Wallet = lazy(() => import("./pages/Wallet"));
const Trips = lazy(() => import("./pages/Trips"));
const Commute = lazy(() => import("./pages/Commute"));
const Inbox = lazy(() => import("./pages/Inbox"));
const Profile = lazy(() => import("./pages/Profile"));
const Lab = lazy(() => import("./pages/Lab"));
// The nav array's order must match how routes.ts/the sidebar render it below -- this used to
// be a raw positional array of translated strings per language; it is now built from the same
// keyed i18n.ts catalog every other page pulls from, so navigation, the phrasebook and full-page
// copy all come from one resource system instead of three separate ad hoc ones.
const NAV_KEYS: Record<string, string> = {
  plan: "nav.plan",
  trips: "nav.trips",
  assistant: "nav.assistant",
  journey: "nav.guardian",
  wallet: "nav.tickets",
  inbox: "nav.inbox",
  commute: "nav.commute",
  profile: "nav.profile",
  lab: "nav.lab",
};
function navLabels(locale: Locale) {
  return nav.map(([page]) => translate(locale, NAV_KEYS[page]));
}

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null),
    [page, setPage] = useState<Page>("plan"),
    [journeys, setJourneys] = useState<Journey[]>([]),
    [active, setActive] = useState<Journey | null>(null),
    [result, setResult] = useState<SearchResult | null>(null),
    [searchInput, setSearchInput] = useState<SearchInput>({
      from: "la",
      to: "sj",
      departure: new Date(Date.now() + 24 * 3600000).toISOString(),
      travelers: 1,
      bags: 0,
      mode: "sample",
      preferences: defaultPreferences,
    });
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [prompt, setPrompt] = useState(""),
    [menu, setMenu] = useState(false),
    [offlineView, setOfflineView] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const [shared, setShared] = useState<SharedJourney | null>(null),
    [shareError, setShareError] = useState("");
  const shareToken = new URLSearchParams(location.search).get("share");
  const notificationSeen = useRef(new Set<string>());
  const initial = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every identity change (login, register, or switching from guest to an account).
  // Any in-flight request captures this value before it awaits and discards its result if the
  // identity has since changed, so a slow response for the PREVIOUS user can never land on top
  // of the new user's freshly loaded state.
  const sessionEpoch = useRef(0);
  const notify = useCallback((s: string) => {
    setToast(s);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5500);
  }, []);
  const navigate = useCallback((p: Page) => {
    setOfflineView(false);
    setPage(p);
    setMenu(false);
    history.pushState({}, "", `#${p}`);
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() => document.getElementById("main-content")?.focus());
  }, []);
  // The one place offline view is entered, so it always leaves a history entry behind it --
  // otherwise Back after opening it had nowhere real to go, and the URL never reflected being
  // there (a direct link/refresh to #offline worked, entering it from inside the app did not).
  const openOffline = useCallback(() => {
    setOfflineView(true);
    setMenu(false);
    history.pushState({}, "", "#offline");
  }, []);
  const offlineUserId = boot?.user.id;
  useEffect(() => {
    if (!offlineUserId) return;
    const timer = setInterval(() => {
      if (!navigator.onLine) return;
      void refreshUnlockedOffline(async (id) => {
        const [journey, tickets] = await Promise.all([
          api<Journey>("/journeys/" + id),
          api<Ticket[]>("/records/ticket"),
        ]);
        return { journey, tickets: tickets.filter((t) => t.journeyId === id) };
      });
    }, 60000);
    const lock = () => lockOffline();
    window.addEventListener("pagehide", lock);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", lock);
      lockOffline();
    };
  }, [offlineUserId]);
  const refresh = useCallback(async () => {
    const epoch = sessionEpoch.current;
    const data = await api<Journey[]>("/journeys");
    if (sessionEpoch.current !== epoch) return; // identity changed while this was in flight
    setJourneys(data);
    setActive((prior) =>
      prior?.version ? (data.find((j) => j.id === prior.id) ?? data[0] ?? null) : prior,
    );
  }, []);
  // Applies a login/register response and clears every piece of state that belongs to whichever
  // account was previously active: the last search result, the currently viewed journey (it may
  // be a transient, never-saved sample preview with no `version`, which refresh()'s own merge
  // logic would otherwise leave in place), the saved-journeys list itself, search preferences
  // (reset to the new user's saved preferences so a fresh search never silently applies someone
  // else's budget/accessibility requirements), the notification de-dup set, any toast still on
  // screen, and the assistant panel (it may still be open and rendered with the previous user's
  // conversation on screen). Also bumps sessionEpoch so any request already in flight for the
  // previous identity is discarded rather than applied (see refresh() and the Guardian poll
  // effect below, which both check it).
  //
  // R10: the login/register/mfa-verify response this receives only ever carries {user, csrf} --
  // not a full Bootstrap -- so before this fix, every OTHER bootstrap-derived field (mfaEnabled
  // in particular, which Profile.tsx's MFA toggle reads directly off `boot`) kept showing
  // whichever account was active before the switch until a full page reload happened to refetch
  // it. This now re-fetches /bootstrap immediately under the new session (already the active one
  // by this point -- the login/register/mfa-verify response already applied its Set-Cookie) so
  // every field reflects the new identity, not just `user`.
  const switchIdentity = useCallback((next: { user: Bootstrap["user"]; csrf: string }) => {
    lockOffline();
    sessionEpoch.current += 1;
    const epoch = sessionEpoch.current;
    setCsrf(next.csrf);
    setJourneys([]);
    setResult(null);
    setActive(null);
    setPrompt("");
    notificationSeen.current.clear();
    setError("");
    setToast("");
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setSearchInput((s) => ({ ...s, preferences: next.user.preferences }));
    // Optimistic partial update so the UI reflects the new name/preferences immediately, in case
    // the full re-fetch below is slow or fails -- refined into the authoritative full Bootstrap
    // as soon as that resolves.
    setBoot((prev) => (prev ? { ...prev, user: next.user } : prev));
    void api<Bootstrap>("/bootstrap")
      .then((fresh) => {
        if (sessionEpoch.current !== epoch) return; // identity changed again while this was in flight
        fresh.user.preferences = { ...defaultPreferences, ...fresh.user.preferences };
        setBoot(fresh);
        setSearchInput((s) => ({ ...s, preferences: fresh.user.preferences }));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (initial.current) return;
    initial.current = true;
    if (resolveHash(location.hash.slice(1)).offline) {
      setOfflineView(true);
      return;
    }
    if (shareToken) {
      void api<SharedJourney>(`/shared/${encodeURIComponent(shareToken)}`)
        .then(setShared)
        .catch((e) => setShareError(e.message));
      return;
    }
    void (async () => {
      try {
        const data = await api<Bootstrap>("/bootstrap");
        data.user.preferences = { ...defaultPreferences, ...data.user.preferences };
        setBoot(data);
        setCsrf(data.csrf);
        setSearchInput((s) => ({
          ...s,
          ...(data.pilot
            ? {
                from: "place-sstat",
                to: "place-harsq",
                mode: "provider",
                departure: (() => {
                  const d = new Date();
                  d.setHours(9, 0, 0, 0);
                  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
                  return d.toISOString();
                })(),
              }
            : {}),
          preferences: data.user.preferences,
        }));
        await refresh();
        const current = location.hash.slice(1);
        const match = resolveHash(current);
        setPage(match.page);
        if (match.offline) setOfflineView(true);
        // A direct link or refresh landed on a hash that matches no known route: show the
        // fallback page (already set above) but also correct the address bar to match what's
        // actually on screen, instead of leaving it pointing at a route that doesn't exist.
        if (current && !match.recognized) history.replaceState({}, "", `#${match.page}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Wayline could not start.");
      }
    })();
  }, []);
  useEffect(() => {
    const on = () => setOnline(true),
      off = () => setOnline(false),
      back = () => {
        // Shared with the initial-load handler so Back/Forward, a direct link and a refresh
        // all agree on what a given hash means -- including entering/leaving offline view,
        // which previously had no popstate handling at all (offlineView was only ever set to
        // true from a button click with no history entry behind it, or from the initial-load
        // hash check; Back could leave the app showing Offline while the URL had already moved
        // on, or vice versa).
        const match = resolveHash(location.hash.slice(1));
        setOfflineView(match.offline);
        setPage(match.page);
      };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("popstate", back);
    };
  }, []);
  useEffect(() => {
    if (!boot) return;
    const id = setInterval(() => {
      if (!navigator.onLine) return;
      // R10: capture the identity this specific request is FOR before it goes out, and re-check
      // it after the response arrives. clearInterval below (on identity change, since `boot` is
      // this effect's dependency) only stops FUTURE ticks -- it can't cancel a fetch already in
      // flight, so without this a slow /guardian/check response for the account someone just
      // switched AWAY from could still land and surface a notification (with that stale
      // account's preferences/timezone) after the new account is already active.
      const epoch = sessionEpoch.current;
      void refresh().catch(() => {});
      void api<Alert[]>("/guardian/check", "POST")
        .then((alerts) => {
          if (sessionEpoch.current !== epoch) return; // identity changed while this was in flight
          const p = boot.user.preferences;
          for (const alert of alerts) {
            if (notificationSeen.current.has(alert.id)) continue;
            notificationSeen.current.add(alert.id);
            // R07: the same policy server/push.mjs applies to a push -- see ./notifications.ts.
            // Evaluated against the account's saved timezone, not this device's own clock, so
            // this agrees with what a push (delivered while this device might be asleep) would
            // decide for the same alert.
            if (!isNotificationAllowed(alert, p)) continue;
            const { title, body } = notificationContent(alert, p);
            if ("Notification" in window && Notification.permission === "granted")
              new Notification(title, { body, tag: alert.id, icon: "/icon.svg" });
          }
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [boot]);
  const openAgent = (initialPrompt = "") => {
    setPrompt(initialPrompt);
    navigate("assistant");
  };
  const applyParsed = (p: ParsedRequest) => {
    setSearchInput((s) => {
      const date = new Date(s.departure);
      if (p.relativeDay !== undefined) {
        const base = new Date();
        base.setDate(base.getDate() + p.relativeDay);
        date.setFullYear(base.getFullYear(), base.getMonth(), base.getDate());
      }
      let deadline = s.deadline;
      if (p.deadlineText) {
        const match = p.deadlineText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
        if (match) {
          const limit = new Date(date);
          limit.setHours(
            (Number(match[1]) % 12) + (/pm/i.test(match[3]) ? 12 : 0),
            Number(match[2] ?? 0),
            0,
            0,
          );
          deadline = limit.toISOString();
        }
      }
      return {
        ...s,
        from: p.from ?? s.from,
        to: p.to ?? s.to,
        departure: date.toISOString(),
        deadline,
        preferences: { ...s.preferences, ...p.overrides },
      };
    });
    navigate("plan");
    notify(
      "Preferences applied. Review departure and arrival times in your device time zone, then search.",
    );
  };
  if (shareToken)
    return (
      <div className="shared-shell">
        <Brand />
        {shareError ? (
          <Notice tone="error">{shareError}</Notice>
        ) : shared ? (
          <>
            <Badge tone={shared.dataMode === "illustrative" ? "amber" : "mint"}>
              {shared.dataMode === "illustrative" ? "SAMPLE JOURNEY" : "SHARED JOURNEY"}
            </Badge>
            <h1>
              {shared.from} → {shared.to}
            </h1>
            <div className="stats-grid compact-stats">
              <div>
                <strong>{readable(shared.state)}</strong>
                <span>latest check-in</span>
              </div>
              <div>
                <strong>{time(shared.arrival)}</strong>
                <span>scheduled arrival · your time</span>
              </div>
            </div>
            <p>
              Updated {new Date(shared.updatedAt).toLocaleString()} · Sharing expires{" "}
              {new Date(shared.expiresAt).toLocaleString()}
            </p>
            <Notice>
              Only the shared trip is visible. Contact details, tickets and account information
              remain private.
            </Notice>
          </>
        ) : (
          <p>Opening shared journey…</p>
        )}
      </div>
    );
  if (offlineView) return <Offline />;
  if (error)
    return (
      <div className="startup">
        <Brand />
        <Notice tone="error">{error}</Notice>
        <div className="button-row">
          <Button kind="primary" onClick={() => location.reload()}>
            Try again
          </Button>
          <Button icon="lock" onClick={openOffline}>
            Open offline packs
          </Button>
        </div>
      </div>
    );
  if (!boot)
    return (
      <div className="startup">
        <Brand />
        <div className="loading-state">
          <div className="spinner" />
          <p>Getting your journeys ready…</p>
        </div>
      </div>
    );
  const activeLocale: Locale = (["en", "es", "hi"] as string[]).includes(
    boot.user.preferences.language,
  )
    ? (boot.user.preferences.language as Locale)
    : "en";
  const navigation = navLabels(activeLocale);
  return (
    <AppContext.Provider
      value={{
        boot,
        setBoot,
        page,
        navigate,
        journeys,
        refresh,
        active,
        setActive,
        switchIdentity,
        result,
        setResult,
        searchInput,
        setSearchInput,
        notify,
        openAgent,
        applyParsed,
        online,
      }}
    >
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className={`app-shell ${menu ? "menu-open" : ""}`}>
        <aside className="sidebar">
          {/* The only Brand usage inside the loaded app shell -- goes through navigate() like
              every other nav control, instead of a plain hash link with nothing listening for
              a bare hashchange. The other Brand usages above render before boot/routing exist
              (loading, error, and shared-link views), so a plain anchor is harmless there. */}
          <Brand onClick={() => navigate("plan")} />
          <Button kind="sidebar-new-trip" icon="plus" onClick={() => navigate("plan")}>
            New journey
          </Button>
          <div className="workspace-label">Workspace</div>
          <nav aria-label="Main navigation">
            {nav.slice(0, 7).map(([p, icon], i) => (
              <button
                key={p}
                className={page === p ? "active" : ""}
                onClick={() => navigate(p)}
                aria-current={page === p ? "page" : undefined}
              >
                <Icon name={icon} />
                <span>{navigation[i]}</span>
                {p === "trips" && <i>{journeys.length}</i>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            {nav.slice(7).map(([p, icon], i) => (
              <button key={p} className={page === p ? "active" : ""} onClick={() => navigate(p)}>
                <Icon name={icon} size={19} />
                {navigation[7 + i]}
              </button>
            ))}
            <button onClick={openOffline}>
              <Icon name="download" size={19} />
              Offline packs
            </button>
            {/* Phase 9 (accessibility): this was a plain <div onClick> -- unreachable by
                keyboard and invisible to a screen reader as an interactive control. A real
                <button> gets tab order, Enter/Space activation and an implicit "button" role for
                free instead of hand-rolling role/tabIndex/onKeyDown. */}
            <button className="profile-nav" onClick={() => navigate("profile")}>
              <span className="avatar">{boot.user.name[0]}</span>
              <span className="profile-nav-name">
                <b>{boot.user.name}</b>
                <small>{boot.user.registered ? "Your account" : "Guest session"}</small>
              </span>
              <Icon name="chevron" size={15} />
            </button>
          </div>
        </aside>
        {menu && (
          <button
            className="mobile-overlay"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          />
        )}
        <div className="main-shell">
          <header className="topbar">
            <div className="topbar-left">
              <Button
                icon="menu"
                title="Open navigation"
                kind="icon-only mobile-menu"
                onClick={() => setMenu(!menu)}
              />
              <span className="breadcrumb">
                <span className="workspace-crumb">Workspace</span>
                <Icon name="chevron" size={13} />{" "}
                <b>{navigation[nav.findIndex(([p]) => p === page)] ?? "Glance view"}</b>
              </span>
            </div>
            <div className="topbar-actions">
              <span className="connection-status">
                <span className={online ? "status-dot" : "status-dot amber"} />
                {online ? "Connected to app" : "Offline"}
              </span>
              <Button icon="spark" kind="agent-trigger" onClick={() => openAgent()}>
                Ask Wayline
              </Button>
              <ThemeToggle />
              <Button
                icon="bell"
                kind="icon-only"
                title="Open journey inbox"
                onClick={() => navigate("inbox")}
              />
              <button
                className="avatar"
                aria-label="Open profile"
                onClick={() => navigate("profile")}
              >
                {boot.user.name[0]}
              </button>
            </div>
          </header>
          {!online && (
            <Notice tone="amber">
              Connection lost. Previously displayed information may be stale.{" "}
              <button className="text-link" onClick={openOffline}>
                Open encrypted offline packs
              </button>
            </Notice>
          )}
          <main id="main-content" tabIndex={-1} className={`page-content page-${page}`}>
            <SectionErrorBoundary key={page} onOffline={openOffline}>
            <Suspense
              fallback={
                <div className="loading-state">
                  <div className="spinner" />
                  Opening your workspace…
                </div>
              }
            >
              {page === "assistant" ? (
                <AssistantPage initialPrompt={prompt} key={boot.user.id} />
              ) : page === "plan" ? (
                <Planner />
              ) : page === "journey" ? (
                <JourneyPage />
              ) : page === "wallet" ? (
                <Wallet />
              ) : page === "trips" ? (
                <Trips />
              ) : page === "commute" ? (
                <Commute />
              ) : page === "inbox" ? (
                <Inbox />
              ) : page === "profile" ? (
                <Profile />
              ) : page === "lab" ? (
                <Lab />
              ) : (
                <Watch />
              )}
            </Suspense>
            </SectionErrorBoundary>
            {boot.user.preferences.visitor && (
              <Phrasebook language={boot.user.preferences.language} />
            )}
            <footer className="page-footer">
              <span>
                Wayline <span className="footer-divider">/</span>{" "}
                {translate(activeLocale, "app.footerTagline")}
              </span>
              <span>{translate(activeLocale, "app.footerNote")}</span>
            </footer>
          </main>
        </div>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        {(["plan", "trips", "assistant", "wallet"] as Page[]).map((p) => (
          <button
            key={p}
            className={page === p ? "active" : ""}
            aria-current={page === p ? "page" : undefined}
            onClick={() => navigate(p)}
          >
            <Icon name={nav.find(([item]) => item === p)?.[1] ?? "route"} size={20} />
            <span>
              {translate(
                activeLocale,
                p === "plan"
                  ? "nav.planShort"
                  : p === "trips"
                    ? "nav.tripsShort"
                    : p === "assistant"
                      ? "nav.assistant"
                      : "nav.tickets",
              )}
            </span>
          </button>
        ))}
        <button onClick={() => setMenu(true)} aria-label="More navigation">
          <Icon name="menu" size={20} />
          <span>{translate(activeLocale, "nav.more")}</span>
        </button>
      </nav>
      <button
        className="mobile-agent"
        aria-label={translate(activeLocale, "app.openAgentAria")}
        onClick={() => openAgent()}
      >
        <Icon name="spark" size={26} />
      </button>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          {toast}
          <button
            onClick={() => setToast("")}
            aria-label={translate(activeLocale, "app.dismissNotificationAria")}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
function Brand({ onClick }: { onClick?: () => void } = {}) {
  return (
    <a
      className="brand"
      href="#plan"
      aria-label="Wayline home"
      onClick={
        onClick &&
        ((e) => {
          e.preventDefault();
          onClick();
        })
      }
    >
      <span className="brand-symbol" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="m3 5 4 14 5-10 5 10 4-14"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <strong>Wayline</strong>
    </a>
  );
}
function Watch() {
  const ctx = requireApp();
  const { t } = useT();
  const j = ctx.active?.version ? ctx.active : ctx.journeys[0];
  return (
    <div className="glance-view">
      <Badge>{t("app.watchBadge")}</Badge>
      {j ? (
        <>
          <h1>{j.to}</h1>
          <div className="glance-time">{time(j.arrival, j.destinationTimezone)}</div>
          <p>{t("app.scheduledArrival", { tz: j.destinationTimezone })}</p>
          <h2>{readable(j.state ?? "planned")}</h2>
          <Badge tone={j.graph.overallRisk === "high" ? "amber" : "mint"}>
            {t("app.overallRisk", { risk: j.graph.overallRisk })}
          </Badge>
          <p>
            {j.dataMode === "illustrative" ? t("app.sampleJourney") : t("app.connectedSchedule")}
          </p>
          <Button kind="primary" onClick={() => ctx.navigate("journey")}>
            {t("app.fullJourney")}
          </Button>
        </>
      ) : (
        <Empty title={t("app.noSavedJourneyTitle")}>{t("app.noSavedJourneyBody")}</Empty>
      )}
      <p className="fine-print">{t("app.notNativeApp")}</p>
    </div>
  );
}
import { useApp as requireApp } from "./context";
// Extends visitor mode (roadmap feature 94) using the same i18n.ts catalog as everything else:
// the phrasebook now covers the four categories feature 93 itself names -- transit alerts,
// station instructions, ticketing and boarding directions -- instead of four unlabeled phrases
// with no category structure. es/hi phrases are AI-translated and unreviewed, same as the rest
// of the non-English catalog; that caveat is shown directly in the section, not just in a doc.
const PHRASEBOOK_CATEGORIES: { titleKey: string; phraseKeys: string[] }[] = [
  {
    titleKey: "phrasebook.categoryAlerts",
    phraseKeys: ["phrasebook.alerts.1", "phrasebook.alerts.2", "phrasebook.alerts.3"],
  },
  {
    titleKey: "phrasebook.categoryStation",
    phraseKeys: ["phrasebook.station.1", "phrasebook.station.2", "phrasebook.station.3"],
  },
  {
    titleKey: "phrasebook.categoryTicketing",
    phraseKeys: ["phrasebook.ticketing.1", "phrasebook.ticketing.2", "phrasebook.ticketing.3"],
  },
  {
    titleKey: "phrasebook.categoryBoarding",
    phraseKeys: ["phrasebook.boarding.1", "phrasebook.boarding.2", "phrasebook.boarding.3"],
  },
];
function Phrasebook({ language }: { language: string }) {
  const locale: Locale = (["en", "es", "hi"] as string[]).includes(language)
    ? (language as Locale)
    : "en";
  const speak = (phrase: string) => {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const s = new SpeechSynthesisUtterance(phrase);
    s.lang = locale === "es" ? "es-US" : locale === "hi" ? "hi-IN" : "en-US";
    speechSynthesis.speak(s);
  };
  return (
    <Section title={translate(locale, "app.phrasebookTitle")}>
      {locale !== "en" && (
        <p className="fine-print">{translate(locale, "phrasebook.unreviewedNote")}</p>
      )}
      {PHRASEBOOK_CATEGORIES.map((category) => (
        <div key={category.titleKey}>
          <h3>{translate(locale, category.titleKey)}</h3>
          <div className="phrase-grid">
            {category.phraseKeys.map((key) => {
              const phrase = translate(locale, key);
              return (
                <button key={key} onClick={() => speak(phrase)}>
                  <Icon name="headphones" />
                  <b>{phrase}</b>
                  <small>
                    {locale === "en" ? translate(locale, "app.tapToHear") : translate("en", key)}
                  </small>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </Section>
  );
}
interface SharedJourney {
  from: string;
  to: string;
  departure: string;
  arrival: string;
  state: string;
  dataMode: string;
  updatedAt: string;
  expiresAt: number;
}
