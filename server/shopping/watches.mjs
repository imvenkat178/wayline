import { createHash } from "node:crypto";
import { DomainError } from "../domain/journeys.mjs";
import { moneySchema } from "./contracts.mjs";
import { duffelCapabilities } from "./duffel.mjs";
import { createShoppingSearch, cancelShoppingSearch } from "./service.mjs";
import { fanOutPush } from "../push.mjs";
import { isNotificationAllowed } from "../domain/notificationPolicy.mjs";
export function createPriceWatch(store,userId,input,{capabilities=duffelCapabilities(),now=Date.now()}={}) {
  if(input.consent!==true)throw new DomainError("Explicit consent is required for a price watch.");
  if(!capabilities.capabilities.backgroundShoppingAllowed||!capabilities.capabilities.priceHistoryAllowed)
    throw new DomainError("This supplier has not authorized background shopping and price history.",409,"WATCH_NOT_PERMITTED");
  const search=store.get(userId,input.searchId,"shopping-search"),parsed=moneySchema.safeParse(input.threshold);
  if(!parsed.success||parsed.data.currency!==search.request.currency)throw new DomainError("Choose a threshold in the search currency.");
  const expiresAt=Date.parse(input.expiresAt);
  if(!Number.isFinite(expiresAt)||expiresAt<=now||expiresAt>now+7*86400000||expiresAt>=Date.parse(search.request.departure))
    throw new DomainError("Choose a watch expiry within seven days and before departure.");
  if(store.list(userId,"price-watch").filter(w=>w.state==="active").length>=3)throw new DomainError("At most three active price watches are supported.",429);
  return store.put(userId,"price-watch",{request:search.request,threshold:parsed.data,state:"active",consentedAt:new Date(now).toISOString(),
    expiresAt,nextCheckAt:now,activeSearchId:null,lastNotifiedAmount:null},{expiresAt});
}
export function cancelPriceWatch(store,userId,id,version) {
  const watch=store.get(userId,id,"price-watch");
  if(watch.state==="cancelled")return watch;
  return store.transaction(()=>{
    const result=store.put(userId,"price-watch",{...watch,state:"cancelled"},{id,expectedVersion:version});
    if(watch.activeSearchId) {let search;try {search=store.get(userId,watch.activeSearchId,"shopping-search");}catch{/* Expired searches already cannot run. */}
      if(search&&["queued","partial"].includes(search.state))cancelShoppingSearch(store,userId,search.id,search.version);
    }
    return result;
  });
}
function* watchRows(store,now) {
  let cursor="";
  for(;;) {
    const rows=store.db.prepare("SELECT * FROM records WHERE kind='price-watch' AND expires_at>? AND id>? ORDER BY id LIMIT 200").all(now,cursor);
    for(const row of rows)yield row;
    if(rows.length<200)return;
    cursor=rows.at(-1).id;
  }
}
export function sweepPriceWatches(store,{capabilities=duffelCapabilities(),now=Date.now()}={}) {
  if(!capabilities.capabilities.backgroundShoppingAllowed||!capabilities.capabilities.priceHistoryAllowed)return;
  for(const row of watchRows(store,now)) {
    const userId=row.user_id,w=store.decode(row);
    if(w.state!=="active"||w.expiresAt<=now)continue;
    if(w.activeSearchId) {
      let search;try{search=store.get(userId,w.activeSearchId,"shopping-search");}catch{/* Expired search will be retried after the cadence. */}
      if(search&&["queued","partial"].includes(search.state))continue;
      store.transaction(()=>{
        const current=store.get(userId,w.id,"price-watch");
        if(current.state!=="active")return;
        const best=search?.state==="complete"?search.results.complete.find(c=>c.pricing.total.currency===w.threshold.currency):null;
        const fresh=best&&Date.parse(best.expiresAt)>now;
        const notify=fresh&&best.pricing.total.amount<=w.threshold.amount&&
          (w.lastNotifiedAmount===null||best.pricing.total.amount<w.lastNotifiedAmount);
        if(notify) {
          const key=createHash("sha256").update(w.id+":"+best.pricing.total.amount).digest("hex");
          const alert=store.put(userId,"alert",{kind:"price-watch",severity:"info",title:"A complete fare meets your price target",
            body:"Open flight comparison to refresh this offer before making plans. No seat is held.",at:new Date(now).toISOString(),
            read:false,delivery:"in-app",dataMode:"provider",dedupeKey:key},{dedupeHash:key,expiresAt:now+7*86400000});
          if(isNotificationAllowed(alert,store.user(userId).preferences))fanOutPush(store,userId,alert.id);
        }
        store.put(userId,"price-watch",{...current,activeSearchId:null,nextCheckAt:now+1800000,
          lastNotifiedAmount:notify?best.pricing.total.amount:w.lastNotifiedAmount},{id:w.id,expectedVersion:current.version});
      });
    } else if(w.nextCheckAt<=now) {
      try { store.transaction(()=>{
        const current=store.get(userId,w.id,"price-watch");
        if(current.state!=="active"||current.activeSearchId)return;
        const search=createShoppingSearch(store,userId,w.request,{background:true,capabilities,key:w.id+":"+w.nextCheckAt});
        store.put(userId,"price-watch",{...current,activeSearchId:search.id},{id:w.id,expectedVersion:current.version});
      }); } catch {
        const latest=store.get(userId,w.id,"price-watch");
        store.put(userId,"price-watch",{...latest,nextCheckAt:now+1800000,lastError:"Search capacity unavailable; retrying at the next check."},{id:w.id,expectedVersion:latest.version});
      }
    }
  }
}
