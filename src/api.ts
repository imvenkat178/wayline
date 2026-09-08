let csrf='';
export const setCsrf=(value:string)=>{csrf=value;};
export class ApiError extends Error {constructor(message:string,public status:number,public code:string){super(message);}}
export async function api<T>(path:string,method='GET',data?:unknown,headers:Record<string,string>={}):Promise<T>{
 let r:Response;try{r=await fetch(`/api${path}`,{method,credentials:'same-origin',headers:{...(method==='GET'?{}:{'content-type':'application/json','x-csrf-token':csrf}),...headers},body:method==='GET'?undefined:JSON.stringify(data??{}),signal:AbortSignal.timeout(25000)});}catch{throw new ApiError('Unable to connect. Check your connection or open an offline pack.',0,'OFFLINE');}
 const result=await r.json().catch(()=>({error:'Invalid server response.'}));if(!r.ok)throw new ApiError(result.error??'Request failed.',r.status,result.code);return result as T;
}
export function download(name:string,data:unknown,type='application/json'){const content=typeof data==='string'?data:JSON.stringify(data,null,2);const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function copyText(value:string){if(!navigator.clipboard)throw new Error('Clipboard is unavailable. Select and copy the text.');await navigator.clipboard.writeText(value);}
export const money=(c:number|null|undefined)=>c==null?'Fare unknown':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
export const duration=(m:number)=>`${Math.floor(m/60)?Math.floor(m/60)+'h ':''}${m%60}m`;
export const time=(iso:string,zone?:string)=>new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(iso));
export const dateLabel=(iso:string,zone?:string)=>new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',weekday:'short'}).format(new Date(iso));
export function localInput(date=new Date()){const offset=date.getTimezoneOffset();return new Date(date.getTime()-offset*60000).toISOString().slice(0,16);}
export const readable=(s:string)=>s.toLowerCase().replace(/[-_]/g,' ').replace(/^./,x=>x.toUpperCase());
