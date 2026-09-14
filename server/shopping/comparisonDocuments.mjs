import {flightItinerary} from '../domain/workspaceFlights.mjs';
import {itineraryPdf} from '../itineraryPdf.mjs';
import {DomainError} from '../domain/journeys.mjs';
export function comparisonJourney(record) {
 const c=record.candidate,r=record.request;
 const j=flightItinerary(c,{travelers:r.passengers.length,bags:r.passengers.reduce((n,p)=>n+p.checked+p.cabin,0)});
 return {...j,id:record.id,version:record.version,state:'SAVED COMPARISON - NOT BOOKED',updatedAt:record.updatedAt,observedAt:record.offer?.source?.observedAt,bookingConfirmed:false,inventoryHeld:false,priceNotice:'Supplier offer snapshot. Availability and prices expire. This comparison is not a purchase, issued ticket or proof of payment.'};
}
const stamp=v=>new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
const safe=v=>String(v).replace(/\\/g,'\\\\').replace(/\r?\n|\r/g,'\\n').replace(/[,;]/g,'\\$&');
export function comparisonCalendar(j) {
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Wayline//Travel comparison//EN'];
 for(const [i,l] of j.legs.entries())lines.push('BEGIN:VEVENT','UID:'+j.id+'-'+i+'@wayline.local','DTSTAMP:'+stamp(j.updatedAt),'DTSTART:'+stamp(l.departure),'DTEND:'+stamp(l.arrival),'SUMMARY:'+safe((j.dataMode==='illustrative'?'TEST: ':'')+l.service+' '+l.from+' to '+l.to),'DESCRIPTION:Saved comparison only. Not booked. Verify times and obtain valid tickets.','END:VEVENT');
 return [...lines,'END:VCALENDAR',''].join('\r\n');
}
export async function comparisonDocumentRoutes({url,req,res,b,store,session,send,rateLimit}) {
 const match=url.pathname.match(/^\/api\/shopping\/saved\/([a-zA-Z0-9-]+)\/(itinerary|calendar|itinerary\.pdf|share)$/);
 if(!match)return false;
 const [,id,action]=match,record=store.get(session.userId,id,'travel-comparison');
 if(action==='share'&&req.method==='POST'){send(res,201,store.share(session.userId,id,b));return true;}
 if(req.method!=='GET')throw new DomainError('Method not allowed.',405);
 const j=comparisonJourney(record);
 if(action==='itinerary'){send(res,200,j);return true;}
 rateLimit('export:'+session.userId,20);
 const pdf=action==='itinerary.pdf',bytes=pdf?await itineraryPdf(j):Buffer.from(comparisonCalendar(j));
 res.writeHead(200,{'content-type':pdf?'application/pdf':'text/calendar; charset=utf-8','content-disposition':'attachment; filename="wayline-comparison.'+(pdf?'pdf':'ics')+'"','cache-control':'no-store','content-length':bytes.length});res.end(bytes);return true;
}
