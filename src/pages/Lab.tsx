import { useEffect, useState } from "react";
import { useApp } from "../context";
import { api, readable } from "../api";
import type { Agency } from "../types";
import { Button, Icon, Badge, Field, Notice, Empty, Section, useAsync } from "../components/ui";
import { JourneyMap } from "../components/JourneyMap";
interface FeedVehicle {
  id: string;
  vehicleId?: string;
  routeId?: string;
  lat: number;
  lon: number;
  occupancy: string;
  tracking: { source: string; observedAt: string | null; ageSeconds?: number | null };
}
interface Health {
  name: string;
  status: string;
  lastSuccess: string | null;
}
export default function Lab() {
  const { boot, active } = useApp();
  const [tab, setTab] = useState("coverage"),
    [q, setQ] = useState(""),
    [state, setState] = useState("all"),
    [agencies, setAgencies] = useState<Agency[]>([]),
    [health, setHealth] = useState<Health[]>([]),
    [vehicles, setVehicles] = useState<FeedVehicle[]>([]),
    [lastFetch, setLastFetch] = useState(""),
    [vehiclesCoverageLimited, setVehiclesCoverageLimited] = useState(false),
    [feedAlerts, setFeedAlerts] = useState<
      { id: string; header: string; description: string; effect: string; updatedAt: string }[]
    >([]),
    [gbfs, setGbfs] = useState<{
      stations: {
        station_id: string;
        name: string | { text: string }[];
        num_bikes_available?: number;
        num_vehicles_available?: number;
        num_docks_available?: number;
      }[];
      version: string;
    } | null>(null),
    [weather, setWeather] = useState<{
      current: Record<string, number | string>;
      source: string;
    } | null>(null),
    [operator, setOperator] = useState<{
      dataQualityReports: { type: string; reports: number; distinctContributors: number }[];
      suppressedTypes: string[];
      minimumCohort: number;
      windowHours: number;
      notice: string;
    } | null>(null),
    [operatorReports, setOperatorReports] = useState<
      {
        id: string;
        type: string;
        station: string;
        service: string;
        note: string;
        status: string;
        confirmations: number;
        observedAt: string;
      }[]
    >([]),
    [moderating, setModerating] = useState<Record<string, string>>({});
  const { busy, error, run } = useAsync();
  const loadOperatorReports = async () => setOperatorReports(await api("/operator/reports"));
  const moderate = (id: string, status: string) =>
    run(async () => {
      await api(`/operator/reports/${id}`, "PATCH", {
        status,
        resolutionNote: moderating[id] ?? null,
      });
      await loadOperatorReports();
    });
  const load = async () => {
    const d = await api<{ agencies: Agency[]; health: Health[] }>(
      `/registry?state=${encodeURIComponent(state)}&q=${encodeURIComponent(q)}`,
    );
    setAgencies(d.agencies);
    setHealth(d.health);
  };
  useEffect(() => {
    void run(load);
  }, [state]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">KNOW WHAT’S BEHIND THE ETA</span>
          <h1>Open Transit Lab</h1>
          <p>Sources, coverage and freshness. Always visible.</p>
        </div>
        <Badge>LIVE FEEDS ≠ NATIONWIDE COVERAGE</Badge>
      </div>
      <div className="view-tabs scroll-tabs">
        {[
          "coverage",
          "vehicles",
          "alerts",
          "micromobility",
          "weather",
          "integrations",
          "operator",
        ].map((x) => (
          <button key={x} className={tab === x ? "active" : ""} onClick={() => setTab(x)}>
            {readable(x)}
          </button>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {tab === "coverage" && (
        <>
          <Notice>
            Curated discovery seed covering all 50 states and DC. This is not a complete list of
            U.S. transit agencies. Unverified fields are not claims of service coverage.
          </Notice>
          <form
            className="lab-filters"
            onSubmit={(e) => {
              e.preventDefault();
              void run(load);
            }}
          >
            <Field label="Search agencies or cities">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Try Boston, Amtrak, IndyGo…"
              />
            </Field>
            <Field label="State">
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="all">All states</option>
                <option value="US">National / intercity</option>
                {boot.states.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" icon="search" disabled={busy}>
              Search registry
            </Button>
          </form>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agency</th>
                  <th>Region</th>
                  <th>Vehicle positions</th>
                  <th>Trip updates</th>
                  <th>Alerts</th>
                  <th>Ticketing</th>
                </tr>
              </thead>
              <tbody>
                {agencies.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <b>{a.name}</b>
                      <small>{a.city}</small>
                    </td>
                    <td>{a.state}</td>
                    <td>
                      <Badge tone={a.vehiclePositions === "adapter available" ? "mint" : ""}>
                        {a.vehiclePositions}
                      </Badge>
                    </td>
                    <td>{a.tripUpdates}</td>
                    <td>{a.alerts}</td>
                    <td>{a.ticketing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!agencies.length && (
            <Empty icon="globe" title="No matching agency in this seed">
              Try another state or search term.
            </Empty>
          )}
        </>
      )}
      {tab === "vehicles" && (
        <>
          <div className="section-title">
            <div>
              <h2>Boston · MBTA vehicle feed</h2>
              <p>Positions from the official provider, separate from sample journeys.</p>
            </div>
            <Button
              kind="primary"
              icon="refresh"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const d = await api<{
                    vehicles: FeedVehicle[];
                    fetchedAt: string;
                    warning?: string;
                    coverageLimited?: boolean;
                  }>("/mbta/vehicles");
                  setVehicles(d.vehicles);
                  setLastFetch(d.fetchedAt);
                  setVehiclesCoverageLimited(Boolean(d.coverageLimited));
                  if (d.warning) throw new Error(d.warning);
                })
              }
            >
              Refresh vehicle feed
            </Button>
          </div>
          <JourneyMap vehicles={vehicles} />
          {lastFetch && <p>Last successful fetch: {new Date(lastFetch).toLocaleString()}</p>}
          {vehiclesCoverageLimited && (
            <Notice tone="amber">
              This feed hit its page limit; some active vehicles may be missing from the list below.
            </Notice>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Route</th>
                  <th>Position source</th>
                  <th>Observed</th>
                  <th>Occupancy</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.slice(0, 30).map((v) => {
                  const seconds = v.tracking.observedAt
                    ? Math.round((Date.now() - Date.parse(v.tracking.observedAt)) / 1000)
                    : null;
                  return (
                    <tr key={v.id}>
                      <td>{v.vehicleId ?? v.id}</td>
                      <td>{v.routeId ?? "Unknown"}</td>
                      <td>
                        <Badge tone={seconds !== null && seconds < 90 ? "mint" : "amber"}>
                          {seconds !== null && seconds < 90 ? "Live GPS" : "Stale · estimate"}
                        </Badge>
                      </td>
                      <td>
                        {seconds === null ? "Unknown" : `${Math.max(0, seconds)} seconds ago`}
                      </td>
                      <td>{readable(v.occupancy)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!vehicles.length && (
            <Empty icon="bus" title="Check the actual feed">
              Refresh to request current MBTA positions. A failed request never produces simulated
              vehicles.
            </Empty>
          )}
        </>
      )}
      {tab === "alerts" && (
        <>
          <div className="section-title">
            <h2>MBTA service alerts</h2>
            <Button
              icon="refresh"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const d = await api<{ alerts: typeof feedAlerts }>("/mbta/alerts");
                  setFeedAlerts(d.alerts);
                })
              }
            >
              Load agency alerts
            </Button>
          </div>
          <Notice>
            Agency-wide notices are not automatically treated as affecting your saved journey.
          </Notice>
          <div className="stack">
            {feedAlerts.map((a) => (
              <Section
                title={a.header || "Service notice"}
                key={a.id}
                action={<Badge>{a.effect}</Badge>}
              >
                <p>{a.description}</p>
                <small>Source: MBTA · updated {new Date(a.updatedAt).toLocaleString()}</small>
              </Section>
            ))}
          </div>
        </>
      )}
      {tab === "micromobility" && (
        <Section
          title="Bikes and scooters nearby"
          action={
            <Button
              icon="refresh"
              disabled={busy}
              onClick={() => void run(async () => setGbfs(await api("/gbfs")))}
            >
              Check connected GBFS feed
            </Button>
          }
        >
          <p>Docked bikes, scooters and vehicle availability from your configured GBFS system.</p>
          {gbfs ? (
            <>
              <Badge>GBFS {gbfs.version}</Badge>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Station</th>
                      <th>Vehicles available</th>
                      <th>Docks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gbfs.stations.slice(0, 40).map((s) => (
                      <tr key={s.station_id}>
                        <td>
                          {typeof s.name === "string"
                            ? s.name
                            : (s.name?.[0]?.text ?? s.station_id)}
                        </td>
                        <td>{s.num_vehicles_available ?? s.num_bikes_available ?? "Unknown"}</td>
                        <td>{s.num_docks_available ?? "Unknown"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <Empty icon="bike" title="Connect your local shared mobility system">
              Availability and unlocks depend on your operator. No scooter or bike has been
              reserved.
            </Empty>
          )}
        </Section>
      )}
      {tab === "weather" && (
        <Section
          title="Plan for the weather"
          action={
            <Button
              icon="refresh"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const city = boot.cities.find((c) => c.id === active?.fromId) ?? boot.cities[0];
                  setWeather(await api(`/weather?lat=${city.lat}&lon=${city.lon}`));
                })
              }
            >
              Check origin weather
            </Button>
          }
        >
          <p>
            Current conditions at {active?.from ?? "Los Angeles"}. Forecasts describe weather, not
            transit operating status.
          </p>
          {weather && (
            <>
              <div className="stats-grid compact-stats">
                <div>
                  <Icon name="sun" />
                  <strong>{weather.current.temperature_2m}°C</strong>
                  <span>temperature</span>
                </div>
                <div>
                  <Icon name="globe" />
                  <strong>{weather.current.precipitation} mm</strong>
                  <span>precipitation</span>
                </div>
                <div>
                  <Icon name="clock" />
                  <strong>{weather.current.snowfall} cm</strong>
                  <span>snowfall</span>
                </div>
              </div>
              <small>
                {weather.source} · {weather.current.time} UTC
              </small>
            </>
          )}
          <Notice>
            Use the Guardian weather scenario to assess larger connection buffers. Covered transfers
            and reduced outdoor waits still need verified station data.
          </Notice>
        </Section>
      )}
      {tab === "integrations" && (
        <>
          <Section title="Service health">
            <div className="health-grid">
              {health.map((h, i) => (
                <div className="health-card" key={i}>
                  <Icon name="wifi" />
                  <h3>{h.name}</h3>
                  <Badge tone={h.status === "connected" ? "mint" : ""}>{h.status}</Badge>
                  <small>
                    {h.lastSuccess
                      ? `Last success: ${new Date(h.lastSuccess).toLocaleString()}`
                      : "No successful sync recorded"}
                  </small>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Capabilities requiring a connection">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Capability</th>
                    <th>Status</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {boot.capabilities.map((c) => (
                    <tr key={c.id}>
                      <td>{readable(c.id)}</td>
                      <td>
                        <Badge>{c.status}</Badge>
                      </td>
                      <td>
                        <small>{c.reason}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
      {tab === "operator" && (
        <Section title="Operator overview">
          <Notice>
            Requires an operator account configured by the deployment owner. Each report type below
            is only shown once at least {operator?.minimumCohort ?? 5} distinct accounts have filed
            it in the window -- not a single blanket count, and not just a raw report tally that one
            account could inflate.
          </Notice>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setOperator(await api("/operator"));
                await loadOperatorReports();
              })
            }
          >
            Load operator overview
          </Button>
          {operator && (
            <>
              <div className="stats-grid compact-stats">
                {operator.dataQualityReports.length === 0 && (
                  <div>
                    <strong>Suppressed</strong>
                    <span>no report type has reached the cohort threshold yet</span>
                  </div>
                )}
                {operator.dataQualityReports.map((r) => (
                  <div key={r.type}>
                    <strong>{r.reports}</strong>
                    <span>
                      {readable(r.type)} · {r.distinctContributors} distinct contributors
                    </span>
                  </div>
                ))}
              </div>
              {operator.suppressedTypes.length > 0 && (
                <p className="fine-print">
                  Also reported, but below the cohort threshold to disclose a count:{" "}
                  {operator.suppressedTypes.map(readable).join(", ")}.
                </p>
              )}
              <p>{operator.notice}</p>
              <h3>Open moderation worklist</h3>
              <p className="fine-print">
                Every open/reviewing report is actionable here regardless of cohort size -- an
                elevator report from one rider is still a real maintenance ticket. The reporter's
                identity is never included.
              </p>
              {!operatorReports.length && (
                <Empty title="Nothing to moderate">No open or in-review reports right now.</Empty>
              )}
              {operatorReports.map((r) => (
                <div key={r.id} className="option-card">
                  <div>
                    <Badge>{readable(r.type)}</Badge>
                    <h3>{r.station}</h3>
                    <p>
                      {r.service ? `${r.service} · ` : ""}
                      {r.note || "No additional detail provided."}
                    </p>
                    <small>
                      {r.confirmations} other rider{r.confirmations === 1 ? "" : "s"} reported the
                      same thing recently · status: {r.status}
                    </small>
                  </div>
                  <Field label="Resolution note (optional)">
                    <textarea
                      maxLength={500}
                      value={moderating[r.id] ?? ""}
                      onChange={(e) => setModerating((m) => ({ ...m, [r.id]: e.target.value }))}
                    />
                  </Field>
                  <div className="button-row">
                    <Button disabled={busy} onClick={() => void moderate(r.id, "reviewing")}>
                      Mark reviewing
                    </Button>
                    <Button
                      kind="primary"
                      disabled={busy}
                      onClick={() => void moderate(r.id, "resolved")}
                    >
                      Resolve
                    </Button>
                    <Button disabled={busy} onClick={() => void moderate(r.id, "dismissed")}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}
        </Section>
      )}
    </>
  );
}
