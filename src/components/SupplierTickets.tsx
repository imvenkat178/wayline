import {useEffect,useState} from 'react';
import {api} from '../api';
import {useApp} from '../context';
import {Button,Notice} from './ui';
type Order={id:string;live:boolean;conversationId:string;supplier:string;supplierReference:string;bookingReference?:string;paymentState:string;ticketState:string;observedAt:string;documents:{type:string;reference:string}[]};
export default function SupplierTickets() {
 const {boot,navigate}=useApp(),[orders,setOrders]=useState<Order[]>([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;void api<Order[]>('/shopping/orders').then(o=>{if(active)setOrders(o);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[boot.user.id]);
 return <section aria-label="Supplier bookings and ticket references"><h3>Supplier bookings</h3>{error&&<Notice tone="error">{error}</Notice>}{!orders.length&&<p>No supplier bookings are recorded.</p>}
 {orders.map(o=><article className="panel" key={o.id}><h4>{o.bookingReference??o.supplierReference}</h4><Notice>{o.live?'Supplier booking':'Test inventory — no real ticket'}</Notice><p>Ticket status: {o.ticketState} · Payment status: {o.paymentState}</p><p>{o.supplier} · observed {new Date(o.observedAt).toLocaleString()}</p>
 {o.documents?.length?<ul>{o.documents.map((d,i)=><li key={i}>{d.type.replaceAll('_',' ')}: {d.reference}</li>)}</ul>:<p>The supplier has not provided a ticket document reference.</p>}
 <p>These references are not boarding passes. Use the carrier-issued ticket or barcode for travel. An exchanged booking requires its new ticket. Cancelled or superseded documents must not be used.</p>
 <div className="button-row"><a className="btn small" href={'/api/shopping/orders/'+o.id+'/documents'} download>Download ticket references</a><a className="btn small" href={'/api/shopping/orders/'+o.id+'/receipt'} download>Download payment record</a><Button kind="small" onClick={()=>{try{localStorage.setItem('wayline.conversation.v1.'+boot.user.id,o.conversationId);}catch{/* Optional local preference. */}navigate('assistant');}}>Open booking conversation</Button></div></article>)}
 </section>;
}
