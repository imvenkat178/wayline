import { z } from 'zod';
import { fetchBounded } from '../adapters/providers.mjs';
import { duffelCapabilities } from './duffel.mjs';
import { DomainError } from '../domain/journeys.mjs';
const rawAirport=z.object({id:z.string(),iata_code:z.string().regex(/^[A-Z]{3}$/),iata_country_code:z.literal('US'),name:z.string(),latitude:z.coerce.number().min(-90).max(90),longitude:z.coerce.number().min(-180).max(180),time_zone:z.string().min(1)});
export async function airportSuggestions(store,userId,query,{env=process.env,transport=fetchBounded}={}) {
  if(typeof query!=='string'||query.trim().length<2||query.length>100)throw new DomainError('Enter an airport code or city of 2–100 characters.');
  const q=query.trim();
  if(!duffelCapabilities(env).configured)throw new DomainError('Nationwide airport lookup needs approved supplier access. Exact previously available airport choices remain usable.',503,'AIRPORT_LOOKUP_UNAVAILABLE');
  const bytes=await transport('https://api.duffel.com/places/suggestions?query='+encodeURIComponent(q),{timeoutMs:15000,headers:{'Duffel-Version':'v2',Authorization:'Bearer '+env.DUFFEL_ACCESS_TOKEN}},2000000);
  const data=JSON.parse(bytes.toString()).data;if(!Array.isArray(data))throw new DomainError('Invalid airport directory response.',502);
  const airports=[...new Map(data.flatMap(p=>p.type==='city'?p.airports??[]:p.type==='airport'?[p]:[]).flatMap(p=>{const parsed=rawAirport.safeParse(p);if(!parsed.success)return [];const a=parsed.data;try{new Intl.DateTimeFormat('en-US',{timeZone:a.time_zone});}catch{return [];}
    return [{id:a.id,name:a.name,kind:'airport',iata:a.iata_code,country:'US',lat:a.latitude,lon:a.longitude,timezone:a.time_zone}];}).map(a=>[a.iata,a])).values()];
  for(const airport of airports) {
    const old=store.list(userId,'airport-reference').find(r=>r.airport.id===airport.id);
    store.put(userId,'airport-reference',{airport,source:'Duffel airport directory',sourceUrl:'https://duffel.com/docs/api/places',observedAt:new Date().toISOString()},old?{id:old.id,expectedVersion:old.version,expiresAt:Date.now()+7*86400000}:{expiresAt:Date.now()+7*86400000});
  }
  return {airports,source:'Duffel airport directory',observedAt:new Date().toISOString(),requiresSelection:airports.length!==1};
}
export function validateAirportReferences(store,userId,airports) {
  const known=store.list(userId,'airport-reference');
  for(const airport of airports)if(!known.some(r=>Object.entries(airport).every(([key,value])=>r.airport[key]===value)))throw new DomainError('Choose a current airport from the supplier directory.',409,'AIRPORT_REQUIRED');
}
