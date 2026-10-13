import test from 'node:test';import assert from 'node:assert/strict';
import {handleTrainerContactRecipients} from '../supabase/functions/trainer-contact-recipients/handler.mjs';
import {trainerContactEmails,validateTrainerTeam} from '../src/trainer-management.mjs';
test('team contact emails validate, normalize and deduplicate without clearing older clients',()=>{
 assert.deepEqual(trainerContactEmails(' Team@Example.test; other@example.test\nteam@example.test'),['team@example.test','other@example.test']);
 assert.deepEqual(validateTrainerTeam({teamId:'team',version:1,assignments:[],contactEmails:''}).contactEmails,[]);
 assert.equal(Object.hasOwn(validateTrainerTeam({teamId:'team',version:1,assignments:[]}),'contactEmails'),false);
 for(const value of ['bad',[42],Array(21).fill('a@example.test'),'a@example.test\n<script>'])assert.throws(()=>trainerContactEmails(value));
});
test('private recipient endpoint rejects unsigned requests and oversized data before database access',async()=>{
 const db={rpc(){throw new Error('must not touch the database');}};
 assert.equal((await handleTrainerContactRecipients(new Request('https://example.test'),{db})).status,405);
 assert.equal((await handleTrainerContactRecipients(new Request('https://example.test',{method:'POST',body:'{}'}),{db})).status,401);
 assert.equal((await handleTrainerContactRecipients(new Request('https://example.test',{method:'POST',headers:{'x-bsv-contact-signature':'a'.repeat(64)},body:'x'.repeat(2049)}),{db})).status,413);
});
test('private endpoint delegates signature verification, preserves authorization errors and does not cache addresses',async()=>{
 const request=()=>new Request('https://example.test',{method:'POST',headers:{'x-bsv-contact-signature':'a'.repeat(64)},body:JSON.stringify({purpose:'trainer-contact',routingKey:'team--jugend--u15-c1'})});
 let args;const db={rpc:async(name,payload)=>{assert.equal(name,'resolve_trainer_contact');args=payload;return {data:{ok:true,managed:true,label:'C1',emails:['coach@example.test']}};}};
 const response=await handleTrainerContactRecipients(request(),{db});
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal(args.signature,'a'.repeat(64));assert.deepEqual((await response.json()).emails,['coach@example.test']);
 for(const value of [{data:{error:'unauthorized',status:401}},{error:{message:'failure'}}])assert.equal((await handleTrainerContactRecipients(request(),{db:{rpc:async()=>value}})).status,value.data?401:503);
});
