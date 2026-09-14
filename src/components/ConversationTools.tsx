import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { WorkspaceSnapshot } from '../workspaceTypes';
import type { TravelerActionId } from '../travelerActions';
import type { Journey, Ticket } from '../types';
import { saveOffline } from '../offline';
import { Button, Field, Notice } from './ui';
const MonitorForm=lazy(()=>import('./SupplierMonitorForm'));
const RecoveryForm=lazy(()=>import('./SupplierRecoveryForm'));
const BookingForm=lazy(()=>import('./BookingConversationForm'));
const Profile=lazy(()=>import('../pages/Profile'));
const Wallet=lazy(()=>import('../pages/Wallet'));
const Commute=lazy(()=>import('../pages/Commute'));
const Offline=lazy(()=>import('../pages/Offline'));
export function ConversationTools({action,workspace,onConversation}:{action:TravelerActionId;workspace:WorkspaceSnapshot;onConversation?:(id:string)=>void}) {
  const [open,setOpen]=useState(false);
  const tab=({manage_travelers:'traveler',manage_contacts:'contact',manage_preferences:'preferences',manage_favorites:'favorite',manage_notifications:'notifications'} as Partial<Record<TravelerActionId,string>>)[action];
  return <section className="conversation-tools" aria-label="Protected traveler tools"><Button onClick={()=>setOpen(!open)}>{open?'Close tools':'Open protected tools'}</Button>{open&&<Suspense fallback={<p role="status">Loading controls…</p>}><div className="conversation-protected-content">{action==='trip_status'?<MonitorForm workspace={workspace}/>:action==='prepare_recovery'?<RecoveryForm workspace={workspace} onConversation={onConversation}/>:['book_ticket','cancel_ticket','exchange_ticket','refund_ticket'].includes(action)?<BookingForm workspace={workspace} kind={({book_ticket:'book',cancel_ticket:'cancel',exchange_ticket:'exchange',refund_ticket:'refund'} as Record<string,'book'|'cancel'|'exchange'|'refund'>)[action]}/>:tab?<><Profile initialTab={tab}/>{action==='manage_notifications'&&<MonitorForm workspace={workspace}/>}</>:action==='manage_tickets'?<Wallet/>:action==='manage_passes'?<Wallet initialTab="passes"/>:action==='manage_commutes'?<Commute/>:['share_trip','revoke_share','offline_pack','manage_watches'].includes(action)?<UtilityForm action={action} workspace={workspace}/>:<Notice>Supplier booking and servicing require approved provider access. A saved plan or imported document cannot authorize ticket servicing.</Notice>}</div></Suspense>}</section>;
}
function UtilityForm({action,workspace}:{action:TravelerActionId;workspace:WorkspaceSnapshot}) {
  const [error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  const [packVersion,setPackVersion]=useState(0);
  const [hours,setHours]=useState(24),[location,setLocation]=useState(false),[passphrase,setPassphrase]=useState('');
  const [threshold,setThreshold]=useState(''),[consent,setConsent]=useState(false);
  const [records,setRecords]=useState<{id:string;version?:number;state?:string;expiresAt:number}[]>([]);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const load=useCallback(async()=>setRecords(await api(action==='manage_watches'?'/shopping/watches':'/shares')),[action]);
  useEffect(()=>{if(['share_trip','revoke_share','manage_watches'].includes(action))void load().catch(e=>setError(e.message));},[action,load]);
  const j=workspace.journey;
  return <div>{error&&<Notice tone="error">{error}</Notice>}{status&&<p role="status">{status.startsWith('http')?<a href={status} target="_blank" rel="noreferrer">Open your expiring share link</a>:status}</p>}
    {action==='offline_pack'?<><form onSubmit={e=>{e.preventDefault();void run(async()=>{const itinerary=j??(workspace.savedComparison?await api<Journey>('/shopping/saved/'+workspace.savedComparison.id+'/itinerary'):null);if(!itinerary)throw Error('Save and link a journey or flight comparison first.');const tickets=(await api<Ticket[]>('/records/ticket')).filter(t=>t.journeyId===itinerary.id);await saveOffline({journey:itinerary,tickets,savedAt:new Date().toISOString(),expiresAt:new Date(Math.max(Date.now()+86400000,Date.parse(itinerary.arrival)+86400000)).toISOString()},passphrase);setPassphrase('');setStatus('Encrypted offline pack saved on this device.');setPackVersion(v=>v+1);});}}><Field label="Offline passphrase"><input type="password" autoComplete="new-password" minLength={12} required value={passphrase} onChange={e=>setPassphrase(e.target.value)}/></Field><Button type="submit" disabled={busy||(!j&&!workspace.savedComparison)}>Create offline pack</Button></form><Offline key={packVersion}/></>:<>
    {action==='share_trip'&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{if(!j&&!workspace.savedComparison)throw Error('Save a journey or flight comparison first.');const path=j?'/journeys/'+j.id+'/share':'/shopping/saved/'+workspace.savedComparison!.id+'/share';const r=await api<{token:string}>(path,'POST',{hours,location});setStatus(`${window.location.origin}/?share=${encodeURIComponent(r.token)}`);await load();});}}><Field label="Link lifetime (hours)"><input type="number" min={1} max={168} value={hours} onChange={e=>setHours(Number(e.target.value))}/></Field><label><input type="checkbox" checked={location} onChange={e=>setLocation(e.target.checked)}/> Include journey location</label><Button type="submit" disabled={busy||(!j&&!workspace.savedComparison)}>Create sharing link</Button></form>}
    {action==='manage_watches'&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{if(!/^\d+(\.\d{1,2})?$/.test(threshold))throw Error('Enter a USD amount with at most two decimal places.');await api('/shopping/watches','POST',{searchId:workspace.draft.activeShoppingId,threshold:{amount:Math.round(Number(threshold)*100),currency:'USD',scale:2},consent,expiresAt:new Date(Math.min(Date.now()+86400000,Date.parse(workspace.draft.constraints.departure)-60000)).toISOString()});setStatus('Price watch created.');await load();});}}><Field label="Complete party price target (USD)"><input inputMode="decimal" value={threshold} required onChange={e=>setThreshold(e.target.value)}/></Field><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Allow background price checks and fare alerts for one day</label><Button disabled={busy||!consent||!workspace.draft.activeShoppingId} type="submit">Create price watch</Button><small>Available only when the supplier permits background shopping and fare history.</small></form>}
    {records.map(r=><div className="button-row" key={r.id}><span>{r.state??'Shared link'} · expires {new Date(r.expiresAt).toLocaleString()}</span><Button disabled={busy||r.state==='cancelled'} onClick={()=>void run(async()=>{if(action==='manage_watches')await api(`/shopping/watches/${r.id}/cancel`,'POST',{version:r.version});else await api(`/shares/${r.id}`,'DELETE');await load();setStatus('Access or monitoring stopped.');})}>{action==='manage_watches'?'Stop watch':'Revoke link'}</Button></div>)}
    </>}
  </div>;
}
