import test from 'node:test';
import assert from 'node:assert/strict';
import {recordSuiteLogin,readSuiteActivity} from '../supabase/functions/_shared/suite-activity.mjs';
import {suiteActivityDetails,suiteActivityMoney} from '../src/suite-activity.mjs';
const session='b1111111-1111-4111-8111-111111111111';
test('login audit uses verified session and original authentication time, excludes token and client metadata',async()=>{
 const calls=[],db={rpc:async(...args)=>{calls.push(args);return {data:{ok:true}}}};
 await recordSuiteLogin(db,'verified-user',{session_id:session,iat:1800000000,amr:[{method:'password',timestamp:1700000000},{method:'totp',timestamp:1700000300}],user_metadata:{name:'forged',actor:'forged'},email:'private@example.org'});
 assert.deepEqual(calls,[['suite_record_login',{actor:'verified-user',session_id:session,signed_in_at:'2023-11-14T22:13:20.000Z'}]]);
 await recordSuiteLogin(db,'verified-user',{session_id:session});assert.equal(calls[1][1].signed_in_at,null);
 await assert.rejects(()=>recordSuiteLogin(db,'verified-user',{session_id:'invalid'}),{status:401});assert.equal(calls.length,2);
});
test('audit read whitelists filters and cannot take an actor from request data',async()=>{
 const db={rpc:async(name,args)=>{assert.equal(name,'suite_activity_request');assert.deepEqual(args,{actor:'verified-user',payload:{userId:'target',category:'cashbook',from:'2026-10-11',until:'',cursor:null}});return {data:{entries:[],people:[],nextCursor:null}}}};
 await readSuiteActivity(db,'verified-user',{userId:'target',category:'cashbook',from:'2026-10-11',actor:'forged',event:'fake',password:'not stored'});
 await assert.rejects(()=>readSuiteActivity({rpc:async()=>({data:{error:'forbidden',status:403}})},'actor',{}),{status:403});
 await assert.rejects(()=>readSuiteActivity({rpc:async()=>({error:{message:'SQL details'}})},'actor',{}),{status:503});
});
test('event details distinguish correction amounts and privately advanced money',()=>{
 assert.equal(suiteActivityMoney(3500),'35,00 €');assert.equal(suiteActivityMoney(undefined),'–');
 assert.deepEqual(suiteActivityDetails({event:'cashbook_cancelled',metadata:{bookingSequence:7,previousAmountCents:3500,balanceAfterCents:9000}}),['Buchung #7','Vorher: 35,00 €','Safe danach: 90,00 €']);
 assert.ok(suiteActivityDetails({event:'cashbook_advance',metadata:{amountCents:5000}}).includes('Privat bezahlt · Safe-Bestand unverändert'));
 assert.deepEqual(suiteActivityDetails({metadata:{accessAreas:['cashbook']}}),['Rechte: Kassenbuch']);
});
