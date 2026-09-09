import { useEffect, useRef, useState } from "react";
import { useApp } from "../context";
import { useT } from "../useT";
import { api, money, duration, dateLabel, time, localInput } from "../api";
import type { Journey, SearchInput, SearchResult, SavedItem } from "../types";
import {
  Button,
  Icon,
  Badge,
  Field,
  Notice,
  Toggle,
  Empty,
  Modal,
  useAsync,
} from "../components/ui";
import { JourneyMap } from "../components/JourneyMap";
import { JourneyCard } from "../components/JourneyCard";
export default function Planner() {
  const {
    boot,
    result,
    setResult,
    searchInput,
    setSearchInput,
    setActive,
    active,
    navigate,
    refresh,
    notify,
    openAgent,
  } = useApp();
  const { t, locale, localeTag } = useT();
  const { busy, error, run } = useAsync();
  const [filters, setFilters] = useState(false),
    [special, setSpecial] = useState<"airport" | "group" | null>(null);
  const [shortcuts, setShortcuts] = useState<SavedItem[]>([]);
  const started = useRef(false);
  const [prompt, setPrompt] = useState("");
  const [privateTrip, setPrivateTrip] = useState(false);
  const selected = result?.journeys.find((j) => j.id === active?.id) ?? result?.journeys[0];
  const search = async (input = searchInput) => {
    const data = await api<SearchResult>("/search", "POST", input);
    setResult(data);
    setActive(data.journeys[0] ?? null);
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void api<SavedItem[]>("/records/favorite")
      .then(setShortcuts)
      .catch(() => {});
    if (!result) void run(() => search());
  }, []);
  const update = <K extends keyof SearchInput>(k: K, v: SearchInput[K]) =>
    setSearchInput((s) => ({ ...s, [k]: v }));
  const preference = (k: string, v: unknown) =>
    setSearchInput((s) => ({ ...s, preferences: { ...s.preferences, [k]: v } }));
  const save = () =>
    run(async () => {
      if (!selected || !result) return;
      const saved = await api<Journey>(
        "/journeys",
        "POST",
        { searchId: result.searchId, journeyId: selected.id, private: privateTrip },
        { "idempotency-key": crypto.randomUUID() },
      );
      await refresh();
      setActive(saved);
      notify(t("planner.savedNotify"));
      navigate("journey");
    });
  const favorite = () =>
    run(async () => {
      const from = boot.cities.find((c) => c.id === searchInput.from)?.name,
        to = boot.cities.find((c) => c.id === searchInput.to)?.name;
      await api("/records/favorite", "POST", {
        name: `${from} → ${to}`,
        from: searchInput.from,
        to: searchInput.to,
      });
      setShortcuts(await api("/records/favorite"));
      notify(t("planner.shortcutSaved"));
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR NEXT CHAPTER</span>
          <h1>{t("planner.heading")}</h1>
          <p>{t("planner.subheading")}</p>
        </div>
        <Badge tone="mint">
          <Icon name="spark" size={15} /> {t("planner.assistantBadge")}
        </Badge>
      </div>
      <div className="planner-panel">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => search());
          }}
        >
          <div className="location-row">
            <Field label={t("planner.from")}>
              <div className="input-with-icon">
                <Icon name="route" />
                <select value={searchInput.from} onChange={(e) => update("from", e.target.value)}>
                  {boot.cities.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}, {c.state}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Button
              icon="swap"
              title={t("planner.swapTitle")}
              kind="swap icon-only"
              onClick={() => setSearchInput((s) => ({ ...s, from: s.to, to: s.from }))}
            />
            <Field label={t("planner.to")}>
              <div className="input-with-icon">
                <Icon name="pin" />
                <select value={searchInput.to} onChange={(e) => update("to", e.target.value)}>
                  {boot.cities.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}, {c.state}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label={t("planner.departureLabel")}>
              <input
                type="datetime-local"
                required
                value={localInput(new Date(searchInput.departure))}
                onChange={(e) => {
                  if (e.target.value) update("departure", new Date(e.target.value).toISOString());
                }}
              />
            </Field>
            <Button kind="primary search-button" type="submit" icon="search" disabled={busy}>
              {busy ? t("planner.searching") : t("planner.findJourneys")}
            </Button>
          </div>
          <div className="planner-options">
            <Field label={t("planner.travelers")}>
              <select
                value={searchInput.travelers}
                onChange={(e) => update("travelers", +e.target.value)}
              >
                {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                  <option key={n} value={n}>
                    {n === 1
                      ? t("planner.travelerCountOne", { n })
                      : t("planner.travelerCountMany", { n })}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("planner.totalBudget")}>
              <div className="input-with-icon">
                <span>$</span>
                <input
                  type="number"
                  min="0"
                  max="10000"
                  step="0.01"
                  value={searchInput.preferences.budgetCents / 100}
                  onChange={(e) => preference("budgetCents", Math.round(+e.target.value * 100))}
                />
              </div>
            </Field>
            <Field label={t("planner.schedules")}>
              <select value={searchInput.mode} onChange={(e) => update("mode", e.target.value)}>
                <option value="sample">{t("planner.sampleRoutes")}</option>
                <option value="provider">{t("planner.connectedSchedules")}</option>
              </select>
            </Field>
            <div className="option-buttons">
              <Button icon="filter" onClick={() => setFilters(!filters)}>
                {filters ? t("planner.hidePreferences") : t("planner.tripPreferences")}
              </Button>
              <Button icon="calendar" onClick={() => setSpecial("airport")}>
                {t("planner.airportDeadline")}
              </Button>
              <Button icon="user" onClick={() => setSpecial("group")}>
                {t("planner.meetTogether")}
              </Button>
            </div>
          </div>
          {filters && (
            <div className="filters">
              <div className="form-grid">
                <Field label={t("planner.arriveByLabel")}>
                  <input
                    type="datetime-local"
                    value={searchInput.deadline ? localInput(new Date(searchInput.deadline)) : ""}
                    onChange={(e) =>
                      update(
                        "deadline",
                        e.target.value ? new Date(e.target.value).toISOString() : undefined,
                      )
                    }
                  />
                </Field>
                <Field label={t("planner.tripImportance")}>
                  <select
                    value={searchInput.preferences.importance}
                    onChange={(e) => preference("importance", e.target.value)}
                  >
                    {["casual", "normal", "important", "critical"].map((x) => (
                      <option key={x} value={x}>
                        {t(`planner.importance.${x}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("planner.maxTransfers")}>
                  <input
                    type="number"
                    min="0"
                    max="8"
                    value={searchInput.preferences.maxTransfers}
                    onChange={(e) => preference("maxTransfers", +e.target.value)}
                  />
                </Field>
                <Field label={t("planner.maxWalking")}>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={searchInput.preferences.maxWalkMinutes}
                    onChange={(e) => preference("maxWalkMinutes", +e.target.value)}
                  />
                </Field>
                <Field label={t("planner.connectionBuffer")}>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={searchInput.preferences.minConnectionMinutes}
                    onChange={(e) => preference("minConnectionMinutes", +e.target.value)}
                  />
                </Field>
                <Field label={t("planner.extraBags")}>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={searchInput.bags}
                    onChange={(e) => update("bags", +e.target.value)}
                  />
                </Field>
                <Field label={t("planner.riskTolerance")}>
                  <select
                    value={searchInput.preferences.riskTolerance}
                    onChange={(e) => preference("riskTolerance", e.target.value)}
                  >
                    {["conservative", "balanced", "aggressive"].map((x) => (
                      <option key={x} value={x}>
                        {t(`planner.risk.${x}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("planner.weatherScenario")}>
                  <select
                    value={searchInput.weather ?? "clear"}
                    onChange={(e) => update("weather", e.target.value)}
                  >
                    {["clear", "rain", "snow", "heat"].map((x) => (
                      <option key={x} value={x}>
                        {t(`planner.weather.${x}`)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="toggle-grid">
                {(
                  [
                    ["stepFree", "planner.stepFreeRoute"],
                    ["lessCrowded", "planner.preferMoreSpace"],
                    ["avoidBus", "planner.avoidBuses"],
                    ["preferTrain", "planner.preferTrains"],
                  ] as const
                ).map(([key, labelKey]) => (
                  <Toggle
                    key={key}
                    label={t(labelKey)}
                    checked={searchInput.preferences[key]}
                    onChange={(v) => preference(key, v)}
                  />
                ))}
              </div>
              <Toggle
                label={t("planner.elevatorOutage")}
                description={t("planner.elevatorOutageDesc")}
                checked={Boolean(searchInput.accessibilityOutage)}
                onChange={(v) => update("accessibilityOutage", v)}
              />
            </div>
          )}
        </form>
        <form
          className="prompt-bar"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim()) openAgent(prompt);
          }}
        >
          <Icon name="spark" />
          <input
            aria-label={t("planner.askAria")}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("planner.askPlaceholder")}
          />
          <Button type="submit" kind="icon-only" icon="arrow" title={t("planner.askAria")} />
        </form>
      </div>
      <div className="shortcuts">
        <span>{t("planner.quickRoutes")}</span>
        {shortcuts.slice(0, 4).map((s) => (
          <Button
            key={s.id}
            icon="heart"
            kind="small"
            onClick={() => {
              const next = { ...searchInput, from: s.from!, to: s.to! };
              setSearchInput(next);
              void run(() => search(next));
            }}
          >
            {s.name}
          </Button>
        ))}
        <Button icon="plus" kind="small subtle" onClick={() => void favorite()}>
          {t("planner.saveRoute")}
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {result?.warning && <Notice tone="amber">{result.warning}</Notice>}
      <div className="results-layout">
        <section>
          <div className="section-title">
            <div>
              <span className="eyebrow">{t("planner.findEyebrow")}</span>
              <h2>
                {result
                  ? t("planner.waysToGetThere", { n: result.journeys.length })
                  : t("planner.findingJourney")}
              </h2>
            </div>
            <small>
              {result?.journeys[0] &&
                dateLabel(result.journeys[0].departure, result.journeys[0].timezone)}
            </small>
          </div>
          <div className="sort-tabs" aria-label="Sort journeys">
            {[
              ["balanced", "planner.sort.balanced"],
              ["price", "planner.sort.price"],
              ["fastest", "planner.sort.fastest"],
              ["reliable", "planner.sort.reliable"],
            ].map(([value, labelKey]) => (
              <button
                key={value}
                className={searchInput.preferences.priority === value ? "active" : ""}
                aria-pressed={searchInput.preferences.priority === value}
                onClick={() => {
                  const next = {
                    ...searchInput,
                    preferences: { ...searchInput.preferences, priority: value },
                  };
                  setSearchInput(next);
                  void run(() => search(next));
                }}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
          {result?.dataMode === "illustrative" && (
            <div className="sample-note">
              <Icon name="info" size={14} /> {t("planner.sampleNote")}
            </div>
          )}
          <div className={busy ? "results-loading" : ""}>
            {result?.journeys.map((j, i) => (
              <JourneyCard
                key={j.id}
                journey={j}
                rank={i}
                selected={selected?.id === j.id}
                onSelect={() => setActive(j)}
              />
            ))}
          </div>
          {result && !result.journeys.length && (
            <Empty icon="search" title={t("planner.noRouteTitle")}>
              {result.reason}
            </Empty>
          )}
          {!!result?.excluded.length && (
            <details className="excluded">
              <summary>{t("planner.excludedCount", { n: result.excluded.length })}</summary>
              {result.excluded.map((r, i) => (
                <p key={i}>
                  <b>{r.name}</b> — {r.reason}
                </p>
              ))}
            </details>
          )}
        </section>
        <aside className="route-aside">
          {selected ? (
            <>
              <JourneyMap journey={selected} />
              <div className="selected-detail">
                <div className="section-title">
                  <h2>{t("planner.glanceTitle")}</h2>
                  <Icon name="route" />
                </div>
                <div className="detail-metrics">
                  <div>
                    <span>{duration(selected.durationMinutes)}</span>
                    <small>{t("planner.doorToDoor")}</small>
                  </div>
                  <div>
                    <span>{selected.transfers}</span>
                    <small>{t("planner.connections")}</small>
                  </div>
                  <div>
                    <span>{selected.reliability == null ? "—" : selected.reliability + "%"}</span>
                    <small>{t("planner.sampleReliability")}</small>
                  </div>
                </div>
                <div className="mini-timeline">
                  {selected.legs.map((l) => (
                    <div key={l.id}>
                      <i className={`timeline-dot mode-${l.mode}`} />
                      <div>
                        <b>{l.service}</b>
                        <small>
                          {l.from} → {l.to}
                        </small>
                      </div>
                      <span>{time(l.departure, selected.timezone)}</span>
                    </div>
                  ))}
                </div>
                <div className="price-breakdown">
                  {selected.price.items.map((item) => (
                    <div key={item.label}>
                      <span>{item.label}</span>
                      <b>{money(item.cents, localeTag, t("planner.fareUnknown"))}</b>
                    </div>
                  ))}
                  <div className="price-total">
                    <span>{t("planner.doorToDoorTotal")}</span>
                    <b>{money(selected.price.totalCents, localeTag, t("planner.fareUnknown"))}</b>
                  </div>
                </div>
                <Toggle
                  label={t("planner.privateTrip")}
                  description={t("planner.privateTripDesc")}
                  checked={privateTrip}
                  onChange={setPrivateTrip}
                />
                <Button
                  kind="primary full"
                  onClick={() => void save()}
                  disabled={busy}
                  icon="shield"
                >
                  {t("planner.saveAndFollow")}
                </Button>
                <p className="fine-print">{t("planner.savePlansTrip")}</p>
              </div>
            </>
          ) : (
            <div className="panel">
              <Empty title={t("planner.willAppearTitle")}>{t("planner.willAppearBody")}</Empty>
            </div>
          )}
        </aside>
      </div>
      {special === "airport" && (
        <AirportModal
          close={() => setSpecial(null)}
          apply={(deadline) => {
            update("deadline", deadline);
            preference("importance", "critical");
            setFilters(true);
            setSpecial(null);
            notify(t("planner.airportApplied"));
          }}
        />
      )}
      {special === "group" && <GroupModal close={() => setSpecial(null)} />}
    </>
  );
}
function AirportModal({ close, apply }: { close: () => void; apply: (d: string) => void }) {
  const { t } = useT();
  const [flight, setFlight] = useState(localInput(new Date(Date.now() + 86400000))),
    [international, setInternational] = useState(false),
    [bags, setBags] = useState(false),
    [terminal, setTerminal] = useState(20);
  const { busy, error, run } = useAsync();
  return (
    <Modal title={t("planner.airportTitle")} onClose={close}>
      <p>{t("planner.airportIntro")}</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const d = await api<{ arrivalDeadline: string }>("/airport/deadline", "POST", {
              flightDeparture: new Date(flight).toISOString(),
              international,
              checkedBags: bags,
              terminalMinutes: terminal,
            });
            apply(d.arrivalDeadline);
          });
        }}
      >
        <Field label={t("planner.flightDepartureLabel")}>
          <input
            required
            type="datetime-local"
            value={flight}
            onChange={(e) => setFlight(e.target.value)}
          />
        </Field>
        <Field label={t("planner.terminalAllowanceLabel")}>
          <input
            type="number"
            min="0"
            max="180"
            value={terminal}
            onChange={(e) => setTerminal(+e.target.value)}
          />
        </Field>
        <Toggle
          label={t("planner.internationalFlight")}
          checked={international}
          onChange={setInternational}
        />
        <Toggle label={t("planner.checkingBaggage")} checked={bags} onChange={setBags} />
        <Notice>
          {t("planner.airportNotice", {
            minutes: international ? 180 : 120,
            baggage: bags ? t("planner.baggageExtra") : "",
          })}
        </Notice>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" kind="primary" disabled={busy}>
          {t("planner.applyDeadline")}
        </Button>
      </form>
    </Modal>
  );
}
function GroupModal({ close }: { close: () => void }) {
  const { boot, searchInput, setSearchInput, notify } = useApp();
  const { t } = useT();
  const [origins, setOrigins] = useState([searchInput.from, searchInput.from]);
  const [result, setResult] = useState<{ city: string; minutes: number; perPerson: number[] }[]>(
    [],
  );
  return (
    <Modal title={t("planner.groupTitle")} onClose={close}>
      <p>{t("planner.groupIntro")}</p>
      <div className="stack">
        {origins.map((v, i) => (
          <Field key={i} label={t("planner.travelerStartsIn", { n: i + 1 })}>
            <select
              value={v}
              onChange={(e) =>
                setOrigins((list) => list.map((x, n) => (n === i ? e.target.value : x)))
              }
            >
              {boot.cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        ))}
        <div className="button-row">
          <Button
            icon="plus"
            disabled={origins.length >= 6}
            onClick={() => setOrigins([...origins, searchInput.from])}
          >
            {t("planner.addTraveler")}
          </Button>
          <Button
            kind="primary"
            onClick={() => {
              const coordinates = origins.map((id) => boot.cities.find((c) => c.id === id)!);
              const estimates = boot.cities
                .map((c) => {
                  const perPerson = coordinates.map(
                    (o) =>
                      Math.round(
                        (Math.hypot(
                          (o.lat - c.lat) * 111,
                          (o.lon - c.lon) * 111 * Math.cos((c.lat * Math.PI) / 180),
                        ) /
                          45) *
                          60,
                      ) + 15,
                  );
                  return { city: c.id, minutes: Math.max(...perPerson), perPerson };
                })
                .sort((a, b) => a.minutes - b.minutes);
              setResult(estimates.slice(0, 3));
            }}
          >
            {t("planner.compareMeetingPoints")}
          </Button>
        </div>
        {result.map((r, i) => (
          <div className="option-card" key={r.city}>
            <div>
              <Badge>{i === 0 ? t("planner.shortestApproach") : t("planner.alternative")}</Badge>
              <h3>{boot.cities.find((c) => c.id === r.city)?.station}</h3>
              <p>
                {r.perPerson
                  .map((m, n) => t("planner.personEstimate", { n: n + 1, duration: duration(m) }))
                  .join(" · ")}
              </p>
            </div>
            <Button
              onClick={() => {
                setSearchInput((s) => ({ ...s, from: r.city, travelers: origins.length }));
                close();
                notify(t("planner.meetingApplied"));
              }}
            >
              {t("planner.useStation")}
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
