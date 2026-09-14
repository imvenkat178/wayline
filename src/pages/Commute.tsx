import { useEffect, useState } from "react";
import { useApp } from "../context";
import { api, money, localInput, dateLabel } from "../api";
import type { SavedItem, SearchInput } from "../types";
import { SavedRouteFields, initialSavedRoute } from "../components/SavedRouteFields";
import {
  Button,
  Icon,
  Badge,
  Field,
  Notice,
  Empty,
  Modal,
  Section,
  useAsync,
  Toggle,
} from "../components/ui";
interface FareResult {
  options: { name: string; cents: number }[];
  savingCents: number;
  remainingCapCents: number | null;
  disclaimer: string;
}
export default function Commute() {
  const { boot, setSearchInput, setResult, setActive, navigate, notify } = useApp();
  const [editing, setEditing] = useState<SavedItem | null>(null);
  const [route, setRoute] = useState(() => initialSavedRoute(boot.pilot));
  const [commutes, setCommutes] = useState<SavedItem[]>([]),
    [passes, setPasses] = useState<SavedItem[]>([]),
    [modal, setModal] = useState<"commute" | "pass" | null>(null),
    [fare, setFare] = useState<FareResult | null>(null);
  const { busy, error, run } = useAsync();
  const open = (kind: "commute" | "pass", item: SavedItem | null = null) => {
    setEditing(item);
    setRoute(item?.from && item.to ? { mode: item.mode ?? "sample", from: item.from, to: item.to, fromPlace: item.fromPlace, toPlace: item.toPlace } : initialSavedRoute(boot.pilot));
    setModal(kind);
  };
  const load = async () => {
    setCommutes(await api("/records/commute"));
    setPasses(await api("/records/pass"));
  };
  useEffect(() => {
    void run(load);
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR EVERYDAY, A LITTLE EASIER</span>
          <h1>Make your commute work for you</h1>
          <p>Recurring routes, fare choices and pass reminders.</p>
        </div>
        <Button kind="primary" icon="plus" onClick={() => open("commute")}>
          Add a commute
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="card-grid">
        {commutes.map((c) => (
          <Section
            key={c.id}
            title={c.name}
            action={
              <Button
                icon="trash"
                title="Remove commute"
                kind="icon-only"
                onClick={() =>
                  void run(async () => {
                    await api(`/records/commute/${c.id}`, "DELETE");
                    await load();
                  })
                }
              />
            }
          >
            <div className="commute-symbol">
              <Icon name="route" size={30} />
            </div>
            <h3>
              {c.fromPlace?.name ?? boot.cities.find((x) => x.id === c.from)?.name ?? c.from} →{" "}
              {c.toPlace?.name ?? boot.cities.find((x) => x.id === c.to)?.name ?? c.to}
            </h3>
            <p>
              {c.time} · {c.timezone}
            </p>
            <Badge tone={c.enabled ? "mint" : "amber"}>{c.mode === "provider" ? "Boston / MBTA" : "Sample route"} · {c.enabled ? "Active" : "Paused"}</Badge>
            <p className="fine-print">{c.nextDeparture ? `Next: ${new Date(c.nextDeparture).toLocaleString(undefined, { timeZone: c.timezone })} · ${c.timezone}` : "No upcoming reminder while paused."}</p>
            <div className="day-strip">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <span key={i} className={c.days?.includes(i) ? "on" : ""}>
                  {d}
                </span>
              ))}
            </div>
            <div className="button-row">
              <Button kind="small" onClick={() => open("commute", c)}>Edit commute</Button>
              <Toggle label="Reminders" checked={c.enabled !== false} onChange={enabled => void run(async () => {
                await api(`/records/commute/${c.id}`, "PATCH", { version: c.version, enabled });
                await load();
              })} />
            </div>
            <Button
              kind="primary full"
              disabled={busy || !c.enabled}
              onClick={() => void run(async () => {
                const next = await api<SearchInput>(`/commutes/${c.id}/next`);
                setSearchInput(next);
                setResult(null);
                setActive(null);
                navigate("plan");
                notify("Searching your next scheduled commute.");
              })}
            >
              Find next commute
            </Button>
          </Section>
        ))}
      </div>
      {!commutes.length && (
        <Empty
          icon="refresh"
          title="Build your everyday shortcut"
          action={<Button onClick={() => open("commute")}>Add a recurring route</Button>}
        >
          Choose your regular route and days. Wayline reminds you to check it before you leave.
        </Empty>
      )}
      <div className="two-columns">
        <Section title="Find the fare that fits">
          <p>
            Compare fares you enter for the same travel period. Discount eligibility and cap rules
            must be verified with the operator.
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              void run(async () =>
                setFare(
                  await api("/fares/compare", "POST", {
                    singleCents: Math.round(Number(d.single) * 100),
                    rides: Number(d.rides),
                    spentCents: Math.round(Number(d.spent) * 100),
                    dayCapCents: Math.round(Number(d.cap) * 100),
                    weeklyCents: Math.round(Number(d.weekly) * 100),
                    monthlyCents: Math.round(Number(d.monthly) * 100),
                  }),
                ),
              );
            }}
          >
            <div className="form-grid">
              <Field label="Single fare ($)">
                <input
                  name="single"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue="2.50"
                />
              </Field>
              <Field label="Planned rides">
                <input name="rides" type="number" min="0" max="500" required defaultValue="10" />
              </Field>
              <Field label="Spent today ($)">
                <input name="spent" type="number" min="0" step="0.01" defaultValue="0" />
              </Field>
              <Field label="Daily fare cap ($; 0 = none)">
                <input name="cap" type="number" min="0" step="0.01" defaultValue="0" />
              </Field>
              <Field label="Weekly pass ($; 0 = none)">
                <input name="weekly" type="number" min="0" step="0.01" defaultValue="20" />
              </Field>
              <Field label="Monthly pass ($; 0 = none)">
                <input name="monthly" type="number" min="0" step="0.01" defaultValue="80" />
              </Field>
            </div>
            <Button type="submit" kind="primary" icon="chart" disabled={busy}>
              Compare fares
            </Button>
          </form>
          {fare && (
            <div className="fare-results">
              {fare.options.map((o, i) => (
                <div className={i === 0 ? "best" : ""} key={o.name}>
                  <span>
                    {i === 0 && <Icon name="check" size={16} />} {o.name}
                  </span>
                  <b>{money(o.cents)}</b>
                </div>
              ))}
              <Notice>
                {money(fare.savingCents)} less than single rides under these assumptions.{" "}
                {fare.remainingCapCents !== null &&
                  `${money(fare.remainingCapCents)} remains to the entered daily cap.`}
              </Notice>
              <small>{fare.disclaimer}</small>
            </div>
          )}
        </Section>
        <Section
          title="Your passes"
          action={
            <Button icon="plus" kind="small" onClick={() => open("pass")}>
              Add pass
            </Button>
          }
        >
          {passes.length ? (
            passes.map((p) => (
              <div className="pass-card" key={p.id}>
                <div className="section-title">
                  <Badge>{p.operator}</Badge>
                  <Button
                    icon="trash"
                    title="Remove pass reminder"
                    kind="small icon-only"
                    onClick={() =>
                      void run(async () => {
                        await api(`/records/pass/${p.id}`, "DELETE");
                        await load();
                      })
                    }
                  />
                </div>
                <h3>{p.name}</h3>
                <strong>{money(p.costCents)}</strong>
                <p>Renewal {p.renewal && dateLabel(p.renewal)} · self-reported</p>
                <Button kind="small" onClick={() => open("pass", p)}>Edit renewal</Button>
              </div>
            ))
          ) : (
            <Empty icon="ticket" title="Remember your next renewal">
              Add a pass you already own. Wayline never starts or cancels subscriptions.
            </Empty>
          )}
          <Notice>
            Student, senior, military and accessibility fare classes can be saved per traveler in
            Profile. Wayline does not verify eligibility.
          </Notice>
        </Section>
      </div>
      {modal && (
        <Modal
          title={editing ? `Edit ${modal}` : modal === "commute" ? "Add a recurring commute" : "Add a pass reminder"}
          onClose={() => setModal(null)}
        >
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const d = Object.fromEntries(f);
              void run(async () => {
                await api(
                  `/records/${modal}${editing ? "/" + editing.id : ""}`,
                  editing ? "PATCH" : "POST",
                  modal === "commute"
                    ? { ...d, ...route, version: editing?.version, days: f.getAll("days").map(Number), enabled: editing?.enabled ?? true }
                    : {
                        ...d,
                        version: editing?.version,
                        costCents: Math.round(Number(d.cost) * 100),
                        renewal: new Date(String(d.renewal)).toISOString(),
                      },
                );
                await load();
                setModal(null);
                notify("Saved.");
              });
            }}
          >
            <Field label="Name">
              <input
                required
                name="name"
                defaultValue={editing?.name ?? ""}
                maxLength={60}
                placeholder={modal === "commute" ? "Morning commute" : "Monthly transit pass"}
              />
            </Field>
            {modal === "commute" ? (
              <>
                <SavedRouteFields value={route} onChange={setRoute} />
                <div className="form-grid">
                  <Field label="Leave at">
                    <input name="time" type="time" defaultValue={editing?.time ?? "08:00"} required />
                  </Field>
                  <Field label="Time zone">
                    <select key={route.mode} name="timezone" defaultValue={editing?.timezone ?? (route.mode === "provider" ? "America/New_York" : boot.user.preferences.timezone)}>
                      {[...new Set(boot.cities.map((c) => c.timezone))].map((z) => (
                        <option key={z}>{z}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <fieldset>
                  <legend>Travel days</legend>
                  <div className="days-input">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                      <label key={d}>
                        <input
                          type="checkbox"
                          name="days"
                          value={i}
                          defaultChecked={editing?.days ? editing.days.includes(i) : i > 0 && i < 6}
                        />
                        {d}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </>
            ) : (
              <>
                <Field label="Operator">
                  <input required name="operator" maxLength={80} defaultValue={editing?.operator ?? ""} />
                </Field>
                <Field label="Cost ($)">
                  <input required name="cost" type="number" min="0" max="1000" step="0.01" defaultValue={editing?.costCents == null ? "" : editing.costCents / 100} />
                </Field>
                <Field label="Next renewal · device time">
                  <input
                    required
                    name="renewal"
                    type="datetime-local"
                    defaultValue={localInput(new Date(editing?.renewal ?? Date.now() + 30 * 86400000))}
                  />
                </Field>
              </>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <Button kind="primary" type="submit" disabled={busy}>
              Save {modal}
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
