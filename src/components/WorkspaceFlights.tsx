import type { FlightCandidate, FlightMoney, FlightPassenger, FlightSearchProgress, TripConstraints, WorkspaceCommand } from '../workspaceTypes';
import { Badge, Button, Field, Notice } from './ui';

type Dispatch = (text: string, command?: WorkspaceCommand) => void;
const amount = (m: FlightMoney | null) => m ? new Intl.NumberFormat(undefined, { style: 'currency', currency: m.currency }).format(m.amount / 10 ** m.scale) : 'Price incomplete';
const stamp = (date: string, zone: string) => new Intl.DateTimeFormat(undefined, { timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(date));

export function FlightOfferDetails({ candidate: c }: { candidate: FlightCandidate }) {
  return <div className="workspace-flight-offer">
    <div className="section-title"><strong>{amount(c.pricing.total)}</strong><Badge tone={c.live ? '' : 'amber'}>{c.live ? 'Supplier offer' : 'Supplier test inventory'}</Badge></div>
    <small>Whole party · One way · {c.durationMinutes} min · {c.transfers} connections</small>
    {c.services.map(s => <div className="workspace-flight-service" key={s.id}><b>{s.origin.iata ?? s.origin.name} → {s.destination.iata ?? s.destination.name}</b><span>{s.operator} {s.serviceNumber}</span><span>{stamp(s.departure, s.origin.timezone)}</span><span>{stamp(s.arrival, s.destination.timezone)}</span></div>)}
    {c.limitation && c.limitation !== 'Supplier test inventory' && <p className="workspace-unknown">{c.limitation}</p>}
    <small>Offer expires {new Date(c.expiresAt).toLocaleString()}. No seats held.</small>
    <details className="workspace-source"><summary>Party price, baggage & conditions</summary>{c.components.map(p => <p key={p.id}>{p.label}: {p.includedIn ? 'Included in supplier fare' : amount(p.money)}{p.kind === 'estimate' ? ' (estimate)' : ''}</p>)}<p>Refund: {c.conditions.refund}. Changes: {c.conditions.change}. Connection protection: {c.conditions.protection}.</p><p>{c.ticketGroups.length} indivisible supplier ticket group(s). Every service and traveler is repriced together.</p>{c.connections.map((connection, i) => <p key={i}>{connection.status}: {connection.reason}</p>)}</details>
  </div>;
}

export function FlightSearchStatus({ search, active, busy, send }: { search: FlightSearchProgress; active: boolean; busy: boolean; send: Dispatch }) {
  const pending = ['queued', 'partial'].includes(search.state), ready = ['complete', 'partial-failure'].includes(search.state);
  return <div className="workspace-flight-search" aria-live="polite"><h3>{search.state === 'blocked' ? 'Flight supplier access needed' : `Flight search: ${search.state.replaceAll('-', ' ')}`}</h3><p>{search.reason}</p><small>{search.queries.filter(q => q.state === 'complete').length} of {search.queries.length} selected queries completed · {search.queries.map(q => `${q.origin} → ${q.destination} · ${q.date}`).join(' / ')}</small><div className="button-row">{ready && <Button kind="primary small" disabled={busy || !active} onClick={() => send('Load flight offers', { op: 'collect_options', searchId: search.id })}>Load offers</Button>}{pending && <Button disabled={busy} kind="small" onClick={() => send('Cancel flight search', { op: 'cancel_search', searchId: search.id })}>Cancel search</Button>}{active && ['blocked', 'failed', 'cancelled'].includes(search.state) && <Button kind="small" disabled={busy} onClick={() => send('Retry flight search', { op: 'search_options' })}>Retry search</Button>}</div>{!active && <small>This search belongs to an earlier draft or scenario.</small>}</div>;
}

export function FlightPartyFields({ constraints: c, onChange }: { constraints: TripConstraints; onChange: (next: TripConstraints) => void }) {
  const passengers: FlightPassenger[] = c.passengers ?? Array.from({ length: Math.min(c.travelers, 9) }, (_, i) => ({ id: 'adult-' + (i + 1), type: 'adult', personal: 0, cabin: 0, checked: 0 }));
  const change = (list: FlightPassenger[]) => onChange({ ...c, passengers: list, travelers: list.length, bags: list.reduce((n, p) => n + p.cabin + p.checked, 0) });
  const patch = (index: number, fields: Partial<FlightPassenger>) => change(passengers.map((p, i) => i === index ? { ...p, ...fields } : p));
  return <div className="workspace-flight-party"><Notice>Airport-to-airport economy, with optional return or multi-city flights. Enter baggage for each traveler; unpriced required bags keep an offer incomplete.</Notice><Field label="Departure window (hours)"><input aria-label="Flight departure window" type="number" min="1" max="24" value={c.flightWindowHours ?? 23} onChange={e => onChange({ ...c, flightWindowHours: Number(e.target.value) })} /></Field>
    {passengers.map((p, i) => <fieldset key={p.id}><legend>Traveler {i + 1}</legend><div className="workspace-fields"><Field label="Type"><select aria-label={`Traveler ${i + 1} type`} value={p.type} onChange={e => patch(i, e.target.value === 'child' ? { type: 'child', age: 8 } : { type: 'adult', age: undefined })}><option value="adult">Adult</option><option value="child">Child (2–17)</option></select></Field>{p.type === 'child' && <Field label="Age"><input aria-label={`Traveler ${i + 1} age`} type="number" min="2" max="17" required value={p.age ?? 8} onChange={e => patch(i, { age: Number(e.target.value) })} /></Field>}{(['personal', 'cabin', 'checked'] as const).map(kind => <Field key={kind} label={kind === 'personal' ? 'Personal item' : `${kind === 'cabin' ? 'Cabin' : 'Checked'} bags`}><input aria-label={`Traveler ${i + 1} ${kind} bags`} type="number" min="0" max={kind === 'personal' ? 1 : kind === 'cabin' ? 2 : 3} value={p[kind]} onChange={e => patch(i, { [kind]: Number(e.target.value) })} /></Field>)}</div><Button kind="small" disabled={passengers.length === 1} onClick={() => change(passengers.filter((_, index) => index !== i))}>Remove traveler {i + 1}</Button></fieldset>)}
    <Button kind="small" disabled={passengers.length >= 9} onClick={() => change([...passengers, { id: crypto.randomUUID(), type: 'adult', personal: 0, cabin: 0, checked: 0 }])}>Add traveler</Button>
  </div>;
}
