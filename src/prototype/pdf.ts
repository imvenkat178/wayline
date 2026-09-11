import { stations, dateLabel, durationLabel, timeAt, alternatives, type Trip } from './model';

// A small vector PDF writer keeps this isolated prototype independent of the booking app.
// All text is ASCII; built-in PDF fonts are embedded by the viewer without remote requests.
export function itineraryPdf(trip: Trip): Uint8Array {
  const esc = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/([\\()])/g, '\\$1');
  const pages: string[] = [];
  let ops: string[] = [];
  const ink = '0.09 0.17 0.14', muted = '0.40 0.46 0.41';
  function text(x: number, y: number, size: number, value: string, font = 'F1', color = ink) { ops.push(`BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${x} ${842-y} Tm (${esc(value)}) Tj ET`); }
  function rect(x: number,y: number,w: number,h: number,color: string) { ops.push(`${color} rg ${x} ${842-y-h} ${w} ${h} re f`); }
  function line(y: number) { ops.push(`0.84 0.88 0.83 RG 0.6 w 42 ${842-y} m 553 ${842-y} l S`); }
  function footer(page: number) { line(790); text(42,810,9,'WAYLINE / SAMPLE TRAVEL ITINERARY', 'F2',muted); text(488,810,9,`${page} / 2`,'F1',muted); }
  function header(label: string) { text(42,54,24,'wayline.', 'F2'); text(350,49,9,'TRAVEL, CONSIDERED.', 'F2',muted); text(350,66,9,label,'F1',muted); line(87); }
  const from = stations[trip.from], to = stations[trip.to];
  header('REFERENCE ' + trip.id);
  text(42,123,10,'TRAVEL DOCUMENT / DESIGN SAMPLE','F2',muted);
  text(42,161,29,'Your journey, in detail.','F3');
  rect(42,187,511,28,'0.96 0.94 0.88');
  text(54,205,10,'SAMPLE - NOT VALID FOR TRAVEL - NO BOOKING HAS BEEN MADE','F2','0.45 0.35 0.19');
  rect(42,235,511,161,'0.09 0.17 0.14');
  text(62,260,10,from.city,'F1','0.73 0.81 0.70'); text(343,260,10,to.city,'F1','0.73 0.81 0.70');
  text(62,299,34,trip.from,'F2','1 1 1'); text(343,299,34,trip.to,'F2','1 1 1');
  text(243,294,15,'>', 'F2','0.73 0.81 0.70');
  text(62,331,24,trip.departure,'F1','1 1 1'); text(343,331,24,timeAt(trip.departure,trip.duration),'F1','1 1 1');
  text(62,356,10,from.name,'F1','0.80 0.86 0.78'); text(343,356,10,to.name,'F1','0.80 0.86 0.78');
  text(62,381,10,`${dateLabel(trip.date,true)} | All times Eastern | ${durationLabel(trip.duration)}`,'F1','0.80 0.86 0.78');
  const fields = [ ['PASSENGER',`${trip.passengers} sample traveler${trip.passengers > 1 ? 's' : ''}`],['SERVICE',trip.service],['DOCUMENT STATUS',trip.status === 'cancelled' ? 'Cancelled sample itinerary' : 'Planned sample itinerary'],['SEAT / PLATFORM','Not assigned - confirm with operator'],['ILLUSTRATIVE FARE',`USD ${(trip.price * trip.passengers).toFixed(2)} total`],['BAGGAGE','Check operator allowance before travel'] ];
  fields.forEach(([label,value],i) => {const x = i%2 === 0 ? 42 : 313; const y = 433+Math.floor(i/2)*57; text(x,y,9,label,'F2',muted); text(x,y+21,11,value);});
  line(588);
  text(42,618,19,'Before you go','F3');
  const notes = ['Arrive at the origin station 30 minutes before the planned departure.', 'Keep your actual operator-issued ticket and identification with you.', 'Platform, seat, baggage and accessibility details require operator confirmation.', 'This document is a personal itinerary, not an operator-issued ticket.'];
  notes.forEach((note,i) => text(42,646+i*24,10,note,'F1',muted));
  footer(1); pages.push(ops.join('\n')); ops=[];
  header('COMPLETE ITINERARY');
  text(42,130,29,'From departure to arrival.','F3');
  text(42,155,11,`${dateLabel(trip.date,true)} | ${from.city} to ${to.city}`,'F1',muted);
  const pre = timeAt(trip.departure, Math.max(0, 24*60-30));
  const steps = [[pre,'Arrive at the station',from.name,'Allow time for finding the platform and any assistance.'],[timeAt(trip.departure,24*60-10),'Prepare to board','Check the departure display','Use your actual operator-issued ticket for boarding.'],[trip.departure,'Depart '+from.city,trip.service,`Planned duration: ${durationLabel(trip.duration)}. Sample schedule only.`],[timeAt(trip.departure,trip.duration),'Arrive in '+to.city,to.name,'Check onward transport and station exit directions.']];
  steps.forEach(([time,title,place,note],i) => { const y=194+i*86; rect(42,y,53,29,'0.92 0.95 0.90'); text(51,y+19,12,time,'F2');text(114,y+15,13,title,'F2');text(114,y+36,11,place);text(114,y+55,10,note,'F1',muted); });
  line(543); text(42,575,19,'A plan for the unexpected','F3');
  if (trip.alternative === null) alternatives(trip).forEach((a,i) => {const y=606+i*39; text(42,y,11,`${i+1}. ${a.name}`,'F2');text(226,y,10,`${timeAt(trip.departure,a.delay)} | ${durationLabel(a.duration)} | USD ${a.price} / traveler`);text(42,y+16,9,a.note+' - illustrative availability','F1',muted);});
  else { text(42,610,12,`Selected backup: ${trip.service}`,'F2'); text(42,637,10,'The revised departure and arrival are reflected throughout this itinerary.'); text(42,660,10,'Restore the previous snapshot in Journey protection to compare the original.'); }
  text(42,750,9,'Prototype recovery is simulated. No real service monitoring or rebooking is connected.','F1',muted);
  footer(2); pages.push(ops.join('\n'));
  const objects = ['', '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [6 0 R 8 0 R] /Count 2 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>'];
  pages.forEach((stream, i) => { const contentId = 7+i*2; objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`); objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`); });
  let result='%PDF-1.4\n'; const offsets=[0];
  objects.slice(1).forEach((obj,i) => { offsets.push(result.length); result+=`${i+1} 0 obj\n${obj}\nendobj\n`; });
  const xref=result.length; result+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`; offsets.slice(1).forEach(offset => result+=`${String(offset).padStart(10,'0')} 00000 n \n`);
  result+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(result);
}
export function downloadItinerary(trip: Trip) { const data = itineraryPdf(trip); const blob = new Blob([data as BlobPart], {type:'application/pdf'}); const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`Wayline-${trip.id}-itinerary.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000); }
