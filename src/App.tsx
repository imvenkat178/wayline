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
import { api, setCsrf, time, dateLabel, readable } from "./api";
import { Icon, Button, Badge, Notice, Empty, Section } from "./components/ui";
import { Agent } from "./components/Agent";
import Planner from "./pages/Planner";
import Offline from "./pages/Offline";
const JourneyPage = lazy(() => import("./pages/Journey"));
const Wallet = lazy(() => import("./pages/Wallet"));
const Trips = lazy(() => import("./pages/Trips"));
const Commute = lazy(() => import("./pages/Commute"));
const Inbox = lazy(() => import("./pages/Inbox"));
const Profile = lazy(() => import("./pages/Profile"));
const Lab = lazy(() => import("./pages/Lab"));
const labels: Record<string, string[]> = {
  en: [
    "Plan a journey",
    "Journey Guardian",
    "Tickets",
    "Journey inbox",
    "My journeys",
    "Commute",
    "Profile & preferences",
    "Open Transit Lab",
  ],
  es: [
    "Planificar viaje",
    "Guardián del viaje",
    "Billetes",
    "Notificaciones",
    "Mis viajes",
    "Trayecto habitual",
    "Perfil y preferencias",
    "Datos de transporte",
  ],
  hi: [
    "यात्रा की योजना",
    "यात्रा सहायक",
    "टिकट",
    "यात्रा सूचनाएँ",
    "मेरी यात्राएँ",
    "दैनिक यात्रा",
    "प्रोफ़ाइल",
    "परिवहन डेटा",
  ],
};

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
    [agentOpen, setAgentOpen] = useState(false),
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
  // logic would otherwise leave in place), search preferences (reset to the new user's saved
  // preferences so a fresh search never silently applies someone else's budget/accessibility
  // requirements), the notification de-dup set, and the assistant panel (it may still be open
  // and rendered with the previous user's conversation on screen). Also bumps sessionEpoch so
  // any request already in flight for the previous identity is discarded rather than applied.
  const switchIdentity = useCallback((next: { user: Bootstrap["user"]; csrf: string }) => {
    sessionEpoch.current += 1;
    setCsrf(next.csrf);
    setBoot((prev) => (prev ? { ...prev, user: next.user } : prev));
    setSearchInput((s) => ({ ...s, preferences: next.user.preferences }));
    setResult(null);
    setActive(null);
    setAgentOpen(false);
    setPrompt("");
    notificationSeen.current.clear();
    setError("");
  }, []);
  useEffect(() => {
    if (initial.current) return;
    initial.current = true;
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
        setSearchInput((s) => ({ ...s, preferences: data.user.preferences }));
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
      void api<Alert[]>("/guardian/check", "POST")
        .then((alerts) => {
          const p = boot.user.preferences;
          const now = new Date();
          const minutes = now.getHours() * 60 + now.getMinutes();
          const start = p.quietStart.split(":").map(Number),
            end = p.quietEnd.split(":").map(Number);
          const a = start[0] * 60 + start[1],
            b = end[0] * 60 + end[1];
          const quiet = a > b ? minutes >= a || minutes < b : minutes >= a && minutes < b;
          for (const alert of alerts) {
            if (notificationSeen.current.has(alert.id) || alert.read) continue;
            notificationSeen.current.add(alert.id);
            const critical = alert.severity === "critical";
            if ((critical && !p.notifyCritical) || (!critical && (!p.notifyInfo || quiet)))
              continue;
            if ("Notification" in window && Notification.permission === "granted")
              new Notification(
                `${alert.dataMode === "illustrative" ? "Sample · " : ""}${alert.title}`,
                { body: alert.body, tag: alert.id, icon: "/icon.svg" },
              );
          }
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [boot]);
  const openAgent = (initialPrompt = "") => {
    setPrompt(initialPrompt);
    setAgentOpen(true);
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
  const navigation = labels[boot.user.preferences.language] ?? labels.en;
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
          <div className="workspace-label">YOUR JOURNEY SPACE</div>
          <nav aria-label="Main navigation">
            {nav.slice(0, 6).map(([p, icon], i) => (
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
          <button className="assistant-card" onClick={() => openAgent()}>
            <span className="guardian-orb">
              <Icon name="spark" />
            </span>
            <b>
              A companion for
              <br />
              every connection.
            </b>
            <span>
              Ask Wayline anything
              <Icon name="arrow" size={16} />
            </span>
          </button>
          <div className="sidebar-bottom">
            {nav.slice(6).map(([p, icon], i) => (
              <button key={p} className={page === p ? "active" : ""} onClick={() => navigate(p)}>
                <Icon name={icon} size={19} />
                {navigation[6 + i]}
              </button>
            ))}
            <button onClick={openOffline}>
              <Icon name="download" size={19} />
              Offline packs
            </button>
            <div className="profile-nav" onClick={() => navigate("profile")}>
              <span className="avatar">{boot.user.name[0]}</span>
              <div>
                <b>{boot.user.name}</b>
                <small>{boot.user.registered ? "Your account" : "Guest session"}</small>
              </div>
              <Icon name="chevron" size={15} />
            </div>
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
                Your workspace <Icon name="chevron" size={13} />{" "}
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
          <main id="main-content" tabIndex={-1} className="page-content">
            <Suspense
              fallback={
                <div className="loading-state">
                  <div className="spinner" />
                  Opening your workspace…
                </div>
              }
            >
              {page === "plan" ? (
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
            {boot.user.preferences.visitor && (
              <Phrasebook language={boot.user.preferences.language} />
            )}
            <footer className="page-footer">
              <span>
                Wayline <span className="footer-divider">/</span> Find. Know. Arrive.
              </span>
              <span>Sample data stays labeled. Your journey stays yours.</span>
            </footer>
          </main>
        </div>
      </div>
      {agentOpen && <Agent initialPrompt={prompt} close={() => setAgentOpen(false)} />}
      <button
        className="mobile-agent"
        aria-label="Open journey assistant"
        onClick={() => openAgent()}
      >
        <Icon name="spark" size={26} />
      </button>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          {toast}
          <button onClick={() => setToast("")} aria-label="Dismiss notification">
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
      <img src="/icon.svg" alt="" />
      <strong>
        wayline<span>®</span>
      </strong>
    </a>
  );
}
function Watch() {
  const ctx = requireApp();
  const j = ctx.active?.version ? ctx.active : ctx.journeys[0];
  return (
    <div className="glance-view">
      <Badge>GLANCE VIEW · WEB</Badge>
      {j ? (
        <>
          <h1>{j.to}</h1>
          <div className="glance-time">{time(j.arrival, j.destinationTimezone)}</div>
          <p>Scheduled arrival · {j.destinationTimezone}</p>
          <h2>{readable(j.state ?? "planned")}</h2>
          <Badge tone={j.graph.overallRisk === "high" ? "amber" : "mint"}>
            {j.graph.overallRisk} modeled connection risk
          </Badge>
          <p>{j.dataMode === "illustrative" ? "Sample journey" : "Connected schedule"}</p>
          <Button kind="primary" onClick={() => ctx.navigate("journey")}>
            Full journey
          </Button>
        </>
      ) : (
        <Empty title="No saved journey">Save a trip to use the glance view.</Empty>
      )}
      <p className="fine-print">
        This compact web view is not a native Apple Watch or Wear OS application.
      </p>
    </div>
  );
}
import { useApp as requireApp } from "./context";
function Phrasebook({ language }: { language: string }) {
  const phrases: Record<string, string[]> = {
    en: [
      "Where does this bus go?",
      "Which platform is my train on?",
      "Is there a step-free entrance?",
      "Can you help me find my connection?",
    ],
    es: [
      "¿A dónde va este autobús?",
      "¿En qué andén está mi tren?",
      "¿Hay una entrada sin escaleras?",
      "¿Puede ayudarme a encontrar mi conexión?",
    ],
    hi: [
      "यह बस कहाँ जाती है?",
      "मेरी ट्रेन किस प्लेटफ़ॉर्म पर है?",
      "क्या बिना सीढ़ियों वाला प्रवेश द्वार है?",
      "क्या आप मेरी अगली सवारी ढूँढ़ने में मदद कर सकते हैं?",
    ],
  };
  return (
    <Section title="A few words for the journey">
      <div className="phrase-grid">
        {(phrases[language] ?? phrases.en).map((p, i) => (
          <button
            key={p}
            onClick={() => {
              if ("speechSynthesis" in window) {
                speechSynthesis.cancel();
                const s = new SpeechSynthesisUtterance(p);
                s.lang = language === "es" ? "es-US" : language === "hi" ? "hi-IN" : "en-US";
                speechSynthesis.speak(s);
              }
            }}
          >
            <Icon name="headphones" />
            <b>{p}</b>
            <small>{language === "en" ? "Tap to hear" : phrases.en[i]}</small>
          </button>
        ))}
      </div>
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
