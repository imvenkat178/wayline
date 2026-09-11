import { SavedJourneyFeature } from "../components/JourneyCover";
import { useEffect, useState } from "react";
import { useApp } from "../context";
import { api, money, time, duration, readable, download } from "../api";
import type { Journey } from "../types";
import {
  Button,
  Icon,
  Badge,
  Notice,
  Empty,
  Modal,
  Section,
  useAsync,
} from "../components/ui";
interface Analytics {
  planned: number;
  completed: number;
  sampleTrips: number;
  recordedBudgetCents: number;
  purchasedSpendCents: number | null;
  travelMinutes: number;
  sampleCarbonSavedKg: number;
  onTimeRate: number | null;
  notice: string;
  operatorPerformance: { operator: string; sampleSize: number; onTimeRate: number | null }[];
}
export default function Trips() {
  const { journeys, setActive, navigate, refresh, notify, openAgent } = useApp();
  const [filter, setFilter] = useState("all"),
    [q, setQ] = useState(""),
    [analytics, setAnalytics] = useState<Analytics | null>(null),
    [remove, setRemove] = useState<Journey | null>(null);
  const { busy, error, run } = useAsync();
  useEffect(() => {
    void api<Analytics>("/analytics")
      .then(setAnalytics)
      .catch(() => {});
  }, [journeys.length]);
  const filtered = journeys.filter(
    (j) =>
      (filter === "all" ||
        (filter === "past"
          ? ["ARRIVED", "CANCELLED"].includes(j.state ?? "")
          : !["ARRIVED", "CANCELLED"].includes(j.state ?? ""))) &&
      `${j.from} ${j.to}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>

          <h1>My journeys</h1>
          <p>Manage your itineraries, travel plans and journey history.</p>
        </div>
        <Button kind="primary" icon="plus" onClick={() => navigate("plan")}>
          Plan a journey
        </Button>
      </div>
      <div className="stats-grid">
        <div>
          <Icon name="route" />
          <strong>{analytics?.planned ?? journeys.length}</strong>
          <span>saved journeys</span>
        </div>
        <div>
          <Icon name="check" />
          <strong>{analytics?.completed ?? 0}</strong>
          <span>marked complete</span>
        </div>
        <div>
          <Icon name="ticket" />
          <strong>{journeys.some(j => j.price.totalCents == null) ? "Incomplete" : money(analytics?.recordedBudgetCents ?? 0)}</strong>
          <span>{journeys.some(j => j.price.totalCents == null) ? "Some route fares are unavailable" : "planned cost · includes samples"}</span>
        </div>
        <div>
          <Icon name="leaf" />
          <strong>
            {analytics?.sampleCarbonSavedKg ?? 0} <small>kg</small>
          </strong>
          <span>illustrative CO₂ savings</span>
        </div>
      </div>
      <div className="section-title">
        <div className="view-tabs">
          {["all", "upcoming", "past"].map((x) => (
            <button key={x} className={filter === x ? "active" : ""} onClick={() => setFilter(x)}>
              {readable(x)}
            </button>
          ))}
        </div>
        <div className="input-with-icon compact-input">
          <Icon name="search" size={17} />
          <input
            aria-label="Filter journey history"
            placeholder="Find a place"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {filtered[0] && <SavedJourneyFeature journey={filtered[0]} open={() => { setActive(filtered[0]); navigate("journey"); }} assistant={() => { setActive(filtered[0]); openAgent(); }} />}
<div className="trip-list">
        {filtered.map((j) => (
          <article className="trip-row" key={j.id}>
            <div className="trip-date">
              <b>{new Date(j.departure).getDate()}</b>
              <small>{new Date(j.departure).toLocaleDateString("en-US", { month: "short" })}</small>
            </div>
            <div className="trip-row-main">
              <div className="button-row">
                <Badge tone={j.state === "ARRIVED" ? "mint" : ""}>
                  {readable(j.state ?? "planned")}
                </Badge>
                {j.dataMode === "illustrative" && <Badge tone="amber">SAMPLE</Badge>}
                {j.privateTrip && <Icon name="lock" size={14} />}
              </div>
              <h3>
                {j.from} <span>→</span> {j.to}
              </h3>
              <p>
                {time(j.departure, j.timezone)} · {duration(j.durationMinutes)} · {j.transfers}{" "}
                transfer{j.transfers === 1 ? "" : "s"}
              </p>
            </div>
            <strong>{money(j.price.totalCents)}</strong>
            <Button
              icon="arrow"
              onClick={() => {
                setActive(j);
                navigate("journey");
              }}
            >
              Open
            </Button>
            <Button
              icon="trash"
              title="Delete saved journey"
              kind="icon-only"
              onClick={() => setRemove(j)}
            />
          </article>
        ))}
      </div>
      {!filtered.length && (
        <Empty
          icon="route"
          title={q ? "No journeys match your search" : "No saved journeys yet"}
          action={<Button onClick={() => navigate("plan")}>Explore routes</Button>}
        >
          Your saved trips will appear here.
        </Empty>
      )}
      <div className="two-columns">
        <Section title="Your travel record">
          <p>{analytics?.notice ?? "Only saved activity appears here."}</p>
          <div className="key-values">
            <div>
              <span>Completed travel time</span>
              <b>{duration(analytics?.travelMinutes ?? 0)}</b>
            </div>
            <div>
              <span>Carrier-confirmed spending</span>
              <b>Not connected</b>
            </div>
            <div>
              <span>Observed on-time rate</span>
              <b>Not enough evidence</b>
            </div>
          </div>
          <Button
            icon="download"
            onClick={() => download("wayline-journey-history.json", journeys)}
          >
            Export history
          </Button>
        </Section>
        <Section title="Operator performance">
          <p>
            Reliability needs observed arrivals. Sample scores are excluded from these statistics.
          </p>
          {analytics?.operatorPerformance.length ? (
            analytics.operatorPerformance.map((o) => (
              <div className="key-values" key={o.operator}>
                <div>
                  <span>{o.operator}</span>
                  <b>{o.sampleSize} saved schedules</b>
                </div>
                <small>No observed on-time rate yet</small>
              </div>
            ))
          ) : (
            <div className="quiet-empty">No observed operator performance yet.</div>
          )}
        </Section>
      </div>
      {remove && (
        <Modal title="Delete this journey?" onClose={() => setRemove(null)}>
          <p>
            Its saved history, linked tickets, claim drafts and sharing links will be removed.
            Carrier reservations are unaffected.
          </p>
          <Button
            kind="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api(`/journeys/${remove.id}`, "DELETE");
                setRemove(null);
                await refresh();
                notify("Journey and linked records deleted.");
              })
            }
          >
            Delete saved journey
          </Button>
        </Modal>
      )}
    </>
  );
}
