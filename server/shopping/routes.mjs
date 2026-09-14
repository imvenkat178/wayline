import {supplierMonitorRoutes} from './supplierMonitoring.mjs';
import {providerCheckoutRoutes} from './providerCheckout.mjs';
import {supplierRecoveryRoutes} from './recoveryRoutes.mjs';
import {comparisonDocumentRoutes} from './comparisonDocuments.mjs';
import { airportSuggestions } from './airports.mjs';
import { bookingRoutes } from './bookingRoutes.mjs';
import { createPriceWatch, cancelPriceWatch } from "./watches.mjs";
import { createShoppingSearch, cancelShoppingSearch, reviewOffer, confirmComparison, shoppingCapabilities, shoppingSearchView } from "./service.mjs";
import { DomainError } from "../domain/journeys.mjs";
export async function shoppingRoutes(ctx) {
  const {url,req,b,session,store,send,res,rateLimit,travel}=ctx, userId=session.userId;
  if(await supplierMonitorRoutes(ctx))return true;
  if(await providerCheckoutRoutes(ctx))return true;
  if(await supplierRecoveryRoutes(ctx))return true;
  if(await bookingRoutes(ctx))return true;
  if(await comparisonDocumentRoutes(ctx))return true;
  const path=url.pathname;
  if(!path.startsWith("/api/shopping"))return false;
  if(path==='/api/shopping/airports'&&req.method==='GET'){rateLimit('airports:'+userId,30);send(res,200,await airportSuggestions(store,userId,url.searchParams.get('q')));}
  else if(path==="/api/shopping/capabilities"&&req.method==="GET")send(res,200,shoppingCapabilities({...travel,bookingAdapter:ctx.bookingAdapter}));
  else if(path==="/api/shopping/watches"&&req.method==="GET")send(res,200,store.list(userId,"price-watch"));
  else if(path==="/api/shopping/watches"&&req.method==="POST")send(res,201,createPriceWatch(store,userId,b,{capabilities:travel.flightShoppingCapabilities}));
  else if(/^\/api\/shopping\/watches\/[a-zA-Z0-9-]+\/cancel$/.test(path)&&req.method==="POST")send(res,200,cancelPriceWatch(store,userId,path.split("/")[4],b.version));
  else if(path==="/api/shopping/searches"&&req.method==="POST") {
    rateLimit("shopping:"+userId,6,60000);
    send(res,202,createShoppingSearch(store,userId,b.request,{key:b.key,capabilities:travel.flightShoppingCapabilities}));
  } else if(path==="/api/shopping/saved"&&req.method==="GET")send(res,200,store.list(userId,"travel-comparison"));
  else if(path==="/api/shopping/operations"&&req.method==="POST")
    throw new DomainError("Supplier booking, exchange, refunds and payment are not enabled. Saving a comparison does not issue a ticket.",501,"SUPPLIER_OPERATION_DISABLED");
  else {
    const match=path.match(/^\/api\/shopping\/(searches|reviews)\/([a-zA-Z0-9-]+)(?:\/(cancel|review|confirm))?$/);
    if(!match)throw new DomainError("Shopping route not found.",404);
    const [,type,id,action]=match;
    if(type==="searches"&&req.method==="GET"&&!action)send(res,200,shoppingSearchView(store,userId,id));
    else if(type==="searches"&&action==="cancel"&&req.method==="POST")send(res,200,cancelShoppingSearch(store,userId,id,b.version));
    else if(type==="searches"&&action==="review"&&req.method==="POST") {
      rateLimit("shopping-review:"+userId,10,60000);
      send(res,201,await reviewOffer(store,userId,id,b.offerId,travel));
    } else if(type==="reviews"&&action==="confirm"&&req.method==="POST")
      send(res,200,await confirmComparison(store,userId,id,travel));
    else throw new DomainError("Shopping action not found.",404);
  }
  return true;
}
