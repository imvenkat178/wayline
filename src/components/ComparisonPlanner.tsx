import { PlacePicker } from "./PlacePicker";
import type { Place } from "../types";
import { useEffect, useRef, useState } from "react";
import { api, localInput } from "../api";
import { Button, Field, Badge, Notice, Modal } from "./ui";
type Money={amount:number;currency:string;scale:number};
type Point={id:string;name:string;iata?:string;kind:"airport"|"station"|"address";country:"US";timezone:string};
type Passenger={id:string;type:"adult"|"child";age?:number;personal:number;cabin:number;checked:number};
type Service={id:string;operator:string;marketingOperator?:string;serviceNumber?:string;origin:Point;destination:Point;departure:string;arrival:string};
type Candidate={id:string;services:Service[];departure:string;arrival:string;returnArrival?:string|null;durationMinutes:number;transfers:number;
  pricing:{total:Money|null;complete:boolean;unknownComponents:string[]};limitation?:string;badges?:string[];expiresAt:string;
  components:{id:string;label:string;money:Money|null;includedIn?:string}[];conditions:{refund:string;change:string;protection:string}};
type Search={id:string;version:number;state:string;reason?:string;results:{complete:Candidate[];incomplete:Candidate[];excluded:{id:string;reason:string}[]};
  queries:{state:string;origin:string;destination:string;date:string}[];scope:{omitted:number;provider:string;offerLimitPerQuery:number};completedAt?:string};
type Review={id:string;changed:boolean;notice:string;candidate:Candidate|null;expiresAt:number};
type Capability={providers:{provider:string;configured:boolean;mode?:string;reason:string;capabilities:Record<string,boolean>}[]};
type Watch={id:string;version:number;state:string;threshold:Money;expiresAt:number};
type Saved={id:string;candidate:Candidate;priceValidUntil:string;state:string};
const airports=[["BOS","Boston Logan"],["JFK","New York JFK"],["LGA","New York LaGuardia"],["EWR","Newark Liberty"],["PHL","Philadelphia"],["DCA","Washington Reagan"]];
const point=(code:string):Point=>({id:"airport:"+code,name:airports.find(a=>a[0]===code)?.[1]??code,iata:code,kind:"airport",country:"US",timezone:"America/New_York"});
const amount=(m:Money|null)=>m?new Intl.NumberFormat(undefined,{style:"currency",currency:m.currency}).format(m.amount/10**m.scale):"Price incomplete";
const stamp=(s:string,tz:string)=>new Intl.DateTimeFormat(undefined,{timeZone:tz,month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(s));
export function ComparisonPlanner() {
  const [open,setOpen]=useState(false),[caps,setCaps]=useState<Capability|null>(null),[saved,setSaved]=useState<Saved[]>([]);
  const [includeAccess,setIncludeAccess]=useState(false),[accessText,setAccessText]=useState(""),[accessPlace,setAccessPlace]=useState<Place|undefined>();
  const [from,setFrom]=useState("BOS"),[to,setTo]=useState("JFK"),[depart,setDepart]=useState(localInput(new Date(Date.now()+86400000)));
  const [returnDate,setReturn]=useState(""),[budget,setBudget]=useState(""),[deadline,setDeadline]=useState("");
  const [watches,setWatches]=useState<Watch[]>([]),[customBags,setCustomBags]=useState(false),[bagOverrides,setBagOverrides]=useState<Record<string,{personal:number;cabin:number;checked:number}>>({});
  const [adults,setAdults]=useState(1),[children,setChildren]=useState<number[]>([]),[bags,setBags]=useState({personal:0,cabin:0,checked:0});
  const [flexible,setFlexible]=useState(false),[overnight,setOvernight]=useState(false),[connections,setConnections]=useState(0);
  const [search,setSearch]=useState<Search|null>(null),[review,setReview]=useState<Review|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const epoch=useRef(0);
  useEffect(()=>{
    let valid=true; const lifecycle=epoch;
    void Promise.all([api<Capability>("/shopping/capabilities"),api<Saved[]>("/shopping/saved"),api<Watch[]>("/shopping/watches")]).then(([c,s,w])=>{if(valid){setCaps(c);setSaved(s);setWatches(w);}}).catch(e=>{if(valid)setError(e.message);});
    return()=>{valid=false;lifecycle.current++;};
  },[]);
  const id=search?.id, state=search?.state;
  useEffect(()=>{
    if(!id||!["queued","partial"].includes(state??""))return;
    let live=true;let timer:ReturnType<typeof setTimeout>;
    const poll=()=>{timer=setTimeout(()=>{void api<Search>("/shopping/searches/"+id).then(s=>{if(live){setSearch(s);if(["queued","partial"].includes(s.state))poll();}}).catch(e=>{if(live)setError(e.message);});},2000);};
    poll();return()=>{live=false;clearTimeout(timer);};
  },[id,state]);
  const action=async(fn:()=>Promise<void>)=>{const version=++epoch.current;setBusy(true);setError("");try{await fn();}catch(e){if(version===epoch.current)setError(e instanceof Error?e.message:"Request failed.");}finally{if(version===epoch.current)setBusy(false);}};
  const submit=async()=>{
    const version=epoch.current;setReview(null);setMessage("");
    if(search&&["queued","partial"].includes(search.state))await api("/shopping/searches/"+search.id+"/cancel","POST",{version:search.version});
    const departure=new Date(depart).toISOString();
    const passengers:Passenger[]=[...Array.from({length:adults},(_,i)=>({id:"adult-"+(i+1),type:"adult" as const,...bags,...(customBags?bagOverrides["adult-"+(i+1)]:{})})),
      ...children.map((age,i)=>({id:"child-"+(i+1),type:"child" as const,age,...bags,...(customBags?bagOverrides["child-"+(i+1)]:{})}))];
    const data=await api<Search>("/shopping/searches","POST",{key:crypto.randomUUID(),request:{
      origin:includeAccess&&accessPlace?{id:accessPlace.id,name:accessPlace.name,kind:"station",country:"US",lat:accessPlace.lat,lon:accessPlace.lon,timezone:accessPlace.timezone}:point(from),originAirports:includeAccess?[from]:[],destination:point(to),departure,latestDeparture:new Date(Date.parse(departure)+(flexible?71:23)*3600000).toISOString(),
      ...(returnDate?{returnDate}:{}),...(deadline?{deadline:new Date(deadline).toISOString()}:{}),passengers,currency:"USD",
      budget:budget?{amount:Math.round(Number(budget)*100),currency:"USD",scale:2}:null,
      maxTransfers:connections,allowOvernight:overnight,flexibleDates:flexible?[1,2].map(n=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(Date.parse(departure)+n*86400000))):[],
    }});
    if(version===epoch.current)setSearch(data);
  };
  const reviewCandidate=(candidate:Candidate)=>action(async()=>{
    if(!search)return;const version=epoch.current;
    const data=await api<Review>("/shopping/searches/"+search.id+"/review","POST",{offerId:candidate.id});
    if(version===epoch.current)setReview(data);
  });
  const people=[...Array.from({length:adults},(_,i)=>({id:"adult-"+(i+1),label:"Adult "+(i+1)})),...children.map((_,i)=>({id:"child-"+(i+1),label:"Child "+(i+1)}))];
  const flight=caps?.providers.find(p=>p.provider==="duffel");
  return <section className="comparison-planner" id="flight-comparison">
    <div className="comparison-heading"><div><span className="eyebrow">MORE WAYS TO GET THERE</span><h2>Flights, with the full price in view.</h2><p>Compare your whole party, baggage and conditions in one place.</p></div>
      <Button kind="primary" onClick={()=>setOpen(!open)}>{open?"Close comparison":"Compare flights"}</Button></div>
    {open&&<div className="comparison-content">
      <div className="comparison-scope"><Badge tone={flight?.configured?"mint":"amber"}>{flight?.configured?flight.mode==="live-enabled"?"Supplier configured":"Supplier test mode":"Supplier access needed"}</Badge>
        <span>Domestic economy · Selected endpoints · Review before saving</span></div>
      {!flight?.configured&&<Notice>Live flight shopping needs approved supplier access. You can set up your comparison below; no sample fares will replace unavailable inventory.</Notice>}
      <label className="comparison-checks"><input type="checkbox" checked={includeAccess} onChange={e=>setIncludeAccess(e.target.checked)}/> Include a Boston station connection</label>
      {includeAccess&&<PlacePicker label="Boston departure station" value={accessText} place={accessPlace} onChange={(text,place)=>{setAccessText(text);setAccessPlace(place);}}/>}
      <form onSubmit={e=>{e.preventDefault();void action(submit);}} className="comparison-form">
        <Field label="Departure airport"><select value={from} onChange={e=>setFrom(e.target.value)}>{airports.map(([id,name])=><option value={id} key={id}>{id} · {name}</option>)}</select></Field>
        <Field label="Arrival airport"><select value={to} onChange={e=>setTo(e.target.value)}>{airports.map(([id,name])=><option value={id} key={id}>{id} · {name}</option>)}</select></Field>
        <Field label="Depart after (device timezone)"><input type="datetime-local" required value={depart} onChange={e=>setDepart(e.target.value)}/></Field>
        <Field label="Return date (optional)"><input type="date" value={returnDate} onChange={e=>setReturn(e.target.value)}/></Field>
        <Field label="Arrival deadline (optional)"><input type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)}/></Field>
        <Field label="Whole party budget (USD)"><input type="number" min="0" max="100000" step=".01" placeholder="No limit" value={budget} onChange={e=>setBudget(e.target.value)}/></Field>
        <Field label="Adults"><input type="number" min="1" max={9-children.length} value={adults} onChange={e=>setAdults(Math.max(1,Math.min(9-children.length,+e.target.value)))}/></Field>
        <Field label="Flight connections"><select value={connections} onChange={e=>setConnections(+e.target.value)}><option value={0}>Nonstop</option><option value={1}>Up to one connection in total</option></select></Field>
        <div className="comparison-party"><Button disabled={adults+children.length>=9} onClick={()=>setChildren(c=>[...c,8])}>Add child</Button>
          {children.map((age,i)=><div key={i}><Field label={"Child "+(i+1)+" age"}><input type="number" min="2" max="17" value={age} onChange={e=>setChildren(c=>c.map((v,n)=>n===i?+e.target.value:v))}/></Field><Button onClick={()=>setChildren(c=>c.filter((_,n)=>n!==i))}>Remove child {i+1}</Button></div>)}</div>
        <fieldset className="comparison-bags"><legend>Bags per traveler</legend>{(["personal","cabin","checked"] as const).map(k=><Field key={k} label={k==="personal"?"Personal item":k==="cabin"?"Cabin bags":"Checked bags"}><input type="number" min="0" max={k==="personal"?1:k==="cabin"?2:3} value={bags[k]} onChange={e=>setBags(b=>({...b,[k]:+e.target.value}))}/></Field>)}</fieldset>
        <div className="comparison-checks"><label><input type="checkbox" checked={customBags} onChange={e=>setCustomBags(e.target.checked)}/> Set bags separately for each traveler</label></div>
        {customBags&&people.map(person=><fieldset className="comparison-bags" key={person.id}><legend>{person.label}</legend>{(["personal","cabin","checked"] as const).map(k=><Field key={k} label={person.label+" "+k+" bags"}><input type="number" min="0" max={k==="personal"?1:k==="cabin"?2:3} value={(bagOverrides[person.id]??bags)[k]} onChange={e=>setBagOverrides(old=>({...old,[person.id]:{...(old[person.id]??bags),[k]:+e.target.value}}))}/></Field>)}</fieldset>)}
        <div className="comparison-checks"><label><input type="checkbox" checked={flexible} onChange={e=>setFlexible(e.target.checked)}/> Also check the next two dates</label><label><input type="checkbox" checked={overnight} onChange={e=>setOvernight(e.target.checked)}/> Allow overnight flights</label></div>
        <p className="fine-print">Airport transport is included only when you select a Boston connection. Other airport transport and hotels are outside this comparison. Missing bag prices, unverified connections and test offers are shown separately from complete live prices.</p>
        <Button type="submit" kind="primary" disabled={busy||from===to||(includeAccess&&!accessPlace)}>{busy?"Checking…":"Search selected dates"}</Button>
      </form>
      {error&&<Notice tone="error">{error}</Notice>}{message&&<Notice>{message}</Notice>}
      {search&&<div className="comparison-results" aria-live="polite">
        <div className="section-title"><h3>{search.state==="blocked"?"Flight shopping is not connected":search.state==="complete"?"Comparison complete within this search":"Comparison: "+search.state.replaceAll("-"," ")}</h3>
          {["queued","partial"].includes(search.state)&&<Button disabled={busy} onClick={()=>void action(async()=>setSearch(await api<Search>("/shopping/searches/"+search.id+"/cancel","POST",{version:search.version})))}>Cancel search</Button>}</div>
        <p>{search.reason}</p><small>{search.queries.filter(q=>q.state==="complete").length} of {search.queries.length} selected queries completed · {search.scope.provider} · Up to {search.scope.offerLimitPerQuery} returned offers per query{search.scope.omitted>0?" · "+search.scope.omitted+" additional queries outside this search limit":""}</small>
        <p className="fine-print">{search.queries.map(q=>q.origin+" → "+q.destination+" · "+q.date).join(" / ")}</p>
        {search.results.complete.length>0&&<h3>Complete live prices</h3>}
        {search.results.complete.map(c=><ComparisonCard key={c.id} candidate={c} onReview={()=>void reviewCandidate(c)} disabled={busy}/>)}
        {search.results.incomplete.length>0&&<h3>Prices or connection details to verify</h3>}
        {search.results.incomplete.map(c=><ComparisonCard key={c.id} candidate={c} onReview={()=>void reviewCandidate(c)} disabled={busy}/>)}
        {search.state==="complete"&&!search.results.complete.length&&!search.results.incomplete.length&&<Notice>No matching offers were returned for these constraints.</Notice>}
        {!!search.results.excluded.length&&<details><summary>{search.results.excluded.length} offers excluded by your constraints</summary>{search.results.excluded.map((x,i)=><p key={i}>{x.reason}</p>)}</details>}
      </div>}
      <div className="comparison-watch"><h3>Watch for a lower complete price</h3><p className="fine-print">Use your whole-party budget as the target. Checks run at most every 30 minutes and stop before departure or after seven days. Alerts follow your notification preferences.</p><Button disabled={busy||!search||!budget||!flight?.capabilities.backgroundShoppingAllowed||!flight?.capabilities.priceHistoryAllowed} onClick={()=>void action(async()=>{if(!search)return;const expiry=Math.min(Date.now()+7*86400000,new Date(depart).getTime()-3600000);const watch=await api<Watch>("/shopping/watches","POST",{searchId:search.id,consent:true,threshold:{amount:Math.round(+budget*100),currency:"USD",scale:2},expiresAt:new Date(expiry).toISOString()});setWatches(w=>[watch,...w]);})}>Enable price watch</Button>{!flight?.capabilities.backgroundShoppingAllowed&&<p className="fine-print">Unavailable: the supplier has not enabled permission for background shopping and price history.</p>}{watches.map(w=><div className="comparison-metrics" key={w.id}><span>Target {amount(w.threshold)} · {w.state} · Until {new Date(w.expiresAt).toLocaleString()}</span>{w.state==="active"&&<Button disabled={busy} onClick={()=>void action(async()=>{const next=await api<Watch>("/shopping/watches/"+w.id+"/cancel","POST",{version:w.version});setWatches(items=>items.map(item=>item.id===w.id?next:item));})}>Stop price watch</Button>}</div>)}</div>
      {!!saved.length&&<div className="comparison-saved"><h3>Saved comparisons</h3><p className="fine-print">These are planning records. A saved fare does not hold a seat or issue a ticket.</p>{saved.map(s=><article key={s.id}><b>{s.candidate.services[0]?.origin.name} → {s.candidate.services[0]?.destination.name}</b><span>{Date.parse(s.priceValidUntil)<=Date.now()?"Fare expired — search again":"Fare checked until "+new Date(s.priceValidUntil).toLocaleTimeString()}</span></article>)}</div>}
      <p className="fine-print">Flight monitoring, rail/bus shopping, bookings and refunds require their own authorized provider connections. Background price watches are disabled unless the supplier explicitly permits them.</p>
    </div>}
    {review&&<Modal title="Review refreshed comparison" onClose={()=>setReview(null)}>
      <Notice>{review.notice}</Notice>{review.candidate&&<ComparisonCard candidate={review.candidate}/>}
      <p>Save this comparison for reference. No purchase, seat reservation or ticket change will occur.</p>
      <Button kind="primary" disabled={busy||!review.candidate||review.expiresAt<=Date.now()} onClick={()=>void action(async()=>{
        const version=epoch.current;const plan=await api<Saved>("/shopping/reviews/"+review.id+"/confirm","POST");
        if(version===epoch.current){setSaved(s=>[plan,...s.filter(x=>x.id!==plan.id)]);setReview(null);setMessage("Comparison saved. No ticket was purchased.");}
      })}>Confirm and save comparison</Button>{error&&<Notice tone="error">{error}</Notice>}
    </Modal>}
  </section>;
}
function ComparisonCard({candidate:c,onReview,disabled}:{candidate:Candidate;onReview?:()=>void;disabled?:boolean}) {
  return <article className="comparison-card">
    <div className="comparison-card-heading"><div>{c.badges?.map(b=><Badge tone="mint" key={b}>{b}</Badge>)}{c.limitation&&<Badge tone="amber">{c.limitation}</Badge>}</div><strong>{amount(c.pricing.total)}<small>whole party{c.returnArrival?" · round trip":""}</small></strong></div>
    {c.services.map(s=><div className="comparison-leg" key={s.id}><div><b>{s.origin.iata??s.origin.name} → {s.destination.iata??s.destination.name}</b><span>{s.operator} · {s.serviceNumber}</span></div><div><span>{stamp(s.departure,s.origin.timezone)}</span><span>{stamp(s.arrival,s.destination.timezone)}</span></div></div>)}
    <div className="comparison-metrics"><span>{c.durationMinutes} min travel</span><span>{c.transfers} connections</span><span>Fare expires {new Date(c.expiresAt).toLocaleTimeString()}</span></div>
    <details><summary>Price breakdown and conditions</summary>{c.components.map(p=><p key={p.id}>{p.label}: {p.includedIn?"Included in supplier fare":amount(p.money)}</p>)}<p>Refund: {c.conditions.refund}. Change: {c.conditions.change}. Connection protection: {c.conditions.protection}.</p></details>
    {onReview&&<Button disabled={disabled||Date.parse(c.expiresAt)<=Date.now()} onClick={onReview}>Refresh offer & review</Button>}
  </article>;
}
