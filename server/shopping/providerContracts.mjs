import { z } from 'zod';
import { DomainError } from '../domain/journeys.mjs';
import { offerSchema } from './contracts.mjs';
export const flightObservationSchema=z.object({provider:z.literal('flightaware-aeroapi'),serviceIdentity:z.string().min(1),flightId:z.string().min(1),operatingCarrierCode:z.string().optional(),serviceNumber:z.string().optional(),origin:z.string().regex(/^[A-Z]{3}$/),destination:z.string().regex(/^[A-Z]{3}$/),scheduledDeparture:z.string().datetime({offset:true}),scheduledArrival:z.string().datetime({offset:true}),observedAt:z.string().datetime({offset:true}),status:z.enum(['scheduled','on-time','delayed','cancelled','departed','arrived']),actualDeparture:z.string().datetime({offset:true}).nullable(),actualArrival:z.string().datetime({offset:true}).nullable(),gate:z.string().max(30).nullable(),sourceUrl:z.string().url()}).strict();
export class LicensedFlightStatusProvider {
 constructor({fetchStatus,license}={}){this.fetchStatus=fetchStatus;this.license=license;}
 async status(service){if(!this.fetchStatus||this.license?.statusAllowed!==true)throw new DomainError('FlightAware status requires an approved account, licensed use and a configured transport.',503,'FLIGHT_STATUS_UNAVAILABLE');return flightObservationSchema.parse(await this.fetchStatus(service));}
}
export class DistribusionProvider {
 constructor({transport,contract}={}){this.transport=transport;this.contract=contract;}
 async search(request){if(!this.transport||!this.contract?.usInventoryGranted||!this.contract?.documentationVersion)throw new DomainError('Distribusion partner documentation and contracted US inventory are required.',503,'GROUND_PROVIDER_UNAVAILABLE');const offers=await this.transport.search(request);return z.array(offerSchema).parse(offers);}
 async operation(kind,input){if(!this.transport||this.contract?.operations?.[kind]!==true)throw new DomainError('This ground-ticket operation is not authorized.',501,'SUPPLIER_OPERATION_DISABLED');return this.transport.operation(kind,input);}
}
export function storeFlightObservation(store,userId,serviceIdentity,value,{license,now=Date.now()}={}) {
 if(license?.statusAllowed!==true)throw new DomainError('Flight observation storage is not licensed.',409);
 const observation=flightObservationSchema.parse(value);
 if(observation.serviceIdentity!==serviceIdentity)throw new DomainError('Flight observation does not match the selected service.',409);
 if(Date.parse(observation.observedAt)>now+60000||now-Date.parse(observation.observedAt)>86400000)throw new DomainError('Flight observation is stale or future dated.',409);
 for(const field of ['actualDeparture','actualArrival'])if(observation[field]&&Date.parse(observation[field])>Date.parse(observation.observedAt))throw new DomainError('Actual event cannot follow observation.',409);
 if(observation.status==='arrived'&&!observation.actualArrival)throw new DomainError('Arrival needs authoritative actual time.',409);
 const source=new URL(observation.sourceUrl);if(source.protocol!=='https:'||!['flightaware.com','www.flightaware.com','aeroapi.flightaware.com'].includes(source.hostname))throw new DomainError('Flight observation source is not approved.',409);
 const ttl=Math.min(30,Number(license.rawRetentionDays))*86400000;if(!Number.isFinite(ttl)||ttl<=0)throw new DomainError('Flight observation retention is not permitted.',409);
 const prior=store.list(userId,'flight-observation').find(o=>o.observation.flightId===observation.flightId);
 if(prior&&Date.parse(prior.observation.observedAt)>=Date.parse(observation.observedAt))return prior;
 return store.put(userId,'flight-observation',{schemaVersion:1,observation,licenseId:license.id,restrictions:'No passenger-rights claims use; raw observations retained within the configured licensed period.'},prior?{id:prior.id,expectedVersion:prior.version,expiresAt:now+ttl}:{expiresAt:now+ttl});
}
export function historicalReliability(observations,{origin,destination,operatingCarrierCode,serviceNumber,departureHour,timeZone,minimumSamples=10}={}) {
 if(!operatingCarrierCode||!serviceNumber)return {available:false,sampleCount:0,limitation:'Operating carrier and flight number are required for a comparable cohort.'};
 const comparable=observations.filter(o=>o.operatingCarrierCode===operatingCarrierCode&&o.serviceNumber===serviceNumber&&o.provider==='flightaware-aeroapi'&&o.origin===origin&&o.destination===destination&&['arrived','cancelled'].includes(o.status)&&Number(new Intl.DateTimeFormat('en-US',{timeZone,hour:'2-digit',hourCycle:'h23'}).format(new Date(o.scheduledDeparture)))===departureHour);
 const unique=[...new Map(comparable.map(o=>[o.flightId,o])).values()];
 if(unique.length<minimumSamples)return {available:false,sampleCount:unique.length,limitation:'Insufficient comparable licensed observations. Connection resilience is separate.'};
 const onTime=unique.filter(o=>o.status==='arrived'&&o.actualArrival&&Date.parse(o.actualArrival)-Date.parse(o.scheduledArrival)<=15*60000).length;
 return {available:true,sampleCount:unique.length,onTimeCount:onTime,onTimePercent:Math.round(onTime/unique.length*100),periodStart:new Date(Math.min(...unique.map(o=>Date.parse(o.scheduledDeparture)))).toISOString(),periodEnd:new Date(Math.max(...unique.map(o=>Date.parse(o.scheduledDeparture)))).toISOString(),definition:'Arrival no more than 15 minutes late; cancellations remain in the denominator.',limitation:'Observed same operating flight, route and departure-hour sample; not a guarantee or connection resilience score.'};
}
