import { useEffect, useState } from "react";
import { useApp } from "../context";
import { api, time, dateLabel, localInput, download, money } from "../api";
import type { Ticket, Claim, SavedItem } from "../types";
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
} from "../components/ui";
export default function Wallet() {
  const { boot, journeys, notify } = useApp();
  const [tickets, setTickets] = useState<Ticket[]>([]),
    [claims, setClaims] = useState<Claim[]>([]),
    [passes, setPasses] = useState<SavedItem[]>([]),
    [tab, setTab] = useState("tickets"),
    [modal, setModal] = useState(false);
  const { busy, error, run } = useAsync();
  const load = async () => {
    setTickets(await api("/records/ticket"));
    setClaims(await api("/records/claim"));
    setPasses(await api("/records/pass"));
  };
  useEffect(() => {
    void run(load);
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">READY WHEN YOU ARE</span>
          <h1>Your ticket wallet</h1>
          <p>Confirmations, passes and travel records. All together.</p>
        </div>
        <Button icon="plus" kind="primary" onClick={() => setModal(true)}>
          Add a ticket
        </Button>
      </div>
      <div className="view-tabs">
        {["tickets", "passes", "refund drafts"].map((x) => (
          <button key={x} className={tab === x ? "active" : ""} onClick={() => setTab(x)}>
            {x === "tickets"
              ? `Tickets (${tickets.length})`
              : x === "passes"
                ? `Passes (${passes.length})`
                : `Refund drafts (${claims.length})`}
          </button>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {tab === "tickets" && (
        <>
          <Notice>
            Imported details are private travel notes. Carry your carrier-issued ticket or barcode
            for boarding.
          </Notice>
          <div className="ticket-grid">
            {tickets.map((t) => (
              <article className="ticket" key={t.id}>
                <div className="ticket-top">
                  <div className="operator-symbol">
                    <Icon name="ticket" size={25} />
                  </div>
                  <div>
                    <small>{t.operator}</small>
                    <h3>{t.service}</h3>
                  </div>
                  <Badge>IMPORTED</Badge>
                </div>
                <div className="ticket-route">
                  <div>
                    <strong>{t.origin}</strong>
                    <small>FROM</small>
                  </div>
                  <Icon name="arrow" />
                  <div>
                    <strong>{t.destination}</strong>
                    <small>TO</small>
                  </div>
                </div>
                <div className="ticket-info">
                  <div>
                    <small>PASSENGER</small>
                    <b>{t.passenger}</b>
                  </div>
                  <div>
                    <small>DEPARTURE · DEVICE TIME</small>
                    <b>
                      {dateLabel(t.departure)} · {time(t.departure)}
                    </b>
                  </div>
                  <div>
                    <small>SEAT / COACH</small>
                    <b>
                      {t.seat || "Unassigned"} / {t.coach || "—"}
                    </b>
                  </div>
                  <div>
                    <small>PLATFORM</small>
                    <b>{t.platform || "Check departure board"}</b>
                  </div>
                </div>
                <div className="ticket-stub">
                  <div>
                    <small>CONFIRMATION</small>
                    <code>{t.confirmation}</code>
                  </div>
                  <Icon name="lock" />
                </div>
                <div className="button-row">
                  <Button
                    icon="download"
                    kind="small"
                    onClick={() => download(`ticket-${t.id}.json`, t)}
                  >
                    Export
                  </Button>
                  {boot.operatorLinks[t.operator] && (
                    <a
                      className="btn small"
                      href={boot.operatorLinks[t.operator]}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Operator
                      <Icon name="external" size={14} />
                    </a>
                  )}
                  <Button
                    icon="trash"
                    title="Remove imported ticket"
                    kind="icon-only small"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/records/ticket/${t.id}`, "DELETE");
                        await load();
                        notify("Imported ticket removed.");
                      })
                    }
                  />
                </div>
              </article>
            ))}
          </div>
          {!tickets.length && (
            <Empty
              icon="ticket"
              title="A place for every confirmation"
              action={
                <Button kind="primary" onClick={() => setModal(true)}>
                  Add your first ticket
                </Button>
              }
            >
              Add an existing ticket’s details after booking with an operator. Your ticket wallet
              starts empty.
            </Empty>
          )}
        </>
      )}
      {tab === "passes" && (
        <>
          <Notice>
            Add and compare passes in Commute. Renewals here are reminders; billing remains with the
            operator.
          </Notice>
          <div className="card-grid">
            {passes.map((p) => (
              <Section key={p.id} title={p.name}>
                <p>{p.operator}</p>
                <h2>{money(p.costCents)}</h2>
                <p>Renewal: {p.renewal && dateLabel(p.renewal)}</p>
                <Badge>SELF-REPORTED</Badge>
              </Section>
            ))}
          </div>
          {!passes.length && (
            <Empty icon="ticket" title="No passes added yet">
              Use Commute to compare fares and add a pass.
            </Empty>
          )}
        </>
      )}
      {tab === "refund drafts" && (
        <div className="stack">
          {claims.map((c) => (
            <Section key={c.id} title="Refund request draft" action={<Badge>NOT SUBMITTED</Badge>}>
              <p>{c.reason}</p>
              <pre className="draft-preview">{c.draft}</pre>
              <Button
                icon="download"
                onClick={() => download("wayline-refund-draft.txt", c.draft, "text/plain")}
              >
                Download request
              </Button>
            </Section>
          ))}
          {!claims.length && (
            <Empty icon="ticket" title="No refund requests yet">
              Open a saved journey to prepare a request with its event record.
            </Empty>
          )}
        </div>
      )}
      {modal && (
        <Modal title="Add an existing ticket" onClose={() => setModal(false)}>
          <Notice>
            Your ticket information is encrypted on the server. No ticket is issued or verified by
            this form.
          </Notice>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              void run(async () => {
                await api("/records/ticket", "POST", {
                  ...d,
                  departure: new Date(String(d.departure)).toISOString(),
                });
                await load();
                setModal(false);
                notify("Ticket details saved.");
              });
            }}
          >
            <div className="form-grid">
              <Field label="Operator">
                <input name="operator" required list="ticket-operators" />
                <datalist id="ticket-operators">
                  {Object.keys(boot.operatorLinks).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </datalist>
              </Field>
              <Field label="Service / train / bus">
                <input name="service" required maxLength={80} />
              </Field>
              <Field label="Confirmation code">
                <input name="confirmation" required maxLength={100} autoComplete="off" />
              </Field>
              <Field label="Passenger">
                <input name="passenger" required defaultValue={boot.user.name} maxLength={100} />
              </Field>
              <Field label="From">
                <input name="origin" required maxLength={160} />
              </Field>
              <Field label="To">
                <input name="destination" required maxLength={160} />
              </Field>
              <Field label="Departure · your device time">
                <input
                  type="datetime-local"
                  required
                  name="departure"
                  defaultValue={localInput()}
                />
              </Field>
              <Field label="Link to journey">
                <select name="journeyId">
                  <option value="">No linked journey</option>
                  {journeys.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.from} → {j.to} · {dateLabel(j.departure)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Seat (optional)">
                <input name="seat" maxLength={40} />
              </Field>
              <Field label="Coach (optional)">
                <input name="coach" maxLength={40} />
              </Field>
              <Field label="Platform from ticket (optional)">
                <input name="platform" maxLength={40} />
              </Field>
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" kind="primary" disabled={busy}>
              Save ticket details
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
