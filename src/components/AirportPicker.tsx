import { useState } from 'react';
import { api } from '../api';
import type { TripConstraints } from '../workspaceTypes';
import { flightAirports } from '../flightAirports';
import { Button,Notice } from './ui';
type Airport=NonNullable<TripConstraints['resolvedAirports']>[number];
export function AirportPicker({label,value,references=[],onChange}:{label:string;value:string;references?:Airport[];onChange:(code:string,airport?:Airport)=>void}) {
 const [query,setQuery]=useState(''),[results,setResults]=useState<Airport[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const options=[...new Map([...flightAirports.map(([iata,name])=>({iata,name})),...references,...results].map(a=>[a.iata,a])).values()];
 return <div><select aria-label={label} required value={value} onChange={e=>onChange(e.target.value,[...references,...results].find(a=>a.iata===e.target.value))}><option value="">Choose an exact airport</option>{value&&!options.some(a=>a.iata===value)&&<option value={value}>Resolve airport for {value}</option>}{options.map(a=><option key={a.iata} value={a.iata}>{a.iata} · {a.name}</option>)}</select><div className="button-row"><input aria-label={`Search US airports for ${label.toLowerCase()}`} value={query} onChange={e=>setQuery(e.target.value)} placeholder="US city or airport code"/><Button disabled={busy||query.trim().length<2} onClick={()=>{setBusy(true);setError('');void api<{airports:Airport[]}>(`/shopping/airports?q=${encodeURIComponent(query)}`).then(r=>setResults(r.airports)).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Find airport</Button></div>{results.length>1&&<small>Several airports match. Choose the exact airport above.</small>}{error&&<Notice>{error}</Notice>}</div>;
}
