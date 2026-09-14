import {DomainError} from './journeys.mjs';
function askDate(message,field,input){const e=new DomainError(message);e.clarification={kind:'flight-date',field,pendingInput:input};throw e;}
const calendarDate=value=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw new DomainError('Use a valid calendar date in YYYY-MM-DD format.');
 return value;
};
export function flightScopeLanguage(input,draft,{parseDeparture,now=Date.now(),resolveAirport}={}) {
 let text=input;const patch={},zone=draft.constraints.timezone;
 const scope=/\b(?:round[ -]?trip|return(?:ing)?|one[ -]?way|multi[ -]?city|flexible dates?|nearby airports?|also (?:depart|arrive|check))\b/i.test(input);
 if(!scope)return {text,patch};
 const returnMatch=text.match(/\b(?:return(?:ing)?|come back)(?: flight)?(?: on)?\s+(\d{4}-\d{2}-\d{2})(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i);
 if(returnMatch&&/\b(?:one[ -]?way|multi[ -]?city)\b/i.test(text))throw new DomainError('Choose either one-way, return or multi-city travel.');
 if(returnMatch){if(/\bat\s/i.test(returnMatch[0]))throw new DomainError('The return-date search covers the full day. Use Trip requirements to review the return scope before searching.');patch.returnDate=calendarDate(returnMatch[1]);patch.additionalFlights=[];text=text.replace(returnMatch[0],'');}
 else if((/\breturn(?:ing)?\b/i.test(text)&&!/\breturn to\b/i.test(text))||(/\bround[ -]?trip\b/i.test(text)&&!draft.constraints.returnDate))askDate('What is the return date? Use YYYY-MM-DD so the flight search covers the intended day.','returnDate',input);
 if(/\bone[ -]?way\b/i.test(text)){patch.returnDate=null;patch.additionalFlights=[];text=text.replace(/\bone[ -]?way\b/gi,'');}
 const flexible=text.match(/\b(?:flexible dates?|also check)(?:\s*[:=]|\s+(?:on|are|include))?\s*((?:\d{4}-\d{2}-\d{2})(?:(?:\s*,\s*|\s+and\s+|\s+or\s+)\d{4}-\d{2}-\d{2})*)/i);
 if(flexible){patch.flexibleDates=[...new Set(flexible[1].match(/\d{4}-\d{2}-\d{2}/g).map(calendarDate))];if(patch.flexibleDates.length>3)throw new DomainError('Choose up to three additional departure dates.');text=text.replace(flexible[0],'');}
 else if(/\bflexible dates?\b/i.test(text))askDate('Which additional departure dates should I search? Give up to three dates in YYYY-MM-DD format.','flexibleDates',input);
 for(const [direction,key] of [['depart','originAirports'],['arrive','destinationAirports']]){
  const pattern=new RegExp('\\balso '+direction+' (?:from|at|in)\\s+([A-Z]{3}(?:(?:\\s*,\\s*|\\s+or\\s+|\\s+and\\s+)[A-Z]{3})*)','i'),match=text.match(pattern);
  if(match){patch[key]=[...new Set(match[1].toUpperCase().split(/\s*(?:,|\band\b|\bor\b)\s*/i))];if(patch[key].length>2)throw new DomainError('Choose up to two additional airports at each end.');text=text.replace(match[0],'');}
 }
 if(/\bnearby airports?\b/i.test(text))throw new DomainError('Choose exact alternate airports, for example “also depart from PVD” or “also arrive at LGA”. Availability depends on approved inventory.');
 if(/\bmulti[ -]?city\b/i.test(text)){
  const body=text.replace(/^.*?\bmulti[ -]?city\s*:?\s*/i,''),clauses=body.split(/\s*;\s*|\s+then\s+/i).filter(Boolean);
  if(clauses.length<2||clauses.length>6)throw new DomainError('List two to six multi-city flights separated by semicolons, with an airport pair, date and time for each.');
  const slices=clauses.map(clause=>{const m=clause.match(/^(?:from\s+)?([A-Z]{3})\s+(?:to|->)\s+([A-Z]{3})\s+(?:on\s+)?(\d{4}-\d{2}-\d{2})\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[.!?]?$/i);if(!m)throw new DomainError('Use one exact airport pair, date and time per flight, for example BOS to JFK on 2026-10-20 at 9 am.');calendarDate(m[3]);const from=m[1].toUpperCase(),to=m[2].toUpperCase(),airport=resolveAirport(from);const when=parseDeparture(m[3]+' at '+m[4],{zone:airport?.timezone??zone,now});if(when.error)throw new DomainError(when.error);return {from,to,departure:when.departure};});
  Object.assign(patch,slices[0],{additionalFlights:slices.slice(1),returnDate:null});text='';
 }
 return {text,patch};
}
