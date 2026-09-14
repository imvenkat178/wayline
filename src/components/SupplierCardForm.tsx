import {useState} from 'react';
import {DuffelCardForm,useDuffelCardFormActions} from '@duffel/components';
import {Button} from './ui';
export default function SupplierCardForm({clientKey,busy,onPrepared,onError}:{clientKey:string;busy:boolean;onPrepared:(id:string)=>void;onError:(message:string)=>void}) {
 const [valid,setValid]=useState(false);
 const {ref,createCardForTemporaryUse}=useDuffelCardFormActions();
 return <><DuffelCardForm ref={ref} clientKey={clientKey} intent="to-create-card-for-temporary-use" onValidateSuccess={()=>setValid(true)} onValidateFailure={()=>setValid(false)} onCreateCardForTemporaryUseSuccess={card=>onPrepared(card.id)} onCreateCardForTemporaryUseFailure={error=>onError(error.message)}/><Button disabled={!valid||busy} onClick={createCardForTemporaryUse}>Prepare card for this payment</Button></>;
}
