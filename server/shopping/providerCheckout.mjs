import {z} from 'zod';
import {createHash} from 'node:crypto';
import {DomainError} from '../domain/journeys.mjs';
import {approvedCheckoutUrl} from './booking.mjs';
const fail=message=>{throw new DomainError(message,409,'CHECKOUT_UNAVAILABLE');};
export function checkoutCapability(provider) {
 return !!(provider?.authorized===true&&provider.name&&provider.documentationVersion&&provider.approvedHosts?.length&&typeof provider.createCheckout==='function'&&(!provider.live||provider.liveApproved===true));
}
const selectionHash=d=>createHash('sha256').update(JSON.stringify({version:d.version,constraints:d.constraints,selected:d.selected})).digest('hex');
function selected(store,userId,conversationId,version) {
 const c=store.get(userId,conversationId,'conversation'),d=store.get(userId,c.draftId,'trip-draft');
 if(d.version!==version)fail('The itinerary changed. Refresh before preparing checkout.');
 const candidate=d.selected?.flight;if(!candidate)fail('Select an available supplier offer first.');
 if(Date.parse(candidate.expiresAt)<=Date.now())fail('The selected offer expired. Search again.');
 const set=store.get(userId,d.selected.setId,'candidate-set');
 if(set.conversationId!==conversationId)fail('This selection belongs to a different conversation.');
 const search=store.get(userId,set.searchId,'shopping-search');
 if(search.state==='cancelled')fail('This search was cancelled.');
 return {c,d,candidate,request:search.request};
}
const requestSchema=z.object({conversationId:z.string().min(1),draftVersion:z.number().int().positive()}).strict();
const responseSchema=z.object({url:z.string().url(),expiresAt:z.string().datetime({offset:true}),offerIds:z.array(z.string()).min(1),requiresFinalReview:z.literal(true),live:z.boolean()}).strict();
export async function prepareProviderCheckout(store,userId,body,provider) {
 const parsed=requestSchema.safeParse(body);if(!parsed.success)throw new DomainError('Provide only the conversation and current draft version.',400);
 const input=parsed.data,source=selected(store,userId,input.conversationId,input.draftVersion);
 if(!checkoutCapability(provider))throw new DomainError('Approved provider checkout access is not configured.',503,'CHECKOUT_UNAVAILABLE');
 if(source.candidate.live!==provider.live)fail('Checkout and selected inventory environments do not match.');
 const quote=responseSchema.parse(await provider.createCheckout({offerIds:source.candidate.offerIds,services:source.candidate.services,passengers:source.request.passengers,currency:source.request.currency}));
 if(quote.live!==provider.live||JSON.stringify([...quote.offerIds].sort())!==JSON.stringify([...source.candidate.offerIds].sort()))fail('The provider checkout does not match the selected offers.');
 const url=approvedCheckoutUrl(quote.url,provider.approvedHosts);
 const fresh=selected(store,userId,input.conversationId,input.draftVersion);
 if(selectionHash(fresh.d)!==selectionHash(source.d))fail('The itinerary changed while preparing checkout.');
 const expiresAt=Math.min(Date.parse(quote.expiresAt),Date.parse(source.candidate.expiresAt),Date.now()+15*60000);
 if(expiresAt<=Date.now())fail('The checkout link has expired.');
 const record=store.put(userId,'provider-checkout',{schemaVersion:1,conversationId:source.c.id,draftId:source.d.id,draftVersion:source.d.version,selectionHash:selectionHash(source.d),provider:provider.name,live:provider.live,url,expiresAt,offerIds:quote.offerIds,state:'checkout-prepared',bookingConfirmed:false,inventoryHeld:false,requiresFinalReview:true},{expiresAt});
 return {id:record.id,provider:record.provider,live:record.live,expiresAt,href:'/api/shopping/checkouts/'+record.id+'/open',bookingConfirmed:false,notice:'Review the final itinerary, traveler details, full price and terms on the provider site before purchasing. Opening checkout or returning to Wayline does not confirm a booking.'};
}
export function providerCheckoutDestination(store,userId,id,provider) {
 const record=store.get(userId,id,'provider-checkout');
 if(!checkoutCapability(provider)||record.provider!==provider.name||record.live!==provider.live)fail('The provider checkout is no longer authorized.');
 const {d}=selected(store,userId,record.conversationId,record.draftVersion);
 if(selectionHash(d)!==record.selectionHash||record.expiresAt<=Date.now())fail('The checkout review changed or expired. Prepare it again.');
 return approvedCheckoutUrl(record.url,provider.approvedHosts);
}
export async function providerCheckoutRoutes(ctx) {
 const {url,req,b,store,session,travel,send,res,rateLimit}=ctx;
 if(url.pathname==='/api/shopping/checkouts'&&req.method==='POST'){rateLimit('checkout:'+session.userId,10);send(res,201,await prepareProviderCheckout(store,session.userId,b,travel.checkoutProvider));return true;}
 const match=url.pathname.match(/^\/api\/shopping\/checkouts\/([a-zA-Z0-9-]+)\/open$/);
 if(match&&req.method==='GET'){const destination=providerCheckoutDestination(store,session.userId,match[1],travel.checkoutProvider);res.writeHead(303,{Location:destination,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return true;}
 return false;
}
