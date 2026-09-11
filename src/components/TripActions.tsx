import { useEffect, useState } from "react";
import { api, dateLabel, time, money, localInput } from "../api";
import { useApp } from "../context";
import type { Journey, PendingAction, Recovery, SearchResult, Place, User } from "../types";
import { Button, Badge, Notice, Modal, Field, Toggle, useAsync } from "./ui";
import { PlacePicker } from "./PlacePicker";
export function RouteSummary({ journey: j }: { journey: Journey }) {
  return (
    <div className="route-summary">
      <b>
        {j.from} → {j.to}
      </b>
      <p>
        {dateLabel(j.departure, j.timezone)} · {time(j.departure, j.timezone)}–
        {time(j.arrival, j.destinationTimezone)} <small>{j.timezone}</small>
      </p>
      <div className="route-facts">
        <span>{j.durationMinutes} min</span>
        <span>{j.walkMinutes} min walk</span>
        <span>{j.transfers} transfers</span>
        <span>{money(j.price.totalCents)}</span>
      </div>
      <small>{j.legs.map((l) => (l.mode === "walk" ? "Walk" : l.service)).join(" → ")}</small>
      {j.dataMode === "illustrative" && <Badge tone="amber">SAMPLE</Badge>}
    </div>
  );
}
export function ActionReview({
  action: initialAction,
  onApplied,
}: {
  action: PendingAction;
  onApplied?: (journey: Journey) => void;
}) {
  const { setActive, refresh, notify } = useApp();
  const [action,setAction]=useState(initialAction);
  const { busy, error, run } = useAsync();
  const [done, setDone] = useState(action.status === "applied");
  const expired = action.expiresAt <= Date.now();
  const c = action.candidate,
    b = action.before;
  return (
    <div className="action-review">
      <div className="section-title">
        <h3>{done ? "Journey updated" : "Review " + action.kind + " trip"}</h3>
        <Badge tone={done ? "mint" : "amber"}>{done ? "Applied" : "Your confirmation"}</Badge>
      </div>
      {b && (
        <div className="review-before">
          <small>CURRENT PLAN</small>
          <b>
            {b.from} → {b.to}
          </b>
          <p>
            {dateLabel(b.departure, c?.timezone ?? "America/New_York")} ·{" "}
            {time(b.departure, c?.timezone ?? "America/New_York")}–
            {time(b.arrival, c?.destinationTimezone ?? "America/New_York")}
          </p>
        </div>
      )}
      {c && <RouteSummary journey={c} />}{" "}
      {c && b && (
        <p className="review-difference">
          Departure {Math.round((Date.parse(c.departure) - Date.parse(b.departure)) / 60000)} min ·
          Arrival {Math.round((Date.parse(c.arrival) - Date.parse(b.arrival)) / 60000)} min ·{" "}
          {c.price.totalCents != null && b.totalCents != null
            ? "Fare difference " + money(c.price.totalCents - b.totalCents)
            : "Cost difference unknown"}
        </p>
      )}
      <p>{action.notice}</p>
      {error && <Notice tone="error">{error}</Notice>}
      {!done && (
        <Button
          kind="primary"
          disabled={busy || expired}
          onClick={() =>
            void run(async () => {
              const response = await api<{ journey: Journey }>(
                "/agent/actions/" + action.id + "/confirm",
                "POST",
              );
              setDone(true);
              setActive(response.journey);
              await refresh();
              notify("Saved journey updated.");
              onApplied?.(response.journey);
            })
          }
        >
          {busy
            ? "Checking current route…"
            : expired
              ? "Review expired — prepare again"
              : "Confirm " + action.kind}
        </Button>
      )}
      {!done&&(error||expired)&&<Button disabled={busy} onClick={()=>void run(async()=>setAction(await api<PendingAction>('/agent/actions','POST',{kind:action.kind,journeyId:action.journeyId,searchId:action.searchId,candidateId:action.candidateId,private:action.private})))}>Refresh review</Button>}
      {!done && <small>Review valid until {new Date(action.expiresAt).toLocaleTimeString()}</small>}
    </div>
  );
}
export function RecoveryOptions({
  items,
  onReview,
}: {
  items: Recovery[];
  onReview: (a: PendingAction) => void;
}) {
  const { busy, error, run } = useAsync();
  return (
    <div className="recovery-options">
      {items.map((r) => (
        <article className="recovery-option" key={r.id}>
          <div className="section-title">
            <Badge tone={r.expiresAt > Date.now() ? "mint" : "amber"}>
              {r.state === "applied"
                ? "Applied"
                : r.expiresAt > Date.now()
                  ? "Ready to review"
                  : "Stale — refresh routes"}
            </Badge>
            <small>{r.automatic ? "Automatically prepared" : "Prepared on request"}</small>
          </div>
          <RouteSummary journey={r.alternative} />
          <p>
            Arrival difference: {r.arrivalDifferenceMinutes??'Unknown'} min · Extra cost: {money(r.incrementalCostCents)} · Checked{" "}
            {new Date(r.observedAt).toLocaleTimeString()}
          </p>
          <Button
            disabled={busy || r.expiresAt <= Date.now() || r.state !== "prepared"}
            onClick={() =>
              void run(async () =>
                onReview(
                  await api<PendingAction>("/agent/actions", "POST", {
                    kind: "recovery",
                    journeyId: r.journeyId,
                    searchId: r.searchId,
                    candidateId: r.alternative.id,
                  }),
                ),
              )
            }
          >
            Review alternative
          </Button>
        </article>
      ))}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
export function JourneyActions({ journey: j }: { journey: Journey }) {
  const { navigate, boot, setBoot } = useApp();
  const { busy, error, run } = useAsync();
  const [review, setReview] = useState<PendingAction | null>(null),
    [changing, setChanging] = useState(false),
    [items, setItems] = useState<Recovery[]>([]);
  const finished = ["CANCELLED", "ARRIVED"].includes(j.state ?? "");
  useEffect(() => {
    let valid = true;
    const load = () => {
      void api<Recovery[]>("/journeys/" + j.id + "/recoveries")
        .then((r) => {
          if (valid) setItems(r);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      valid = false;
      clearInterval(timer);
    };
  }, [j.id, j.version]);
  return (
    <section className="journey-actions">
      <div className="trip-action-strip">
        <Button icon="plus" onClick={() => navigate("plan")}>
          Add trip
        </Button>
        <Button disabled={finished} onClick={() => setChanging(true)}>
          Change trip
        </Button>
        <Button
          disabled={finished || busy}
          onClick={() =>
            void run(async () =>
              setReview(
                await api<PendingAction>("/agent/actions", "POST", {
                  kind: "cancel",
                  journeyId: j.id,
                }),
              ),
            )
          }
        >
          Cancel trip
        </Button>
        <Button
          disabled={finished || busy}
          onClick={() =>
            void run(async () =>
              setItems(await api<Recovery[]>("/journeys/" + j.id + "/prepare-recovery", "POST")),
            )
          }
        >
          Alternatives
        </Button>
        <a className="btn" href={"/api/journeys/" + j.id + "/itinerary.pdf"} download>
          Download PDF
        </a>
      </div>
      {finished && (
        <p className="fine-print">
          This journey is finished. Add a new trip to start monitoring again.
        </p>
      )}
      <div className="recovery-heading">
        <div>
          <span className="eyebrow">A PLAN WHEN PLANS CHANGE</span>
          <h2>Your alternatives</h2>
        </div>
        <Toggle
          label="Automatic preparation"
          checked={boot.user.preferences.autoRecovery}
          onChange={(v) =>
            void run(async () => {
              const user = await api<User>("/profile", "PUT", {
                name: boot.user.name,
                preferences: { ...boot.user.preferences, autoRecovery: v },
              });
              setBoot((b) => (b ? { ...b, user } : b));
            })
          }
        />
      </div>
      <p className="fine-print">
        Active Boston journeys refresh every 60 seconds. Confirmed disruptions and connection risks
        trigger route preparation. You review every change.
      </p>
      {!items.length && (
        <p className="recovery-empty">
          {busy
            ? "Finding reachable alternatives…"
            : "No alternatives prepared yet. Use Alternatives to compare routes now."}
        </p>
      )}
      <RecoveryOptions items={items} onReview={setReview} />
      {error && <Notice tone="error">{error}</Notice>}
      {review && (
        <Modal title="Review journey update" onClose={() => setReview(null)}>
          <ActionReview action={review} />
        </Modal>
      )}
      {changing && (
        <ChangeTrip
          journey={j}
          close={() => setChanging(false)}
          onReview={(a) => {
            setChanging(false);
            setReview(a);
          }}
        />
      )}
    </section>
  );
}
function ChangeTrip({
  journey: j,
  close,
  onReview,
}: {
  journey: Journey;
  close: () => void;
  onReview: (a: PendingAction) => void;
}) {
  const { boot } = useApp();
  const [to, setTo] = useState(j.toId),
    [place, setPlace] = useState<Place | undefined>(j.toPlace),
    [date, setDate] = useState(localInput(new Date(j.departure))),
    [walk, setWalk] = useState(boot.user.preferences.maxWalkMinutes),
    [routes, setRoutes] = useState<SearchResult | null>(null);
  const { busy, error, run } = useAsync();
  return (
    <Modal title="Change your journey" onClose={close}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () =>
            setRoutes(
              await api<SearchResult>("/search", "POST", {
                from: j.fromPlace ?? j.fromId,
                to: place ?? to,
                departure: new Date(date).toISOString(),
                travelers: j.travelers,
                bags: j.bags,
                mode: j.dataMode === "provider" ? "provider" : "sample",
                preferences: { ...boot.user.preferences, maxWalkMinutes: walk },
              }),
            ),
          );
        }}
      >
        <Field label="Destination">
          {j.dataMode === "provider" ? (
            <PlacePicker
              label="New destination"
              value={to}
              place={place}
              onChange={(v, p) => {
                setTo(v);
                setPlace(p);
              }}
            />
          ) : (
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {boot.cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Departure (this device's timezone)">
          <input
            type="datetime-local"
            required
            value={date}
            onInput={(e) => setDate(e.currentTarget.value)}
          />
        </Field>
        <Field label="Maximum walking minutes">
          <input
            type="number"
            min="0"
            max="120"
            value={walk}
            onChange={(e) => setWalk(+e.target.value)}
          />
        </Field>
        <Button type="submit" kind="primary" disabled={busy}>
          Find updated routes
        </Button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {routes?.journeys.map((c) => (
        <article key={c.id} className="recovery-option">
          <RouteSummary journey={c} />
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () =>
                onReview(
                  await api<PendingAction>("/journeys/" + j.id + "/change", "POST", {
                    searchId: routes.searchId,
                    candidateId: c.id,
                  }),
                ),
              )
            }
          >
            Review change
          </Button>
        </article>
      ))}
      {routes && !routes.journeys.length && (
        <Notice>{routes.reason ?? "No eligible routes. Adjust the time or preferences."}</Notice>
      )}
    </Modal>
  );
}
