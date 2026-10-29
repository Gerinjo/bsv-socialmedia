import test from 'node:test';
import assert from 'node:assert/strict';
import {handleTrainerAccounts} from '../supabase/functions/suite-trainer-accounts/handler.mjs';
const jobId='00000000-0000-4000-8000-000000000001',personId='00000000-0000-4000-8000-000000000002';
const request=()=>new Request('https://example.test',{method:'POST',headers:{'x-provision-token':'a'.repeat(43)},body:JSON.stringify({jobId})});
test('provisioning checks the job capability before creating Auth accounts',async()=>{
 let created=0;
 const db={rpc:async()=>({data:{error:'denied',status:403}}),auth:{admin:{createUser:()=>created++}}};
 assert.equal((await handleTrainerAccounts(request(),db)).status,403);assert.equal(created,0);
 assert.equal((await handleTrainerAccounts(new Request('https://example.test',{method:'POST',body:'{}'}),db)).status,403);
});
test('new Auth accounts are confirmed without email invitations and cleaned up if membership fails',async()=>{
 const calls=[],person={personId,email:'trainer@example.test',username:'train'};
 const db={rpc:async(_name,{payload})=>{calls.push(payload.action);return {data:payload.action==='claim'?{people:[person]}:payload.action==='finish_person'?{error:'conflict',status:409}:{ok:true}};},auth:{admin:{createUser:async data=>{assert.equal(data.email_confirm,true);assert.equal(data.app_metadata.trainer_person_id,personId);assert.ok(data.password);calls.push('auth_create');return {data:{user:{id:'new'}}};},deleteUser:async id=>{assert.equal(id,'new');calls.push('auth_delete');return {};}}}};
 const result=await (await handleTrainerAccounts(request(),db)).json();assert.equal(result.created,0);assert.equal(result.ok,false);assert.deepEqual(calls,['claim','auth_create','finish_person','auth_delete','complete']);
});
