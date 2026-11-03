import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTrainerPersonalDetails} from '../src/trainer-personal-data.mjs';
import {handleTrainerPersonalData,handleTrainerManagement} from '../supabase/functions/_shared/trainer-management.mjs';
import {createTrainerContractDraft,contractSourceChanged} from '../src/trainer-contracts.mjs';
const personId='10000000-0000-4000-8000-000000000001';
test('private contacts normalize formatted IBANs and reject invalid financial or identity data',()=>{
 const v=validateTrainerPersonalDetails({email:' TEST@Example.test ',birthDate:'1990-01-02',bank:{holder:'Example',iban:'DE89-3704-0044-0532-0130-00',bic:'cobadeffxxx'}});
 assert.equal(v.email,'test@example.test');assert.equal(v.bank.iban,'DE89370400440532013000');assert.equal(v.bank.bic,'COBADEFFXXX');
 for(const value of [{email:'broken'},{mobile:'not a phone'},{birthDate:'2026-02-30'},{birthDate:'2999-01-01'},{street:'Line\nTwo'},{bank:{iban:'DE00370400440532013000'}},{bank:{bic:'12345678'}}])assert.throws(()=>validateTrainerPersonalDetails(value));
 assert.equal(validateTrainerPersonalDetails({bank:{holder:'Guardian',name:'Example bank',iban:''}}).bank.holder,'Guardian');
});
test('ordinary trainer edits omit absent private controls rather than defaulting them to blank values',async()=>{
 let payload;await handleTrainerManagement({rpc:async(_name,args)=>{payload=args.payload;return {data:{ok:true}};}},'actor',{action:'trainer_save_person',personId,version:1,firstName:'Example',lastName:'Coach',active:true});
 for(const key of ['email','phone','mobile','street','postcode','city','birthDate','notes','publicPhone','publicEmail'])assert.equal(Object.hasOwn(payload,key),false,key);
});
test('protected API requires both revisions and propagates fresh database authorization failures',async()=>{
 const calls=[],db={rpc:async(name,args)=>{calls.push({name,...args});return {data:{status:403,error:'Trainerverträge erforderlich'}};}};
 await assert.rejects(()=>handleTrainerPersonalData(db,'actor',{action:'trainer_private_get',personId}),e=>e.status===403);assert.equal(calls[0].name,'trainer_personal_request');
 await assert.rejects(()=>handleTrainerPersonalData(db,'actor',{action:'trainer_private_save',personId,version:0,details:{}}));assert.equal(calls.length,1);
});
test('private contact changes invalidate drafts while explicit bank clearing prevents stale fallback',()=>{
 const teamId='20000000-0000-4000-8000-000000000001',context={version:0,teams:[{id:teamId,slug:'u13-d1',name:'D1',version:1}],people:[{id:personId,name:'Example Coach',version:1,active:true,personalVersion:2,personalBank:{holder:'Guardian',iban:'',name:''},previousBank:{holder:'Old',iban:'DE89370400440532013000',name:'Old bank'}}],assignments:[{teamId,personId,slot:'trainer'}]};
 const draft=createTrainerContractDraft(context,'2026/2027',personId,teamId,'trainer');assert.equal(draft.bank.iban,'');assert.equal(draft.bank.holder,'Guardian');assert.equal(draft.source.personalVersion,2);assert.equal(contractSourceChanged(draft,context),false);context.people[0].personalVersion++;assert.equal(contractSourceChanged(draft,context),true);
});
