import {readFileSync} from "node:fs";
import {moneyFromDecimal} from "./contracts.mjs";
import {localDate} from "./duffel.mjs";
export const tariff=JSON.parse(readFileSync(new URL("./mbta-tariff.json",import.meta.url),"utf8").replace(/^\uFEFF/,""));
export function applyBostonTariff(journey,input,now=Date.now()) {
  const legs=journey.legs.filter(l=>l.mode!=="walk");
  const date=localDate(journey.departure,"America/New_York").replaceAll("-","");
  // Deliberately narrow: a single regular rapid-transit ride, standard adult fares.
  // Airport/Silver Line, inter-network transfers, commuter rail and discount eligibility need separate rules.
  const regular=Date.parse(journey.departure)<=Date.parse("2026-12-13T04:59:59Z")&&
    date>=tariff.calendar.start_date&&date<=tariff.calendar.end_date&&
    localDate(new Date(now).toISOString(),"America/New_York").replaceAll("-","")<=tariff.calendar.end_date&&
    !tariff.exceptions.some(e=>e.date===date&&e.exception_type==="2");
  const supported=regular && legs.length===1 && /^(Red|Blue|Orange|Green-[BCDE])$/.test(legs[0].routeId??"") &&
    tariff.routes.includes(legs[0].routeId) && legs[0].agency==="mbta";
  if(!supported)return journey;
  const each=moneyFromDecimal(tariff.product.amount,tariff.product.currency).amount;
  const cents=each*(input.travelers??1);
  return {...journey,price:{totalCents:cents,currency:"USD",unknown:false,kind:"tariff",
    items:[{label:"Standard adult subway fare × "+(input.travelers??1),cents}],
    source:tariff.source,observedAt:tariff.observedAt,version:tariff.feed.feed_version,
    conditions:"Standard adult fare with contactless payment or CharlieCard; discounts and existing passes are not applied."}};
}
