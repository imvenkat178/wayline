import SupplierTickets from '../components/SupplierTickets';
import { useEffect, useRef, useState } from "react";
import { useApp } from "../context";
import { api, time, dateLabel, localInput, download, money } from "../api";
import type { Ticket, Claim, SavedItem, Order } from "../types";
import type { DecodedBarcode } from "../barcode";
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
export default function Wallet({ initialTab = "tickets" }: { initialTab?: string } = {}) {
  const { boot, journeys, notify, navigate, setActive } = useApp();
  const [editing, setEditing] = useState<Ticket | null>(null), [viewing, setViewing] = useState<Ticket | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]),
    [claims, setClaims] = useState<Claim[]>([]),
    [passes, setPasses] = useState<SavedItem[]>([]),
    [orders, setOrders] = useState<Order[]>([]),
    [tab, setTab] = useState(initialTab),
    [modal, setModal] = useState(false),
    [quoteModal, setQuoteModal] = useState(false);
  const [importedDoc, setImportedDoc] = useState<{
      name: string;
      type: string;
      base64: string;
    } | null>(null),
    [importedBarcode, setImportedBarcode] = useState<DecodedBarcode | null>(null),
    [importPreview, setImportPreview] = useState(""),
    [importStatus, setImportStatus] = useState("");
  const { busy, error, run } = useAsync();
  const importEpoch = useRef(0);
  const [importing, setImporting] = useState(false);
  const closeTicket = () => {
    importEpoch.current++;
    setImporting(false); setModal(false); setEditing(null);
    setImportedDoc(null); setImportedBarcode(null); setImportPreview(""); setImportStatus("");
  };
  useEffect(() => () => { importEpoch.current++; }, []);
  const load = async () => {
    setTickets(await api("/records/ticket"));
    setClaims(await api("/records/claim"));
    setPasses(await api("/records/pass"));
    setOrders(await api("/commerce/orders"));
  };
  const orderAction = (id: string, action: "confirm" | "exchange" | "cancel", data?: unknown) =>
    run(async () => {
      await api(`/commerce/orders/${id}/${action}`, "POST", data);
      await load();
      notify(
        action === "confirm"
          ? "Sandbox order confirmed. No real payment was captured."
          : action === "cancel"
            ? "Sandbox order cancelled."
            : "Sandbox order exchanged.",
      );
    });
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
        <Button icon="plus" kind="primary" onClick={() => { setEditing(null); setModal(true); }}>
          Add a ticket
        </Button>
      </div>
      <div className="view-tabs">
        {["tickets", "passes", "refund drafts", "sandbox checkout"].map((x) => (
          <button key={x} className={tab === x ? "active" : ""} onClick={() => setTab(x)}>
            {x === "tickets"
              ? `Tickets (${tickets.length})`
              : x === "passes"
                ? `Passes (${passes.length})`
                : x === "refund drafts"
                  ? `Refund drafts (${claims.length})`
                  : `Sandbox checkout (${orders.length})`}
          </button>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {tab === "tickets" && (
        <>
          <SupplierTickets/>
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
                {(t.document || t.barcodeFormat) && (
                  <div className="ticket-stub">
                    <div>
                      <small>
                        {t.barcodeFormat
                          ? `BARCODE · ${t.barcodeFormat.replace(/_/g, " ")}`
                          : "PHOTO ATTACHED"}
                      </small>
                      <code>
                        {t.barcodeText ? t.barcodeText.slice(0, 60) : "No barcode detected"}
                      </code>
                    </div>
                    <Badge>UNVERIFIED</Badge>
                  </div>
                )}
                <div className="ticket-stub">
                  <div>
                    <small>CONFIRMATION</small>
                    <code>{t.confirmation}</code>
                  </div>
                  <Icon name="lock" />
                </div>
                <div className="button-row">
                  <Button kind="small" onClick={() => {
                    setEditing(t); setImportedDoc(t.document);
                    setImportedBarcode(t.barcodeFormat && t.barcodeText ? { format: t.barcodeFormat, text: t.barcodeText } : null);
                    setImportPreview(t.document && /^image\/(jpeg|png|webp)$/.test(t.document.type) ? `data:${t.document.type};base64,${t.document.base64}` : "");
                    setModal(true);
                  }}>Edit details</Button>
                  {t.document && <Button kind="small" onClick={() => setViewing(t)}>View ticket photo</Button>}
                  {t.journeyId && <>
                    <a className="btn small" href={`/api/journeys/${t.journeyId}/itinerary.pdf`} download>Itinerary PDF</a>
                    <Button kind="small" disabled={busy} onClick={() => void run(async () => {
                      setActive(await api(`/journeys/${t.journeyId}`)); navigate("journey");
                    })}>Open journey</Button>
                  </>}
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
          <Button onClick={() => navigate("commute")}>Manage passes</Button>
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
      {tab === "sandbox checkout" && (
        <div className="stack">
          <Notice tone="amber">
            Sandbox checkout moves no real money and issues no real ticket. It exercises an
            order/quote/hold/confirm/exchange state machine against a built-in sandbox adapter so a
            real, contracted payment and carrier integration can plug in later without a redesign.
            Every order here is synthetic.
          </Notice>
          <Button kind="primary" icon="plus" onClick={() => setQuoteModal(true)}>
            Get a sandbox quote
          </Button>
          <div className="card-grid">
            {orders.map((o) => (
              <Section
                key={o.id}
                title={`${o.quote.from} → ${o.quote.to}`}
                action={<Badge>SANDBOX · {o.state}</Badge>}
              >
                <p>{o.passenger}</p>
                <h2>{money(o.quote.totalCents)}</h2>
                <p>
                  <small>
                    Fare {money(o.quote.fareCents)} + sandbox fee {money(o.quote.feeCents)}
                  </small>
                </p>
                <div className="button-row">
                  {o.state === "HELD" && (
                    <Button
                      kind="small primary"
                      disabled={busy}
                      onClick={() => orderAction(o.id, "confirm")}
                    >
                      Confirm (capture)
                    </Button>
                  )}
                  {(o.state === "HELD" || o.state === "CONFIRMED") && (
                    <Button
                      kind="small"
                      disabled={busy}
                      onClick={() => orderAction(o.id, "cancel")}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </Section>
            ))}
          </div>
          {!orders.length && (
            <Empty icon="ticket" title="No sandbox orders yet">
              Get a quote to place a non-live, sandbox order.
            </Empty>
          )}
        </div>
      )}
      {modal && (
        <Modal
          title={editing ? "Edit imported ticket" : "Add an existing ticket"}
          onClose={closeTicket}
        >
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
                await api(`/records/ticket${editing ? "/" + editing.id : ""}`, editing ? "PATCH" : "POST", {
                  ...d,
                  version: editing?.version,
                  paidCents: d.paid === "" ? null : Math.round(Number(d.paid) * 100),
                  departure: new Date(String(d.departure)).toISOString(),
                  document: importedDoc,
                  barcodeFormat: importedBarcode?.format ?? null,
                  barcodeText: importedBarcode?.text ?? null,
                });
                await load();
                closeTicket();
                notify("Ticket details saved.");
              });
            }}
          >
            <div className="form-grid">
              <Field label="Attach a photo of your ticket (optional)">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const epoch = ++importEpoch.current;
                    setImporting(true);
                    void (async () => {
                      if (f.size > 5_000_000) {
                        setImportStatus("Choose a photo smaller than 5 MB.");
                        return;
                      }
                      setImportStatus("Reading photo and looking for a barcode…");
                      const { decodeBarcodeFromImage, loadImage, readFileAsDataUrl } =
                        await import("../barcode");
                      const dataUrl = await readFileAsDataUrl(f);
                      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
                      const image = await loadImage(dataUrl);
                      const found = await decodeBarcodeFromImage(image);
                      if (epoch !== importEpoch.current) return;
                      setImportPreview(dataUrl);
                      setImportedDoc({ name: f.name, type: f.type, base64 });
                      setImportedBarcode(found);
                      setImportStatus(
                        found
                          ? `Detected a ${found.format.replace(/_/g, " ")} barcode. Not verified by the operator.`
                          : "Photo attached. No barcode was detected in it.",
                      );
                    })().catch(() => { if (epoch === importEpoch.current) setImportStatus("Could not read this photo. Choose another image."); })
                      .finally(() => { if (epoch === importEpoch.current) setImporting(false); });
                  }}
                />
              </Field>
              {importPreview && (
                <img
                  className="ticket-doc-preview"
                  src={importPreview}
                  alt="Attached ticket photo"
                />
              )}
              {importStatus && (
                <Notice tone={importedBarcode ? "" : "amber"}>{importStatus}</Notice>
              )}
              <Field label="Operator">
                <input name="operator" required list="ticket-operators" defaultValue={editing?.operator ?? ""} />
                <datalist id="ticket-operators">
                  {Object.keys(boot.operatorLinks).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </datalist>
              </Field>
              <Field label="Service / train / bus">
                <input name="service" required maxLength={80} defaultValue={editing?.service ?? ""} />
              </Field>
              <Field label="Confirmation code">
                <input name="confirmation" required maxLength={100} autoComplete="off" defaultValue={editing?.confirmation ?? ""} />
              </Field>
              <Field label="Passenger">
                <input name="passenger" required defaultValue={editing?.passenger ?? boot.user.name} maxLength={100} />
              </Field>
              <Field label="From">
                <input name="origin" required maxLength={160} defaultValue={editing?.origin ?? ""} />
              </Field>
              <Field label="To">
                <input name="destination" required maxLength={160} defaultValue={editing?.destination ?? ""} />
              </Field>
              <Field label="Departure · your device time">
                <input
                  type="datetime-local"
                  required
                  name="departure"
                  defaultValue={localInput(editing ? new Date(editing.departure) : new Date())}
                />
              </Field>
              <Field label="Link to journey">
                <select name="journeyId" defaultValue={editing?.journeyId ?? ""}>
                  <option value="">No linked journey</option>
                  {journeys.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.from} → {j.to} · {dateLabel(j.departure)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Seat (optional)">
                <input name="seat" maxLength={40} defaultValue={editing?.seat ?? ""} />
              </Field>
              <Field label="Coach (optional)">
                <input name="coach" maxLength={40} defaultValue={editing?.coach ?? ""} />
              </Field>
              <Field label="Platform from ticket (optional)">
                <input name="platform" maxLength={40} defaultValue={editing?.platform ?? ""} />
              </Field>
              <Field label="Amount paid ($, optional · self-reported)"><input name="paid" type="number" min="0" max="10000" step="0.01" defaultValue={editing?.paidCents == null ? "" : editing.paidCents / 100} /></Field>
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" kind="primary" disabled={busy || importing}>
              Save ticket details
            </Button>
          </form>
        </Modal>
      )}
      {viewing?.document && <Modal title="Imported ticket photo" onClose={() => setViewing(null)}>
        <Notice>This is your original import. Wayline has not verified it with the operator.</Notice>
        {/^image\/(jpeg|png|webp)$/.test(viewing.document.type)
          ? <img className="ticket-document-full" src={`data:${viewing.document.type};base64,${viewing.document.base64}`} alt="Original imported ticket" />
          : <Notice>Preview is unavailable for this document type.</Notice>}
        {viewing.barcodeText && <p className="document-barcode"><b>{viewing.barcodeFormat}</b><br />{viewing.barcodeText}</p>}
      </Modal>}
      {quoteModal && (
        <Modal title="Sandbox checkout" onClose={() => setQuoteModal(false)}>
          <Notice tone="amber">
            No real money moves and no real ticket is issued. This is a scaffold for a future,
            contracted payment/carrier integration.
          </Notice>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
              void run(async () => {
                const quote = await api("/commerce/quotes", "POST", {
                  from: d.from,
                  to: d.to,
                  fareCents: Math.round(Number(d.fareDollars) * 100),
                });
                await api(
                  "/commerce/orders",
                  "POST",
                  { quoteId: (quote as { id: string }).id, passenger: d.passenger },
                  { "idempotency-key": crypto.randomUUID() },
                );
                await load();
                setQuoteModal(false);
                notify("Sandbox order placed (no real payment or ticket).");
              });
            }}
          >
            <div className="form-grid">
              <Field label="From">
                <select name="from" required defaultValue="">
                  <option value="" disabled>
                    Choose an origin
                  </option>
                  {boot.cities.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}, {c.state}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="To">
                <select name="to" required defaultValue="">
                  <option value="" disabled>
                    Choose a destination
                  </option>
                  {boot.cities.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}, {c.state}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Passenger">
                <input name="passenger" required defaultValue={boot.user.name} maxLength={100} />
              </Field>
              <Field label="Fare (sandbox, dollars)">
                <input
                  name="fareDollars"
                  type="number"
                  min="1"
                  max="2000"
                  step="0.01"
                  required
                  defaultValue="42.00"
                />
              </Field>
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" kind="primary" disabled={busy}>
              Get quote and place sandbox order
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
