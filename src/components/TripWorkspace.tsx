import {FlightSearchScope} from './FlightSearchScope';
import { ConversationTools } from './ConversationTools';
import { travelerActions, type TravelerActionId } from '../travelerActions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, dateLabel, time, money, localInput, readable } from '../api';
import { useApp } from '../context';
import type { CandidateSet, ChangeSummary, ConversationSummary, TripConstraints, WorkspaceCommand, WorkspaceSnapshot } from '../workspaceTypes';
import { Button, Badge, Notice, Field, Icon, modeIcon } from './ui';
import { ActionReview, RouteSummary } from './TripActions';
import { JourneyMap } from './JourneyMap';
import { ToolResult } from './Agent';
import { PlacePicker } from './PlacePicker';
import { FlightOfferDetails, FlightPartyFields, FlightSearchStatus } from './WorkspaceFlights';
import { AirportPicker } from './AirportPicker';
import '../workspace.css';

type DispatchEdit = (input: string, command?: WorkspaceCommand) => void;
const placeName = (p: TripConstraints['from']) => typeof p === 'string' ? p : p.name;
export function TripWorkspace({ initialPrompt }: { initialPrompt: string }) {
  const { boot, active, result, journeys, navigate } = useApp();
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [input, setInput] = useState(initialPrompt);
  const [requestBusy, setBusy] = useState(false), [error, setError] = useState('');
  const [visibleSetId, setVisibleSetId] = useState('');
  const executionPending=!!workspace?.execution && !['completed','failed','cancelled'].includes(workspace.execution.state);
  const busy=requestBusy||executionPending;
  const epoch = useRef(0), inFlight = useRef(false), bottom = useRef<HTMLDivElement>(null);
  const retry = useRef<{ signature: string; body: object } | null>(null);
  const storageKey = `wayline.conversation.v1.${boot.user.id}`;
  const install = useCallback((next: WorkspaceSnapshot) => {
    setWorkspace(next);
    let reference='';try{reference=localStorage.getItem(storageKey+'.reference.'+next.conversation.id)??'';}catch{/* Optional preference. */}
    setVisibleSetId(next.sets.some(s=>s.id===reference)?reference:next.draft.activeSetId??'');
    try { localStorage.setItem(storageKey, next.conversation.id); } catch { /* Storage is optional. */ }
    setConversations(current => [next.conversation, ...current.filter(c => c.id !== next.conversation.id)]);
  }, [storageKey]);
  useEffect(() => { setInput(initialPrompt); }, [initialPrompt]);
  useEffect(() => {
    let valid = true;
    const load = async () => {
      setBusy(true);
      try {
        const list = await api<ConversationSummary[]>('/conversations');
        if (!valid) return;
        setConversations(list);
        let remembered = '';
        try { remembered = localStorage.getItem(storageKey) ?? ''; } catch { /* Optional preference. */ }
        const id = list.find(c => c.id === remembered)?.id ?? list[0]?.id;
        const next = id ? await api<WorkspaceSnapshot>(`/conversations/${id}`) : await api<WorkspaceSnapshot>('/conversations', 'POST');
        if (valid) install(next);
      } catch (e) { if (valid) setError((e as Error).message); }
      finally { if (valid) setBusy(false); }
    };
    void load();
    return () => { valid = false; };
  }, [storageKey, install]);
  useEffect(() => { if (workspace?.messages.length) bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [workspace?.messages.length]);
  const pendingUntil = workspace?.conversation.pending?.until;
  const conversationId = workspace?.conversation.id;
  const searching = workspace?.shoppingSearches.some(s => ["queued", "partial"].includes(s.state));
  useEffect(() => {
    if (!conversationId || (!executionPending && !searching && (!pendingUntil || pendingUntil <= Date.now()))) return;
    let valid = true;
    const current = epoch.current;
    const timer = setInterval(() => {
      if (inFlight.current) return;
      void api<WorkspaceSnapshot>(`/conversations/${conversationId}`).then(next => { if (valid && current === epoch.current && !inFlight.current) install(next); }).catch(() => {});
    }, 2500);
    return () => { valid = false; clearInterval(timer); };
  }, [pendingUntil, conversationId, searching, executionPending, install]);
  const loadConversation = async (id?: string, seed?: object) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = ++epoch.current;
    setBusy(true); setError('');
    try {
      const next = id ? await api<WorkspaceSnapshot>(`/conversations/${id}`) : await api<WorkspaceSnapshot>('/conversations', 'POST', seed);
      if (current === epoch.current) { install(next); setInput(''); retry.current = null; }
    } catch (e) { if (current === epoch.current) setError((e as Error).message); }
    finally { if (current === epoch.current) setBusy(false); inFlight.current = false; }
  };
  const send: DispatchEdit = (query, command) => {
    if (!workspace || inFlight.current || executionPending || !query.trim()) return;
    inFlight.current = true; setBusy(true); setError('');
    const current = epoch.current, path = `/conversations/${workspace.conversation.id}`;
    const signature = JSON.stringify([path, query, command, visibleSetId]);
    const body = retry.current?.signature === signature ? retry.current.body : { input: query, command, async: !command, clientTurnId: crypto.randomUUID(), expectedVersion: workspace.draft.version, visibleSetId: visibleSetId || undefined };
    retry.current = { signature, body };
    void (async () => {
      try {
        const next = await api<WorkspaceSnapshot>(path + '/turns', 'POST', body);
        if (current === epoch.current) { install(next); setInput(''); retry.current = null; }
      } catch (e) {
        if (current !== epoch.current) return;
        setError((e as Error).message);
        try { const next = await api<WorkspaceSnapshot>(path); if (current === epoch.current) install(next); } catch { /* Keep the draft and input visible while offline. */ }
        if (e instanceof ApiError && e.status !== 0 && e.code !== 'TURN_PENDING') retry.current = null;
      } finally { if (current === epoch.current) setBusy(false); inFlight.current = false; }
    })();
  };
  const confirmFlight = async (id: string) => {
    if (!workspace || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    const current = epoch.current;
    try {
      await api('/shopping/reviews/' + id + '/confirm', 'POST');
      const next = await api<WorkspaceSnapshot>('/conversations/' + workspace.conversation.id);
      if (current === epoch.current) install(next);
    } catch (e) { if (current === epoch.current) setError((e as Error).message); }
    finally { if (current === epoch.current) setBusy(false); inFlight.current = false; }
  };
  const draft = workspace?.draft, selected = draft?.selected?.journey, selectedFlight = draft?.selected?.flight;
  return <>
    <div className="page-heading"><div><span className="eyebrow">YOUR TRIP, IN CONVERSATION</span><h1>Where shall we go?</h1><p>Find your route. Make it yours. Keep the whole journey together.</p></div><Button icon="plus" disabled={busy} onClick={() => void loadConversation()}>New conversation</Button></div>
    <div className="workspace-toolbar">
      <Field label="Conversation"><select disabled={busy} value={workspace?.conversation.id ?? ''} onChange={e => void loadConversation(e.target.value)}>{!conversations.length && <option value="">Loading conversations…</option>}{conversations.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field>
      <Field label="Continue a saved journey"><select disabled={busy} value="" onChange={e => { const existing = conversations.find(c => c.journeyId === e.target.value); void loadConversation(existing?.id, { journeyId: e.target.value }); }}><option value="">Choose a saved journey</option>{journeys.map(j => <option key={j.id} value={j.id}>{j.from} → {j.to}</option>)}</select></Field>
      {active && <Button disabled={busy} onClick={() => void loadConversation(undefined, active.version ? { journeyId: active.id } : result ? { searchId: result.searchId, candidateId: active.id } : undefined)}>Bring current route into chat</Button>}
      <Button icon="refresh" disabled={busy} onClick={() => void loadConversation(workspace?.conversation.id)}>Refresh</Button>
    </div>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="assistant-workspace trip-workspace">
      <section className="assistant-conversation" aria-label="Trip conversation">
        <div className="workspace-conversation-header"><span className="guardian-orb"><Icon name="spark" /></span><div><b>{workspace?.conversation.title ?? 'Wayline Assistant'}</b><small>{draft ? `Draft revision ${draft.version} · Changes saved automatically` : 'Opening your workspace'}</small></div><Badge tone="mint">Plan together</Badge></div>
        <div className="workspace-messages">
          {!workspace?.messages.length && <div className="assistant-welcome"><span className="eyebrow">A LITTLE DETAIL GOES A LONG WAY</span><h2>One conversation.<br />Your entire journey.</h2><p>Tell me where you’re headed, when you want to leave, and what matters to you. We can refine the details along the way.</p><div className="workspace-examples">{['Find a trip from South Station to Harvard tomorrow at 9 am', 'Show the cheapest, fastest, and your recommendation', 'Find flights from BOS to JFK tomorrow at 9 am'].map(q => <button key={q} onClick={() => setInput(q)}>{q}<Icon name="arrow" size={16} /></button>)}</div><small>Live transit covers Boston. Flight offers use your selected airports and require approved supplier access.</small></div>}
          {workspace?.messages.map(m => <article key={m.id} className="workspace-turn"><div className="message user-message">{m.input}</div><div className="message assistant-message"><span className="agent-response-label"><Icon name="spark" size={14} /> Wayline</span><p>{m.reply}</p>{m.status === 'failed' && <Button disabled={busy} onClick={() => send(m.input ?? '', m.retryCommand)}>Retry message</Button>}{m.change && <DraftChange value={m.change} />}
            {m.setIds?.map(id => { const set = workspace.sets.find(s => s.id === id); return set ? <Options key={id} set={set} busy={busy} selectedId={draft?.selected?.optionId} comparisonIds={m.comparison?.filter(r => r.setId === id).map(r => r.optionId)} send={send} /> : <Notice key={id}>These results are no longer available. Search again.</Notice>; })}
            {m.shoppingSearchId && (() => { const search = workspace.shoppingSearches.find(s => s.id === m.shoppingSearchId); return search ? <FlightSearchStatus search={search} active={draft?.activeShoppingId === search.id} busy={busy} send={send} /> : <Notice>This flight search expired. Search again.</Notice>; })()}
            {m.flightReview && <section className="workspace-flight-review"><h3>{m.flightReview.state === 'confirmed' ? 'Comparison saved' : 'Review refreshed flight offer'}</h3><Notice>{m.flightReview.notice}</Notice>{m.flightReview.candidate && <FlightOfferDetails candidate={m.flightReview.candidate} />}<p>Saving keeps a planning record. It does not purchase tickets or reserve seats.</p>{m.flightReview.state !== 'confirmed' && <><Button kind="primary" disabled={busy || !m.flightReview.candidate || m.flightReview.expiresAt <= Date.now() || m.flightReview.draftVersion !== draft?.version} onClick={() => void confirmFlight(m.flightReview!.id)}>Confirm & save comparison</Button>{(m.flightReview.draftVersion !== draft?.version || m.flightReview.expiresAt <= Date.now()) && <small>Review expired or the draft changed. Select a current offer and request a new review.</small>}</>}</section>}
            {m.pendingActions?.map(a => <ActionReview key={a.id} action={a} onApplied={() => void loadConversation(workspace.conversation.id)} />)}
            {m.results?.map((r, i) => <ToolResult key={i} result={r} />)}
            {m.workflowEvidence?.length ? <dl className="workspace-evidence">{m.workflowEvidence.map((e,i)=><div key={i}><dt>{e.label}</dt><dd>{e.value}<small>{e.url?<a href={e.url} target="_blank" rel="noreferrer">{e.source}</a>:e.source} · {new Date(e.observedAt).toLocaleString()}</small></dd></div>)}</dl> : null}
            {m.documents?.map(d=><a key={d.url} href={d.url} download>{d.label}</a>)}
            {m.protectedPanel&&<ConversationTools action={m.protectedPanel} workspace={workspace} onConversation={id=>void loadConversation(id)}/>} 
          </div></article>)}
          {executionPending&&workspace?.execution&&<div className="message user-message" aria-label="Pending request">{workspace.execution.input}</div>}
          {workspace?.execution&&<section className="workspace-execution" aria-live="polite"><p>{workspace.execution.inference?.source==='fallback'?'Fallback: '+workspace.execution.inference.reason:workspace.execution.inference?.model?'Local '+workspace.execution.inference.model:'Local Llama'} · {workspace.execution.state}</p><p>{workspace.execution.events.at(-1)?.message}</p>{workspace.execution.error&&<Notice tone="error">{workspace.execution.error}</Notice>}{workspace.execution.state==='failed'&&<Button onClick={()=>void api(`/conversations/${workspace.conversation.id}/executions/${workspace.execution!.id}/retry`,'POST').then(()=>loadConversation(workspace.conversation.id)).catch(e=>setError(e.message))}>Retry unfinished steps</Button>}{executionPending&&<Button onClick={()=>void api(`/conversations/${workspace.conversation.id}/executions/${workspace.execution!.id}/cancel`,'POST').then(()=>loadConversation(workspace.conversation.id)).catch(e=>setError(e.message))}>Stop planning</Button>}</section>}
          {requestBusy && <p className="workspace-progress" role="status"><Icon name="refresh" size={16} /> Checking your trip…</p>}<div ref={bottom} />
        </div>
        <div className="workspace-composer">
          {workspace && workspace.sets.length > 0 && <label className="workspace-reference">When I say “the first option,” use <select aria-label="Result set for option references" value={visibleSetId} disabled={busy} onChange={e => {setVisibleSetId(e.target.value);try{localStorage.setItem(storageKey+'.reference.'+workspace!.conversation.id,e.target.value);}catch{/* Optional preference. */}}}>{workspace.sets.map(s => <option key={s.id} value={s.id}>Results {s.id.slice(0, 6)} · {dateLabel(s.constraints.departure, s.constraints.timezone)} {time(s.constraints.departure, s.constraints.timezone)} · {s.options.length} options</option>)}</select></label>}
          <label className="workspace-tool-picker">Traveler tools<select value="" disabled={busy} onChange={e=>{const op=e.target.value as TravelerActionId;if(op)send(travelerActions.find(a=>a.id===op)!.description,{op});}}><option value="">Choose an action…</option>{travelerActions.filter(a=>a.capability!=='planning'&&a.id!=='clarify').map(a=><option key={a.id} value={a.id}>{a.description}</option>)}</select></label>
          <div className="agent-prompts">{['Find a later trip', 'Compare the first and third', 'Undo that'].map(q => <button key={q} disabled={busy} onClick={() => setInput(q)}>{q}</button>)}</div>
          <form className="agent-input" onSubmit={e => { e.preventDefault(); send(input); }}><textarea aria-label="Message your journey assistant" placeholder="Where to? Tell me what you have in mind…" value={input} onChange={e => setInput(e.target.value)} maxLength={2000} rows={2} /><Button icon="arrow" kind="primary icon-only" title="Send message" type="submit" disabled={busy || !workspace || !input.trim()} /></form><small>Prices and service details come from available data. Saving a plan does not book tickets.</small>
        </div>
      </section>
      <aside className="assistant-trip-context workspace-trip-context" aria-label="Editable trip draft">{draft && <>
        <section className="panel workspace-draft"><div className="section-title"><span className="eyebrow">YOUR CURRENT PLAN</span><Badge>{workspace?.savedComparison ? 'Saved comparison linked' : workspace?.journey ? 'Saved journey linked' : 'Draft'}</Badge></div><h2>{placeName(draft.constraints.from) || 'Your starting point'} <span>→</span> {placeName(draft.constraints.to) || 'Somewhere new'}</h2><div className="workspace-constraint-chips"><span>{draft.constraints.preferences.budgetCents ? `Budget ${money(draft.constraints.preferences.budgetCents)}` : 'No budget limit'}</span><span>{draft.constraints.travelers} travelers</span><span>{draft.constraints.bags} bags</span>{draft.constraints.avoidOvernight && <span>No overnight travel</span>}</div><div className="button-row"><Button icon="refresh" disabled={busy || !draft.undoIds.length} onClick={() => send('Undo that', { op: 'undo_draft_edit' })}>Undo</Button><Button kind="primary" disabled={busy || !draft.selected?.setId} onClick={() => send('Save this trip', { op: 'prepare_review' })}>{workspace?.journey ? 'Review update' : 'Review & save'}</Button></div></section>
        {!selected && draft.locks.length > 0 && <section className="panel"><h3>Kept services</h3><p>These services must appear in new results.</p>{draft.locks.map(lock => <div className="button-row" key={lock.key}><span>{lock.service}</span><Button kind="small" disabled={busy} onClick={() => send('Unlock kept service', { op: 'lock_leg', legId: lock.legId, locked: false })}>{lock.ticketGroupId ? 'Unlock ticket group' : 'Unlock service'}</Button></div>)}</section>}
        <details className="panel workspace-requirements" open={!selected}><summary>Trip requirements</summary><Requirements key={`${draft.id}:${draft.version}`} constraints={draft.constraints} busy={busy} send={send} /></details>
        {selectedFlight ? <section className="panel workspace-timeline"><h2>Your flight itinerary</h2><FlightOfferDetails candidate={selectedFlight} /><div className="button-row"><Button disabled={busy} onClick={() => send(draft.locks.length ? 'Unlock ticket group' : 'Keep ticket group', { op: 'lock_leg', legId: selectedFlight.services[0].id, locked: !draft.locks.length })}>{draft.locks.length ? 'Unlock ticket group' : 'Keep ticket group'}</Button><Button disabled={busy || !!draft.locks.length} onClick={() => send('Find another flight offer', { op: 'replace_leg', legId: selectedFlight.services[0].id, replacementMode: 'flight' })}>Find flight alternatives</Button></div><small>Flight edits replace and reprice the entire supplier ticket group.</small></section> : selected ? <section className="panel workspace-timeline"><div className="section-title"><h2>Your itinerary</h2><Badge tone={selected.dataMode === 'illustrative' ? 'amber' : 'mint'}>{selected.dataMode === 'illustrative' ? 'Sample' : 'Transit'}</Badge></div><RouteSummary journey={selected} /><ol>{selected.legs.map((leg, i) => { const locked = draft.locks.some(l => l.legId === leg.id); return <li key={leg.id}><div className="workspace-leg-icon"><Icon name={modeIcon(leg.mode)} size={18} /></div><div><small>{time(leg.departure, selected.timezone)} – {time(leg.arrival, selected.destinationTimezone)}</small><h3>{readable(leg.mode)} · {leg.service}</h3><p>{leg.from} → {leg.to}</p><div className="button-row"><Button icon={locked ? 'lock' : 'pin'} disabled={busy} kind="small" onClick={() => send(`${locked ? 'Unlock' : 'Keep'} leg ${i + 1}`, { op: 'lock_leg', legId: leg.id, locked: !locked })}>{locked ? 'Unlock service' : 'Keep service'}</Button><label className="workspace-replace">Replace with<select aria-label={`Replace leg ${i + 1}`} value="" disabled={busy || locked} onChange={e => send(`Replace leg ${i + 1} with ${e.target.value}`, { op: 'replace_leg', legId: leg.id, replacementMode: e.target.value })}><option value="">Choose mode</option>{['bus', 'train', 'metro', 'tram', 'ferry', 'walk'].filter(mode => mode !== leg.mode).map(mode => <option key={mode}>{mode}</option>)}</select></label></div></div></li>; })}</ol><small>Locked services are preserved during searches. They are not reserved.</small></section> : <section className="panel workspace-unselected"><Icon name="route" /><h3>Make room for the possibilities.</h3><p>Select a route in the conversation to customize its legs and see it on the map.</p></section>}
        <section className="panel workspace-scenarios"><div className="section-title"><h2>What if…</h2><Button kind="small" disabled={busy} onClick={() => send('Save a scenario', { op: 'branch_scenario', name: `Plan at ${time(draft.constraints.departure, draft.constraints.timezone)}` })}>Save scenario</Button></div><p>Explore another departure without replacing this plan.</p>{workspace?.scenarios.map(s => <article key={s.id}><div><b>{s.name}</b><small>{dateLabel(s.departure, draft.constraints.timezone)} · {time(s.departure, draft.constraints.timezone)}</small></div><Button disabled={busy} kind="small" onClick={() => send(`Restore scenario: ${s.name}`, { op: 'restore_scenario', scenarioId: s.id })}>Restore</Button></article>)}</section>
        {selected && !selectedFlight && <JourneyMap journey={selected} compact />}
        {draft?.constraints.mode==='flights'&&<section className="panel"><h3>Disruption recovery</h3><Button disabled={busy} onClick={()=>send('Find disruption alternatives',{op:'prepare_recovery'})}>Recovery alternatives</Button></section>}
        {workspace?.journey && <section className="panel"><h3>Keep this journey moving</h3><div className="button-row"><Button disabled={busy} onClick={() => send('Prepare alternatives',{op:'prepare_recovery'})}>Recovery alternatives</Button><Button disabled={busy} onClick={() => send('Check live status')}>Check status</Button><Button onClick={() => navigate('inbox')}>Journey updates</Button></div></section>}
      </>}</aside>
    </div>
  </>;
}

function DraftChange({ value }: { value: ChangeSummary }) {
  if (!value.changes.length) return null;
  const label = (key: string) => ({ budgetCents: 'Budget (cents)', maxTransfers: 'Maximum transfers', maxWalkMinutes: 'Walking limit (min)', minConnectionMinutes: 'Connection buffer (min)', avoidBus: 'Avoid buses', wheelchair: 'Wheelchair access', stepFree: 'Step-free access', walkMinutes: 'Walking (min)' })[key] ?? readable(key);
  return <details className="workspace-change"><summary>{value.operation === 'undo_draft_edit' ? 'What undo restored' : 'What changed'} · {value.changes.length} details</summary><dl>{value.changes.map((c, i) => <div key={i}><dt>{label(c.label)}</dt><dd><span>{String(c.before)}</span><Icon name="arrow" size={12} /><strong>{String(c.after)}</strong></dd></div>)}</dl></details>;
}

function Options({ set, busy, selectedId, comparisonIds, send }: { set: CandidateSet; busy: boolean; selectedId?: string; comparisonIds?: string[]; send: DispatchEdit }) {
  const [checked, setChecked] = useState<string[]>([]), [expanded, setExpanded] = useState(false);
  const expired = set.expiresAt <= Date.now();
  const options = comparisonIds?.length ? set.options.filter(o => comparisonIds.includes(o.id)) : set.options;
  return <div className="workspace-options"><div className="section-title"><h3>{comparisonIds ? 'Side by side' : `${set.options.length} routes to consider`}</h3><Badge tone={expired ? 'amber' : ''}>{expired ? 'Refresh required' : 'Search results'}</Badge></div><div className="workspace-option-grid">{options.slice(0, expanded ? options.length : 3).map(o => <article key={o.id} className={`workspace-option ${o.id === selectedId ? 'selected' : ''}`}><div className="section-title"><b>Option {set.options.findIndex(x => x.id === o.id) + 1}</b>{o.id === selectedId && <Badge tone="mint">Selected</Badge>}</div><div className="workspace-option-labels">{o.labels.map(l => <Badge key={l}>{l}</Badge>)}</div>{o.flight ? <FlightOfferDetails candidate={o.flight} /> : <RouteSummary journey={o.journey} />}<p className="workspace-margin">{o.connectionMarginMinutes == null ? o.flight ? 'See supplier connection details' : 'No transit transfer' : `${o.connectionMarginMinutes} min beyond the required connection buffer`}</p>{o.unknowns.filter(s => s !== o.flight?.limitation).map(s => <p className="workspace-unknown" key={s}>{s}</p>)}<div className="workspace-option-actions"><label><input type="checkbox" checked={checked.includes(o.id)} onChange={e => setChecked(list => e.target.checked ? [...list, o.id] : list.filter(id => id !== o.id))} /> Compare option {set.options.findIndex(x => x.id === o.id) + 1}</label><div className="button-row"><Button kind="small" disabled={busy || expired} onClick={() => send(`Customize option ${set.options.findIndex(x => x.id === o.id) + 1}`, { op: 'select_option', setId: set.id, optionIds: [o.id] })}>Customize</Button><Button kind="primary small" disabled={busy || expired} onClick={() => send(`Select option ${set.options.findIndex(x => x.id === o.id) + 1}`, { op: 'select_option', setId: set.id, optionIds: [o.id] })}>Select</Button></div></div></article>)}</div><div className="button-row">{options.length > 3 && <Button kind="small" onClick={() => setExpanded(!expanded)}>{expanded ? 'Fewer results' : 'More results'}</Button>}<Button kind="small" disabled={busy || checked.length < 2 || checked.length > 5} onClick={() => send('Compare selected options', { op: 'compare_options', setId: set.id, optionIds: checked })}>Compare selected ({checked.length})</Button>{expired && <Button kind="small" disabled={busy} onClick={() => send('Refresh options', { op: 'search_options' })}>Refresh search</Button>}</div><details className="workspace-source"><summary>Sources, coverage & exclusions</summary><p>{set.source} · {new Date(set.fetchedAt).toLocaleString()}</p><p>{set.warning}</p><p>{set.reliabilityNotice}</p>{set.excluded.map((e, i) => <p key={i}>{e.name}: {e.reason}</p>)}</details></div>;
}

function Requirements({ constraints: c, busy, send }: { constraints: TripConstraints; busy: boolean; send: DispatchEdit }) {
  const [form, setForm] = useState(c);
  const update = <K extends keyof TripConstraints>(key: K, value: TripConstraints[K]) => setForm(s => ({ ...s, [key]: value }));
  return <form onSubmit={e => { e.preventDefault(); const patch: WorkspaceCommand['patch'] = {}; for (const k of ['from', 'to', 'departure', 'deadline', 'travelers', 'bags', 'mode', 'avoidOvernight', 'passengers', 'flightWindowHours', 'returnDate', 'additionalFlights', 'resolvedAirports', 'originAirports', 'destinationAirports', 'flexibleDates'] as const) { if (JSON.stringify(form[k]) !== JSON.stringify(c[k])) Object.assign(patch, { [k]: form[k] }); } const changedPreferences = Object.fromEntries(Object.entries(form.preferences).filter(([k, v]) => c.preferences[k as keyof typeof c.preferences] !== v)); if (Object.keys(changedPreferences).length) patch.preferences = changedPreferences; send('Update my trip requirements', { op: 'update_constraints', patch }); }}><fieldset disabled={busy}>
    <Field label="Recommendation priority"><select value={form.preferences.priority} onChange={e=>update('preferences',{...form.preferences,priority:e.target.value as TripConstraints['preferences']['priority']})}>{['balanced','price','fastest','reliable','walking','transfers','carbon'].map(p=><option key={p} value={p}>{readable(p)}</option>)}</select></Field><Field label="Schedules"><select value={form.mode} onChange={e => update('mode', e.target.value as TripConstraints['mode'])}><option value="flights">Flight offers</option><option value="provider">Live Boston transit</option><option value="sample">Illustrative sample routes</option></select></Field>
    <Field label="From">{form.mode === 'flights' ? <AirportPicker label="Departure airport" value={placeName(form.from)} references={form.resolvedAirports} onChange={(code,airport)=>setForm(current=>({...current,from:code,resolvedAirports:airport?[...(current.resolvedAirports??[]).filter(a=>a.iata!==airport.iata),airport]:current.resolvedAirports}))}/> : form.mode === 'provider' ? <PlacePicker label="Trip origin" value={placeName(form.from)} place={typeof form.from === 'object' ? form.from : undefined} onChange={(v, p) => update('from', p ?? v)} /> : <input required aria-label="Trip origin" value={placeName(form.from)} placeholder="City ID, e.g. bos" onChange={e => update('from', e.target.value)} />}</Field>
    <Field label="To">{form.mode === 'flights' ? <AirportPicker label="Arrival airport" value={placeName(form.to)} references={form.resolvedAirports} onChange={(code,airport)=>setForm(current=>({...current,to:code,resolvedAirports:airport?[...(current.resolvedAirports??[]).filter(a=>a.iata!==airport.iata),airport]:current.resolvedAirports}))}/> : form.mode === 'provider' ? <PlacePicker label="Trip destination" value={placeName(form.to)} place={typeof form.to === 'object' ? form.to : undefined} onChange={(v, p) => update('to', p ?? v)} /> : <input required aria-label="Trip destination" value={placeName(form.to)} placeholder="City ID, e.g. nyc" onChange={e => update('to', e.target.value)} />}</Field>
    <Field label="Departure"><input aria-label="Trip departure" type="datetime-local" required value={localInput(new Date(form.departure))} onInput={e => { if (e.currentTarget.value) update('departure', new Date(e.currentTarget.value).toISOString()); }} /></Field>
    <Field label="Arrive by (optional)"><input aria-label="Trip arrival deadline" type="datetime-local" value={form.deadline ? localInput(new Date(form.deadline)) : ''} onInput={e => update('deadline', e.currentTarget.value ? new Date(e.currentTarget.value).toISOString() : null)} /></Field><small>Time controls use your device timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Chat dates use {c.timezone}.</small>
    <div className="workspace-fields"><Field label="Budget (USD)"><input aria-label="Trip budget" type="number" min="0" max="10000" step="0.01" value={form.preferences.budgetCents / 100} onChange={e => update('preferences', { ...form.preferences, budgetCents: Math.round(Number(e.target.value) * 100) })} /></Field>{form.mode !== 'flights' && <><Field label="Travelers"><input aria-label="Trip travelers" type="number" min="1" max="12" value={form.travelers} onChange={e => update('travelers', Number(e.target.value))} /></Field><Field label="Bags"><input aria-label="Trip bags" type="number" min="0" max="12" value={form.bags} onChange={e => update('bags', Number(e.target.value))} /></Field></>}{([['maxTransfers', 'Max transfers', 8], ['maxWalkMinutes', 'Max walking (min)', 120], ['minConnectionMinutes', 'Connection buffer (min)', 120]] as const).map(([key, label, max]) => <Field label={label} key={key}><input type="number" aria-label={label} min="0" max={key === 'maxTransfers' && form.mode === 'flights' ? 4 : max} value={form.preferences[key]} onChange={e => update('preferences', { ...form.preferences, [key]: Number(e.target.value) })} /></Field>)}</div>
    {form.mode === 'flights' && <><FlightSearchScope value={form} onChange={setForm}/><FlightPartyFields constraints={form} onChange={setForm} /><Field label="Return date (optional)"><input type="date" value={form.returnDate??''} disabled={!!form.additionalFlights?.length} onChange={e=>update('returnDate',e.target.value||null)}/></Field><details><summary>Multi-city flights</summary>{(form.additionalFlights??[]).map((leg,i)=><fieldset key={i}><legend>Flight section {i+2}</legend>{(['from','to'] as const).map(key=><Field key={key} label={key==='from'?'From airport':'To airport'}><AirportPicker label={`Section ${i+2} ${key} airport`} value={leg[key]} references={form.resolvedAirports} onChange={(code,airport)=>setForm(current=>({...current,additionalFlights:current.additionalFlights!.map((l,n)=>n===i?{...l,[key]:code}:l),resolvedAirports:airport?[...(current.resolvedAirports??[]).filter(a=>a.iata!==airport.iata),airport]:current.resolvedAirports}))}/></Field>)}<Field label="Departure"><input required type="datetime-local" value={localInput(new Date(leg.departure))} onChange={e=>update('additionalFlights',form.additionalFlights!.map((l,n)=>n===i?{...l,departure:new Date(e.target.value).toISOString()}:l))}/></Field><Button onClick={()=>update('additionalFlights',form.additionalFlights!.filter((_,n)=>n!==i))}>Remove section</Button></fieldset>)}<Button disabled={!!form.returnDate||(form.additionalFlights?.length??0)>=5} onClick={()=>update('additionalFlights',[...(form.additionalFlights??[]),{from:placeName(form.additionalFlights?.at(-1)?.to??form.to),to:'',departure:new Date(Date.parse(form.additionalFlights?.at(-1)?.departure??form.departure)+86400000).toISOString()}])}>Add flight section</Button><small>Up to six flight sections in one supplier ticket group. Airport transport and overnight stays remain outside this airport-to-airport search.</small></details></>}
    <label className="workspace-check"><input type="checkbox" checked={form.avoidOvernight} onChange={e => update('avoidOvernight', e.target.checked)} /> Avoid overnight travel</label><label className="workspace-check"><input type="checkbox" checked={form.preferences.stepFree} onChange={e => update('preferences', { ...form.preferences, stepFree: e.target.checked, wheelchair: e.target.checked })} /> Require verified step-free access</label><label className="workspace-check"><input type="checkbox" checked={form.preferences.avoidBus} onChange={e => update('preferences', { ...form.preferences, avoidBus: e.target.checked })} /> Avoid buses</label><Button type="submit" kind="primary" disabled={busy}>Apply & search</Button>
  </fieldset></form>;
}
