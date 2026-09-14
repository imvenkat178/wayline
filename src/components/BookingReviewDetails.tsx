import type {FlightMoney} from '../workspaceTypes';
export interface BookingReview {
 id:string;version:number;kind:string;state:string;confirmationToken:string;expiresAt:number;
 quote:{id:string;charge:FlightMoney;refund:FlightMoney|null;terms:string;live:boolean;paymentAuthenticationRequired:boolean;itinerary:{services?:{id:string;operator:string;serviceNumber?:string;departure:string;arrival:string;origin:{name:string};destination:{name:string}}[]}};
 source:{recovery?:unknown;orderId?:string;orderVersion?:number;draftVersion?:number;changeCardId?:string;details?:{cardId?:string;services:{id:string;quantity:number}[];passengers?:{id:string;givenName:string;familyName:string;bornOn:string;title:"mr"|"ms"|"mrs"|"miss"|"dr";gender:"m"|"f";email:string;phone:string}[]}};
}
const money=(m:FlightMoney)=>new Intl.NumberFormat(undefined,{style:'currency',currency:m.currency}).format(m.amount/10**m.scale);
const label=(key:string)=>key.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');
function Term({name,value}:{name:string;value:unknown}){
 if(/Ids?$|_ids?$|^id$/.test(name))return null;
 if(value==null)return <p>{label(name)}: Not provided by supplier</p>;
 if(typeof value==='object'&&!Array.isArray(value)&&'amount' in value&&'currency' in value&&'scale' in value)return <p>{label(name)}: {money(value as FlightMoney)}</p>;
 if(typeof value==='object')return <details open><summary>{label(name)}</summary>{Object.entries(value).map(([key,v])=><Term key={key} name={key} value={v}/>)}</details>;
 return <p>{label(name)}: {typeof value==='boolean'?(value?'Yes':'No'):String(value)}</p>;
}
export function BookingReviewDetails({review}:{review:BookingReview}){
 let terms:unknown;try{terms=JSON.parse(review.quote.terms);}catch{terms=review.quote.terms;}
 return <><p>Operation: {review.kind} · {review.quote.live?'Live transaction':'Supplier test transaction'}</p>
 <p>Charge now: <strong>{money(review.quote.charge)}</strong></p>
 {review.quote.refund&&<p>Quoted refund: {money(review.quote.refund)}. Refund approval and receipt of funds are tracked separately.</p>}
 {review.kind==='refund'&&<p>This refund request cancels the covered tickets if the supplier confirms it.</p>}
 <p>Review expires {new Date(review.expiresAt).toLocaleString()}</p>
 <h5>Covered itinerary</h5><ol>{review.quote.itinerary.services?.map(s=><li key={s.id}><strong>{s.operator} {s.serviceNumber}</strong><br/>{s.origin.name} to {s.destination.name}<br/>{new Date(s.departure).toLocaleString()} to {new Date(s.arrival).toLocaleString()}</li>)}</ol>
 {review.source.details?.passengers?.length?<><h5>Travelers</h5><ul>{review.source.details.passengers.map(p=><li key={p.id}>{p.givenName} {p.familyName} · born {p.bornOn}</li>)}</ul></>:null}
 {review.source.recovery?<><h5>Recovery context and previous spending</h5><Term name="Recovery" value={review.source.recovery}/></>:null}
 <h5>Supplier terms and charges</h5><Term name="Conditions" value={terms}/>
 <p>Review all supplier conditions above before confirming. Changes to the amount, itinerary or conditions require a new review.</p></>;
}
