import { useEffect, useState } from "react";
import { useApp } from "../context";
import { api, money, time, dateLabel, duration, copyText, download, readable } from "../api";
import type { Journey, Twin, Station, SearchResult, Ticket } from "../types";
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
  modeIcon,
} from "../components/ui";
import { JourneyMap } from "../components/JourneyMap";
import { saveOffline } from "../offline";
import { Scanner } from "../components/Scanner";
export default function JourneyPage() {
  const { active, setActive, journeys, boot, navigate, refresh, notify, searchInput, openAgent } =
    useApp();
  const { busy, error, run } = useAsync();
  const [twin, setTwin] = useState<Twin | null>(null),
    [delay, setDelay] = useState(0),
    [weather, setWeather] = useState("clear"),
    [outage, setOutage] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const j = active?.version ? active : journeys[0];
  useEffect(() => {
    if (!j) return;
    void api<Twin>(`/journeys/${j.id}/twin`, "POST", {
      delayMinutes: delay,
      weather,
      accessibilityOutage: outage,
    })
      .then(setTwin)
      .catch(() => {});
  }, [j?.id, j?.version, delay, weather, outage]);
  if (!j)
    return (
      <Empty
        icon="shield"
        title="Your next journey starts here"
        action={
          <Button kind="primary" onClick={() => navigate("plan")}>
            Find and save a journey
          </Button>
        }
      >
        Save a route to follow its legs, prepare alternatives, and keep your travel details
        together.
      </Empty>
    );
  const graph = twin?.graph ?? j.graph;
  const nextStates = (boot.transitions[j.state ?? "PLANNED"] ?? []).filter((x) => x !== "BOOKED");
  const next = async (state: string) => {
    const updated = await api<Journey>(`/journeys/${j.id}/state`, "POST", {
      state,
      version: j.version,
    });
    setActive(updated);
    await refresh();
    notify(`Journey updated: ${readable(state)}.`);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WHOLE JOURNEY</span>
          <h1>
            {j.from} <span className="heading-arrow">→</span> {j.to}
          </h1>
          <p>
            {dateLabel(j.departure, j.timezone)} · {j.travelers} traveler
            {j.travelers === 1 ? "" : "s"} · {duration(j.durationMinutes)}
          </p>
        </div>
        <div className="button-row">
          <Button icon="share" onClick={() => setModal("share")}>
            Share trip
          </Button>
          <Button icon="download" onClick={() => setModal("offline")}>
            Offline pack
          </Button>
        </div>
      </div>
      {journeys.length > 1 && (
        <Field label="Saved journey">
          <select
            value={j.id}
            onChange={(e) => setActive(journeys.find((x) => x.id === e.target.value) ?? null)}
          >
            {journeys.map((x) => (
              <option key={x.id} value={x.id}>
                {x.from} → {x.to} · {dateLabel(x.departure, x.timezone)} ·{" "}
                {readable(x.state ?? "planned")}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="journey-status">
        <div className="status-emblem">
          <Icon name="shield" size={25} />
        </div>
        <div>
          <b>{readable(j.state ?? "PLANNED")}</b>
          <p>
            {j.dataMode === "illustrative"
              ? "Sample itinerary. Status changes below are your own check-ins."
              : "Status follows your check-ins. Confirm current travel details with your operator."}
          </p>
        </div>
        <Badge tone={graph.overallRisk === "high" ? "amber" : "mint"}>
          {graph.overallRisk === "high" ? "Connection at risk" : "Connection plan ready"}
        </Badge>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="journey-layout">
        <div className="stack">
          <JourneyMap journey={j} />
          <Section
            title="Every step, in one place"
            action={<Badge>{j.dataMode === "illustrative" ? "SAMPLE" : "SCHEDULE"}</Badge>}
          >
            <div className="journey-timeline">
              {j.legs.map((leg, index) => (
                <div className="leg" key={leg.id}>
                  <div className="leg-time">
                    {time(leg.departure, j.timezone)}
                    <small>{duration(leg.durationMinutes)}</small>
                  </div>
                  <div className="leg-symbol">
                    <i className={`mode-${leg.mode}`}>
                      <Icon name={modeIcon(leg.mode)} />
                    </i>
                    {index < j.legs.length - 1 && <span />}
                  </div>
                  <div className="leg-content">
                    <div className="section-title">
                      <h3>{leg.service}</h3>
                      <span>{leg.priceCents == null ? "Unknown fare" : money(leg.priceCents)}</span>
                    </div>
                    <p>
                      {leg.from} <span>→</span> {leg.to}
                    </p>
                    <div className="leg-badges">
                      <Badge tone="neutral">
                        {leg.tracking.source === "sample"
                          ? "Sample signal"
                          : leg.tracking.source === "live-gps"
                            ? "Live GPS"
                            : leg.tracking.source === "predicted"
                              ? "Predicted"
                              : "Schedule only"}
                      </Badge>
                      {leg.mode !== "walk" && (
                        <>
                          <span>
                            <Icon name="user" size={14} />
                            {leg.crowding == null
                              ? "Crowding unknown"
                              : `${leg.crowding}% · sample crowding`}
                          </span>
                          <span>
                            <Icon name="access" size={14} />
                            {leg.accessible === null
                              ? "Access unverified"
                              : leg.accessible
                                ? "Sample step-free"
                                : "Stairs in sample"}
                          </span>
                        </>
                      )}
                    </div>
                    {leg.mode !== "walk" && (
                      <div className="boarding-note">
                        <Icon name="pin" size={16} />
                        <span>
                          {leg.platform ? `Platform ${leg.platform}` : "Gate not confirmed"}.{" "}
                          {leg.boardingHint}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="button-row wrap">
              {nextStates.map((state) => (
                <Button
                  key={state}
                  kind={state === "CANCELLED" ? "subtle" : "secondary"}
                  disabled={busy}
                  onClick={() => {
                    if (state === "CANCELLED") setModal("cancel");
                    else void run(() => next(state));
                  }}
                >
                  {readable(state)}
                </Button>
              ))}
            </div>
            <p className="fine-print">
              Check-ins update your saved journey. They do not change a carrier reservation.
            </p>
          </Section>
          <Section title="Connection health">
            <div className="connection-grid">
              {graph.connections.length ? (
                graph.connections.map((c) => (
                  <div className={`connection-card ${c.risk}`} key={c.id}>
                    <div className="section-title">
                      <Badge tone={c.risk === "high" ? "amber" : "mint"}>
                        {readable(c.risk)} risk
                      </Badge>
                      <span>{c.buffer} min available</span>
                    </div>
                    <h3>{c.station}</h3>
                    <div className="buffer-visual">
                      <span
                        style={{
                          width: `${Math.max(2, Math.min(100, (c.buffer / Math.max(1, c.requiredMinutes + 20)) * 100))}%`,
                        }}
                      />
                    </div>
                    <p>
                      {c.walkMinutes} min walk + {c.cutoffMinutes} min boarding + preferred buffers
                    </p>
                    <div className="section-title">
                      <b>
                        {c.spareMinutes < 0
                          ? `${-c.spareMinutes} min short`
                          : `${c.spareMinutes} min spare`}
                      </b>
                      <small>{c.probability}% modeled likelihood</small>
                    </div>
                    <small>Heuristic model · not statistically calibrated</small>
                  </div>
                ))
              ) : (
                <p>No transit-to-transit connections to model.</p>
              )}
            </div>
          </Section>
          <Section
            title="Journey record"
            action={
              <a className="text-link" href={`/api/journeys/${j.id}/receipt`} download>
                Export receipt <Icon name="download" size={15} />
              </a>
            }
          >
            <div className="event-list">
              {j.events?.map((e) => (
                <div key={e.id}>
                  <span className="event-dot" />
                  <div>
                    <b>{e.to ? readable(e.to) : readable(e.type)}</b>
                    <small>
                      {new Date(e.at).toLocaleString()} · {e.source}
                    </small>
                  </div>
                  <Icon name="check" size={16} />
                </div>
              ))}
            </div>
            <div className="button-row wrap">
              <a className="btn" href={`/api/journeys/${j.id}/calendar`} download>
                <Icon name="calendar" />
                Add to calendar
              </a>
              <Button icon="ticket" onClick={() => setModal("claim")}>
                Prepare refund request
              </Button>
              <Button icon="clock" onClick={() => navigate("watch")}>
                Glance view
              </Button>
            </div>
          </Section>
        </div>
        <aside className="stack">
          <div className="guardian-panel">
            <div className="guardian-heading">
              <div className="guardian-orb">
                <Icon name="spark" size={24} />
              </div>
              <div>
                <span className="eyebrow">WAYLINE GUARDIAN</span>
                <h2>
                  A little foresight.
                  <br />A smoother journey.
                </h2>
              </div>
            </div>
            <p>Check how a change affects your connections before making a decision.</p>
            <div className="leave-card">
              <Icon name="clock" />
              <div>
                <small>ITINERARY-BASED LEAVE TIME</small>
                <strong>{time((twin?.leave ?? j.leave).leaveAt, j.timezone)}</strong>
                <small>{j.timezone} · location not used</small>
              </div>
            </div>
            <div className="scenario-box">
              <Badge tone="amber">WHAT-IF SCENARIO</Badge>
              <Field label={`Incoming delay: +${delay} minutes`}>
                <input
                  type="range"
                  min="0"
                  max="90"
                  value={delay}
                  onChange={(e) => setDelay(+e.target.value)}
                />
              </Field>
              <Field label="Weather">
                <select value={weather} onChange={(e) => setWeather(e.target.value)}>
                  {["clear", "rain", "snow", "heat"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Toggle label="Elevator unavailable" checked={outage} onChange={setOutage} />
            </div>
            {twin?.alerts.map((a, i) => (
              <Notice key={i} tone="amber">
                <b>{a.title}</b>
                <br />
                {a.body}
              </Notice>
            ))}
            <Button kind="primary full" icon="route" onClick={() => setModal("recovery")}>
              Explore backup routes
            </Button>
            <Button
              kind="full subtle"
              icon="spark"
              onClick={() => {
                setActive(j);
                openAgent("Will I make my connection?");
              }}
            >
              Ask about my connection
            </Button>
          </div>
          <Section title="Get boarding right">
            <Button icon="pin" kind="full" onClick={() => setModal("station")}>
              Station guide
            </Button>
            <Button icon="camera" kind="full" onClick={() => setModal("scan")}>
              Read a vehicle sign
            </Button>
            <Button icon="user" kind="full" onClick={() => setModal("report")}>
              Report a travel issue
            </Button>
            <p className="fine-print">
              A matching sign is supporting evidence. Confirm service and destination before
              boarding.
            </p>
          </Section>
          <Section title="Tickets for this journey">
            <p>
              Purchase on the operator’s official website, then add your confirmation to Tickets.
            </p>
            <div className="stack">
              {[
                ...new Set(
                  j.legs.filter((l) => boot.operatorLinks[l.operator]).map((l) => l.operator),
                ),
              ].map((op) => (
                <a
                  className="provider-link"
                  href={boot.operatorLinks[op]}
                  target="_blank"
                  rel="noreferrer"
                  key={op}
                >
                  {op}
                  <Icon name="external" size={16} />
                </a>
              ))}
            </div>
            <Button kind="full" icon="ticket" onClick={() => navigate("wallet")}>
              Open ticket wallet
            </Button>
          </Section>
        </aside>
      </div>
      {modal === "share" && <ShareModal journey={j} close={() => setModal(null)} />}
      {modal === "offline" && <OfflineModal journey={j} close={() => setModal(null)} />}
      {modal === "station" && <StationModal id={j.fromId} close={() => setModal(null)} />}
      {modal === "claim" && <ClaimModal journey={j} close={() => setModal(null)} />}
      {modal === "scan" && <Scanner journey={j} close={() => setModal(null)} />}
      {modal === "report" && <ReportModal journey={j} close={() => setModal(null)} />}
      {modal === "recovery" && (
        <RecoveryModal journey={j} input={searchInput} close={() => setModal(null)} />
      )}
      {modal === "cancel" && (
        <Modal title="Cancel this saved plan?" onClose={() => setModal(null)}>
          <p>
            This removes the journey from active monitoring. You must cancel any tickets with the
            operator separately.
          </p>
          <Button
            kind="danger"
            onClick={() =>
              void run(async () => {
                await next("CANCELLED");
                setModal(null);
              })
            }
          >
            Cancel saved plan
          </Button>
        </Modal>
      )}
    </>
  );
}
function ShareModal({ journey: j, close }: { journey: Journey; close: () => void }) {
  const [hours, setHours] = useState(24),
    [location, setLocation] = useState(false),
    [link, setLink] = useState("");
  const { busy, error, run } = useAsync();
  const { notify } = useApp();
  return (
    <Modal title="Let someone follow your journey" onClose={close}>
      <p>
        The link shows your route, ETA and check-in status. Tickets and contact details stay
        private.
      </p>
      <div className="stack">
        <Field label="Link expires in">
          <select value={hours} onChange={(e) => setHours(+e.target.value)}>
            {[1, 6, 24, 72, 168].map((x) => (
              <option key={x} value={x}>
                {x} hours
              </option>
            ))}
          </select>
        </Field>
        <Toggle
          label="Include reported vehicle location"
          description="Only an exact, recorded vehicle position is included. Your device location is never shared."
          checked={location}
          onChange={setLocation}
        />
        {!link ? (
          <Button
            kind="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const d = await api<{ token: string }>(`/journeys/${j.id}/share`, "POST", {
                  hours,
                  location,
                });
                setLink(`${window.location.origin}/?share=${d.token}`);
              })
            }
          >
            Create expiring link
          </Button>
        ) : (
          <>
            <Field label="Anyone with this link can view this trip">
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
            </Field>
            <Button
              icon="copy"
              onClick={() =>
                void run(async () => {
                  await copyText(link);
                  notify("Link copied.");
                })
              }
            >
              Copy link
            </Button>
            <Notice>
              The server must be reachable by your recipient. A localhost link works only on this
              computer. Revoke links in Profile.
            </Notice>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
function OfflineModal({ journey: j, close }: { journey: Journey; close: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const { busy, error, run } = useAsync();
  const { notify } = useApp();
  return (
    <Modal title="Keep this journey with you offline" onClose={close}>
      <p>
        Your itinerary, boarding notes and imported ticket details are encrypted on this browser.
        Offline locations remain labeled with their original source and time.
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const tickets = (await api<Ticket[]>("/records/ticket")).filter(
              (t) => t.journeyId === j.id,
            );
            await saveOffline(
              {
                journey: j,
                tickets,
                savedAt: new Date().toISOString(),
                expiresAt: new Date(
                  Math.max(Date.now() + 86400000, Date.parse(j.arrival) + 86400000),
                ).toISOString(),
              },
              passphrase,
            );
            notify("Encrypted offline pack saved. Remember your passphrase.");
            close();
          });
        }}
      >
        <Field
          label="Offline passphrase"
          hint="At least 12 characters. It is not stored or sent to the server."
        >
          <input
            required
            minLength={12}
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </Field>
        <Notice>
          The pack includes a route diagram, not offline basemap tiles. A saved confirmation does
          not replace a carrier-issued barcode.
        </Notice>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" kind="primary" disabled={busy} icon="download">
          Save encrypted pack
        </Button>
      </form>
    </Modal>
  );
}
function StationModal({ id, close }: { id: string; close: () => void }) {
  const [station, setStation] = useState<Station | null>(null);
  const { error, run } = useAsync();
  useEffect(() => {
    void run(async () => setStation(await api(`/stations/${id}`)));
  }, [id]);
  return (
    <Modal title={station?.name ?? "Station guide"} onClose={close}>
      <Notice tone="amber">{station?.source ?? "Loading station information…"}</Notice>
      {error && <Notice tone="error">{error}</Notice>}
      {station && (
        <>
          <div className="facility-grid">
            {station.facilities.map((f) => (
              <div key={f.name}>
                <Icon name={/access|elevator/i.test(f.name) ? "access" : "pin"} size={19} />
                <b>{f.name}</b>
                <small>{f.status}</small>
              </div>
            ))}
          </div>
          <h3>Getting to your departure</h3>
          <ol className="instructions">
            {station.directions.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ol>
          <a
            className="btn"
            href={`https://www.openstreetmap.org/?mlat=${station.lat}&mlon=${station.lon}#map=17/${station.lat}/${station.lon}`}
            target="_blank"
            rel="noreferrer"
          >
            Open station map
            <Icon name="external" size={16} />
          </a>
        </>
      )}
    </Modal>
  );
}
function ClaimModal({ journey: j, close }: { journey: Journey; close: () => void }) {
  const [reason, setReason] = useState(""),
    [cost, setCost] = useState(0),
    [draft, setDraft] = useState("");
  const { busy, error, run } = useAsync();
  return (
    <Modal title="Prepare a refund request" onClose={close}>
      <Notice>
        Eligibility must be reviewed by the operator. Nothing is submitted from this screen.
      </Notice>
      {j.dataMode === "illustrative" && (
        <Notice tone="amber">
          This is a sample journey. Do not submit its generated evidence as a real claim.
        </Notice>
      )}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await api<{ draft: string }>(`/journeys/${j.id}/claim`, "POST", {
              reason,
              expensesCents: Math.round(cost * 100),
            });
            setDraft(r.draft);
          });
        }}
      >
        <Field label="What happened?">
          <textarea
            required
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe the delay, cancellation or missed connection."
          />
        </Field>
        <Field label="Additional expenses ($)">
          <input
            type="number"
            min="0"
            max="10000"
            step="0.01"
            value={cost}
            onChange={(e) => setCost(+e.target.value)}
          />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" kind="primary" disabled={busy}>
          Prepare and save draft
        </Button>
        {draft && (
          <>
            <pre className="draft-preview">{draft}</pre>
            <Button
              icon="download"
              onClick={() => download("wayline-refund-draft.txt", draft, "text/plain")}
            >
              Download draft
            </Button>
          </>
        )}
      </form>
    </Modal>
  );
}
function RecoveryModal({
  journey: j,
  input,
  close,
}: {
  journey: Journey;
  input: import("../types").SearchInput;
  close: () => void;
}) {
  const [options, setOptions] = useState<SearchResult | null>(null);
  const { busy, error, run } = useAsync();
  const { notify } = useApp();
  useEffect(() => {
    void run(async () =>
      setOptions(
        await api("/search", "POST", {
          ...input,
          from: j.fromId,
          to: j.toId,
          departure: new Date(
            Math.max(Date.now() + 3600000, Date.parse(j.departure)),
          ).toISOString(),
          mode: j.dataMode === "illustrative" ? "sample" : "provider",
          preferences: { ...input.preferences, budgetCents: input.preferences.budgetCents + 1000 },
        }),
      ),
    );
  }, []);
  return (
    <Modal title="A backup, before you need it" onClose={close} wide>
      <Notice>
        Alternatives start from the original origin. Check that you can reach the boarding stop.
        Preparing a backup does not hold inventory or exchange a ticket.
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}
      {busy && !options && <p>Looking for alternatives…</p>}
      {options?.journeys.map((alt) => (
        <div className="option-card" key={alt.id}>
          <div>
            <Badge tone="mint">{alt.name}</Badge>
            <h3>
              {time(alt.departure, alt.timezone)} → {time(alt.arrival, alt.destinationTimezone)}
            </h3>
            <p>
              {duration(alt.durationMinutes)} · {alt.graph.overallRisk} modeled risk ·{" "}
              {alt.dataMode === "illustrative" ? "sample route" : "connected schedule"}
            </p>
          </div>
          <div>
            <b>
              {alt.price.totalCents == null || j.price.totalCents == null
                ? "Price unknown"
                : `${alt.price.totalCents - j.price.totalCents >= 0 ? "+" : ""}${money(alt.price.totalCents - j.price.totalCents)}`}
            </b>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/journeys/${j.id}/recovery`, "POST", {
                    searchId: options.searchId,
                    journeyId: alt.id,
                  });
                  notify("Backup saved for review. No ticket was exchanged.");
                  close();
                })
              }
            >
              Prepare backup
            </Button>
          </div>
        </div>
      ))}
      {options && !options.journeys.length && (
        <Empty title="No matching alternatives">
          Adjust your planner preferences and try again.
        </Empty>
      )}
    </Modal>
  );
}
function ReportModal({ journey: j, close }: { journey: Journey; close: () => void }) {
  const [type, setType] = useState("bus-missing"),
    [note, setNote] = useState(""),
    [consent, setConsent] = useState(false);
  const { busy, error, run } = useAsync();
  const { notify } = useApp();
  const leg = j.legs.find((l) => l.mode !== "walk")!;
  return (
    <Modal title="Share what you see" onClose={close}>
      <p>
        Your report is unverified evidence. It does not overwrite an official location or
        accessibility notice.
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api("/records/report", "POST", {
              type,
              note,
              station: leg.from,
              service: leg.service,
              consent,
            });
            notify("Report saved. It will remain labeled as an unverified rider report.");
            close();
          });
        }}
      >
        <Field label="Report type">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {[
              "bus-missing",
              "stop-moved",
              "elevator-broken",
              "boarding-location",
              "crowding",
              "on-board",
            ].map((x) => (
              <option key={x} value={x}>
                {readable(x)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Details">
          <textarea maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Toggle
          label="I agree to contribute this report"
          description="No continuous device location is collected. Community counts appear only with at least five distinct reporting accounts."
          checked={consent}
          onChange={setConsent}
        />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" kind="primary" disabled={busy || !consent}>
          Submit report
        </Button>
      </form>
    </Modal>
  );
}
