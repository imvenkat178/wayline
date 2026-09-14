import {prepareSupplierRecovery,supplierRecoveryView,createRecoveryDraft} from './supplierRecovery.mjs';
export async function supplierRecoveryRoutes(ctx) {
 const {url,req,store,session,b,send,res,rateLimit,travel}=ctx,path=url.pathname,userId=session.userId;
 const order=path.match(/^\/api\/shopping\/orders\/([a-zA-Z0-9-]+)\/recovery$/);
 if(order&&req.method==='POST'){rateLimit('recovery:'+userId,6);send(res,201,await prepareSupplierRecovery(store,userId,order[1],b,travel));return true;}
 const match=path.match(/^\/api\/shopping\/recoveries\/([a-zA-Z0-9-]+)(?:\/(draft))?$/);
 if(!match)return false;
 if(match[2]==='draft'&&req.method==='POST'){send(res,201,await createRecoveryDraft(store,userId,match[1],b.candidateId));return true;}
 if(!match[2]&&req.method==='GET'){send(res,200,supplierRecoveryView(store,userId,match[1]));return true;}
 return false;
}
