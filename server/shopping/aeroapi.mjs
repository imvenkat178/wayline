import {z} from 'zod';
import {fetchBounded} from '../adapters/providers.mjs';
import {DomainError} from '../domain/journeys.mjs';
import {serviceIdentity} from './connections.mjs';
import {flightObservationSchema} from './providerContracts.mjs';
// FlightAware v4: official /flights/{ident} contract. No alternate live-flight
// source is combined with these observations; no rights/claims use is permitted.
export class AeroApiProvider {
 constructor({env=process.env,transport=fetchBounded,now=()=>Date.now()}={}){this.env=env;this.transport=transport;this.now=now;const days=Number(env.FLIGHTAWARE_RETENTION_DAYS),retentionConfigured=Number.isFinite(days)&&days>0&&days<=30;this.license={id:env.FLIGHTAWARE_LICENSE_ID,statusAllowed:!!env.FLIGHTAWARE_API_KEY&&env.FLIGHTAWARE_STANDARD_APPROVED==='true'&&!!env.FLIGHTAWARE_LICENSE_ID&&env.ENABLE_EXTERNAL_FEEDS!=='false'&&retentionConfigured,rawRetentionDays:retentionConfigured?days:0};}
 async status(service){
  if(!this.license.statusAllowed)throw new DomainError('FlightAware status requires approved Standard access and licensed retention settings.',503,'FLIGHT_STATUS_UNAVAILABLE');
  if(!service.operatingCarrierCode||!service.serviceNumber)throw new DomainError('The supplier has not provided the operating carrier code and flight number.',409,'FLIGHT_IDENTITY_REQUIRED');
  const ident=z.string().regex(/^[A-Z0-9]{2,3}\d{1,5}[A-Z]?$/).parse(service.operatingCarrierCode+service.serviceNumber);
  const url='https://aeroapi.flightaware.com/aeroapi/flights/'+encodeURIComponent(ident);
  const bytes=await this.transport(url,{headers:{'x-apikey':this.env.FLIGHTAWARE_API_KEY},timeoutMs:15000},2000000),data=JSON.parse(bytes.toString());
  const matches=(data.flights??[]).filter(f=>f.ident_iata===ident&&f.origin?.code_iata===service.origin.iata&&f.destination?.code_iata===service.destination.iata&&Date.parse(f.scheduled_out)===Date.parse(service.departure));
  if(matches.length!==1)throw new DomainError('No unique FlightAware observation matches this exact service and scheduled departure.',409,'FLIGHT_OBSERVATION_UNAVAILABLE');
  const f=matches[0];
  return flightObservationSchema.parse({provider:'flightaware-aeroapi',serviceIdentity:serviceIdentity(service),flightId:f.fa_flight_id,operatingCarrierCode:service.operatingCarrierCode,serviceNumber:service.serviceNumber,origin:service.origin.iata,destination:service.destination.iata,scheduledDeparture:f.scheduled_out,scheduledArrival:f.scheduled_in,actualDeparture:f.actual_out??null,actualArrival:f.actual_in??null,observedAt:new Date(this.now()).toISOString(),status:f.cancelled?'cancelled':f.actual_in?'arrived':f.actual_out?'departed':f.departure_delay>0||f.arrival_delay>0?'delayed':'scheduled',gate:f.gate_origin??null,sourceUrl:'https://www.flightaware.com/live/flight/'+encodeURIComponent(ident)});
 }
}
