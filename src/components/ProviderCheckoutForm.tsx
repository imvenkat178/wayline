import {useState} from 'react';
import {api} from '../api';
import type {WorkspaceSnapshot} from '../workspaceTypes';
import {Button,Notice} from './ui';
type Checkout={id:string;provider:string;live:boolean;expiresAt:number;href:string;bookingConfirmed:false;notice:string};
export default function ProviderCheckoutForm({workspace,available}:{workspace:WorkspaceSnapshot;available:boolean}) {
 const [checkout,setCheckout]=useState<Checkout|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 if(!available)return <Notice>Provider checkout is also unavailable until its integration and approved destinations are configured.</Notice>;
 return <section aria-label="Provider checkout"><h4>Continue with the ticket provider</h4><p>The provider will collect traveler and payment details and present its final purchase review.</p>{error&&<Notice tone="error">{error}</Notice>}
 <Button disabled={busy||!workspace.draft.selected?.flight} onClick={()=>{setBusy(true);setError('');void api<Checkout>('/shopping/checkouts','POST',{conversationId:workspace.conversation.id,draftVersion:workspace.draft.version}).then(setCheckout).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Prepare provider checkout</Button>
 {checkout&&<><Notice>{checkout.notice}</Notice><p>{checkout.live?'Provider checkout':'Provider test checkout'} · expires {new Date(checkout.expiresAt).toLocaleTimeString()}</p><a className="btn" href={checkout.href} target="_blank" rel="noopener noreferrer">Open {checkout.provider} checkout</a><p>Wayline booking status: not confirmed</p></>}
 </section>;
}
