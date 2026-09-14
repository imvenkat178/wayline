import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from '../api';
import type {WorkspaceSnapshot} from '../workspaceTypes';
import {Button,Field,Notice} from './ui';
type Order={id:string;version:number;conversationId:string;supplierReference:string;ticketState:string};
type Monitor={id:string;orderId:string;state:string;lastCheckedAt?:string;lastError?:string|null;notice:string};
export default function SupplierMonitorForm({workspace}:{workspace:WorkspaceSnapshot}) {
 const [orders,setOrders]=useState<Order[]>([]),[monitors,setMonitors]=useState<Monitor[]>([]),[available,setAvailable]=useState(false),[orderId,setOrderId]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0);
 const load=useCallback(async()=>{const current=generation.current;const [o,m]=await Promise.all([api<Order[]>('/shopping/orders'),api<{available:boolean;monitors:Monitor[]}>('/shopping/monitors')]);if(current!==generation.current)return;setOrders(o.filter(x=>x.conversationId===workspace.conversation.id));setMonitors(m.monitors);setAvailable(m.available);},[workspace.conversation.id]);
 useEffect(()=>{const current=++generation.current;void load().catch(e=>{if(current===generation.current)setError(e.message);});return()=>{generation.current=current+1;};},[load]);
 const change=async(order:Order,enabled:boolean)=>{const current=generation.current;setBusy(true);setError('');try{await api('/shopping/monitors','POST',{orderId:order.id,orderVersion:order.version,enabled,consent});if(current===generation.current)await load();}catch(e){if(current===generation.current)setError((e as Error).message);}finally{if(current===generation.current)setBusy(false);}};
 return <section aria-label="Supplier flight monitoring"><h4>Flight status alerts for your booking</h4>{error&&<Notice tone="error">{error}</Notice>}{!available&&<Notice>Licensed FlightAware status access is required to start background checks.</Notice>}
 <p>Checks run every ten minutes within 24 hours of each flight. Delays and gate changes can alert you; your bookings remain unchanged.</p>
 <Field label="Supplier booking to monitor"><select value={orderId} onChange={e=>setOrderId(e.target.value)}><option value="">Choose an issued booking</option>{orders.filter(o=>['issued','exchanged'].includes(o.ticketState)).map(o=><option key={o.id} value={o.id}>{o.supplierReference}</option>)}</select></Field>
 <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Allow background flight status checks and in-app alerts for this booking.</label>
 <Button disabled={busy||!available||!consent||!orderId} onClick={()=>{const order=orders.find(o=>o.id===orderId);if(order)void change(order,true);}}>Enable flight monitoring</Button>
 {monitors.filter(m=>orders.some(o=>o.id===m.orderId)).map(m=><div key={m.id}><p>{orders.find(o=>o.id===m.orderId)?.supplierReference}: {m.state}{m.lastCheckedAt?' · checked '+new Date(m.lastCheckedAt).toLocaleString():''}</p>{m.lastError&&<Notice>{m.lastError}</Notice>}<Button disabled={busy||m.state!=='active'} onClick={()=>{const order=orders.find(o=>o.id===m.orderId);if(order)void change(order,false);}}>Pause flight monitoring</Button></div>)}
 <p>Push delivery follows your notification preferences and device permission.</p></section>;
}
