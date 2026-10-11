import test from 'node:test';
import assert from 'node:assert/strict';
import { cashbookAmount, cashbookUsername, validateCashbookBooking, validateCashbookChange } from '../src/cashbook.mjs';
import { handleCashbookWorkspace } from '../supabase/functions/_shared/cashbook-evidence.mjs';
import { handleSuiteLogin } from '../supabase/functions/suite-auth/handler.mjs';
import { provisionCashbookAccounts } from '../supabase/functions/social-media-admin-api/cashbook.mjs';
import { deliverCashbookAlerts } from '../supabase/functions/cashbook-alerts/handler.mjs';
import { cashbookManifest } from '../src/cashbook-pwa.mjs';

const id='11111111-1111-4111-8111-111111111111';
const token='a'.repeat(64);
const png='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,...new Array(100).fill(0)]).toString('base64');
async function handleCashbook(request,db) {
  try {return Response.json(await handleCashbookWorkspace(db,id,await request.json()));}
  catch(error){return Response.json({error:error.message},{status:error.status||400});}
}
const request=body=>new Request('https://example.org',{method:'POST',body:JSON.stringify(body)});
const booking={action:'book',token,requestId:id,direction:'withdrawal',amountCents:3425,teamId:id,note:'Heimspiel',confirmed:true,evidence:png,signature:png,signatureDrawn:true};

test('exact cent amounts reject ambiguity, floating point rounding and nonpositive values',()=>{
  for(const [input,expected] of [['34,25',3425],['0.01',1],['50',5000],['10,1',1010]])assert.equal(cashbookAmount(input),expected);
  for(const input of ['-1','0','0.00','1,234','1.000,50','Infinity','1e3','NaN','1.005',''])assert.throws(()=>cashbookAmount(input));
});
test('club login names include compound surnames and normalized umlauts',()=>{
  for(const [name,login] of [['Max Mustermann','mustm'],['Wiebke Baronner-Dieterle','barow'],['Claudia Gastaudo','gastc'],['Axel Schäuble','schaa'],['Simon Bühler','buhls'],['Jan Groß','grosj']])assert.equal(cashbookUsername(name),login);
});
test('booking needs integer cents, own-team reference, confirmation and stable request id',()=>{
  assert.equal(validateCashbookBooking(booking).amountCents,3425);
  for(const change of [{confirmed:false},{amountCents:1.5},{amountCents:0},{teamId:null},{requestId:'bad'},{direction:'edit'},{note:'a'.repeat(501)}])assert.throws(()=>validateCashbookBooking({...booking,...change}));
});
test('own-entry edits and cancellations require a target, confirmation and reason',()=>{
  const edit={...booking,action:'edit',id,reason:'Falscher Betrag'};
  assert.equal(validateCashbookChange(edit).amountCents,3425);
  assert.equal(validateCashbookChange({...edit,action:'cancel',amountCents:null}).amountCents,undefined);
  for(const change of [{id:'wrong'},{requestId:null},{confirmed:false},{reason:''},{reason:'x'.repeat(501)},{amountCents:0},{amountCents:1.5},{teamId:null}])assert.throws(()=>validateCashbookChange({...edit,...change}));
});
test('change ownership is checked before uploads, and retained evidence comes from the server',async()=>{
  let uploads=0;const calls=[];
  const change={...booking,action:'edit',id,reason:'Betrag korrigiert',evidence:undefined,evidencePath:'spoofed/path'};
  const db={rpc:async(name,{actor,payload})=>{assert.equal(actor,id);calls.push(payload);return {data:payload.action==='authorize_change'?{canBook:true,user:{id,role:'trainer'},teams:[{id}],entry:{evidencePath:'trusted/photo',evidenceHash:'b'.repeat(64)}}:{entries:[]}};},storage:{from:()=>({upload:async()=>{uploads++;return {};}})}};
  assert.equal((await handleCashbook(request(change),db)).status,200);assert.equal(uploads,1);
  assert.equal(calls.at(-1).evidencePath,'trusted/photo');assert.equal(calls.at(-1).evidenceHash,'b'.repeat(64));
  uploads=0;assert.equal((await handleCashbook(request({...change,evidence:png}),db)).status,200);assert.equal(uploads,2);
  assert.ok(calls.at(-1).evidencePath.startsWith(`${id}/${id}/evidence-`));
  uploads=0;assert.equal((await handleCashbook(request({...change,action:'cancel',amountCents:99999999,evidencePath:'spoofed',evidence:png}),db)).status,200);assert.equal(uploads,1);
  assert.equal(calls.at(-1).amountCents,undefined);assert.equal(calls.at(-1).evidencePath,'trusted/photo');
  uploads=0;
  assert.equal((await handleCashbook(request({...change,actor:'spoofed'}),{...db,rpc:async()=>({data:{error:'Not your entry',status:403}})})).status,403);assert.equal(uploads,0);
  assert.equal((await handleCashbook(request({...change,teamId:'22222222-2222-4222-8222-222222222222'}),db)).status,403);assert.equal(uploads,0);
  assert.equal((await handleCashbook(request({...change,signatureDrawn:false}),db)).status,400);assert.equal(uploads,0);
});
test('username aliases sign into the same Supabase Auth session and never check birthday fields',async()=>{
  const calls=[];
  const admin={rpc:async(name,{payload})=>{calls.push(payload);assert.equal(name,'suite_cashbook_login');return {data:payload.action==='attempt'?{email:'existing@example.test'}:{ok:true}};}};
  const auth={signInWithPassword:async credentials=>{assert.deepEqual(credentials,{email:'existing@example.test',password:'Changed-password'});return {data:{session:{access_token:'suite-jwt',refresh_token:'suite-refresh'}}};}};
  const response=await handleSuiteLogin(request({username:'MUSTM',password:'Changed-password',birthDate:'spoof',action:'success'}),admin,auth);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{access_token:'suite-jwt',refresh_token:'suite-refresh'});assert.deepEqual(calls,[{action:'attempt',username:'mustm'},{action:'success',username:'mustm'}]);
  assert.equal(response.headers.get('cache-control'),'no-store');
});
test('a failed or throttled shared login does not issue sessions or reset the limiter',async()=>{
  let calls=0,signins=0;
  const admin={rpc:async()=>{calls++;return {data:{email:'account@example.test'}};}};
  const auth={signInWithPassword:async()=>{signins++;return {error:{message:'Secret'}};}};
  const response=await handleSuiteLogin(request({username:'mustm',password:'wrong'}),admin,auth);
  assert.equal(response.status,403);assert.equal(calls,1);assert.equal(signins,1);assert.doesNotMatch(await response.text(),/Secret/);
  const denied=await handleSuiteLogin(request({username:'mustm',password:'wrong'}),{rpc:async()=>({data:{error:'Rate limit',status:429}})},auth);
  assert.equal(denied.status,429);assert.equal(signins,1);
});
test('no uploads occur for revoked access, foreign teams, deposits by trainers or missing signature',async()=>{
  let uploads=0;
  const db={rpc:async()=>({data:{user:{id,role:'trainer'},canBook:true,teams:[{id}]}}),storage:{from:()=>({upload:async()=>{uploads++;return {};}})}};
  for(const change of [{direction:'deposit'},{teamId:'22222222-2222-4222-8222-222222222222'},{teamId:'22222222-2222-4222-8222-222222222222',isYouthLeader:true},{signatureDrawn:false},{signature:undefined},{evidence:'data:application/pdf;base64,JVBERi0='}])assert.ok((await handleCashbook(request({...booking,...change}),db)).status>=400);
  assert.equal(uploads,0);
  assert.equal((await handleCashbook(request(booking),{...db,rpc:async()=>({data:{error:'Revoked',status:401}})})).status,401);assert.equal(uploads,0);
});
test('trusted server derives evidence paths, strips spoofed fields and retains the idempotency id',async()=>{
  const uploads=[];const calls=[];
  const db={rpc:async(name,{actor,payload})=>{assert.equal(actor,id);calls.push(payload);return {data:payload.action==='authorize'?{user:{id,role:'trainer'},canBook:true,teams:[{id}]}:{balanceCents:1000,entries:[]}};},storage:{from:bucket=>{assert.equal(bucket,'cashbook-evidence');return {upload:async(path,bytes,options)=>{uploads.push(path);assert.equal(options.upsert,false);assert.ok(bytes.length>0);return {};}};}}};
  const response=await handleCashbook(request({...booking,balanceCents:999999999,personName:'Fake',evidencePath:'foreign/file',signaturePath:'foreign/signature',createdAt:'1900-01-01',actor:'spoofed',userId:'spoofed',role:'cashier'}),db);
  assert.equal(response.status,200);assert.equal(uploads.length,2);const payload=calls.at(-1);assert.equal(payload.requestId,id);assert.ok(payload.evidencePath.startsWith(`${id}/${id}/evidence-`));assert.equal(payload.personName,undefined);assert.equal(payload.balanceCents,undefined);assert.equal(payload.createdAt,undefined);assert.equal(payload.token,undefined);assert.equal(payload.birthDate,undefined);
});
test('identical upload retries reuse immutable content-addressed objects',async()=>{
  const db={rpc:async(name,{payload})=>({data:payload.action==='authorize'?{user:{id,role:'trainer'},canBook:true,teams:[{id}]}:{entryId:id,entries:[]}}),storage:{from:()=>({upload:async()=>({error:{statusCode:'409'}})})}};
  assert.equal((await handleCashbook(request(booking),db)).status,200);
});
test('fresh authorization errors retain status; obsolete public login actions are rejected',async()=>{
  for(const status of [401,403,409,429])assert.equal((await handleCashbook(request({action:'list'}),{rpc:async()=>({data:{error:'Denied',status}})})).status,status);
  for(const action of ['cashbook_account','cashbook_settings','delete','authorize','login','logout'])assert.equal((await handleCashbook(request({action}),{})).status,400);
});
test('provisioning uses the club initial password even when birthdays are missing',async()=>{
  let creates=0;const actions=[];
  const db={rpc:async(name,{actor,payload})=>{assert.equal(actor,id);actions.push(payload);return {data:payload.action==='cashbook_provision_data'?{accounts:[{id,personId:id,name:'Max',birthDate:'1980-01-01'},{id:'missing',personId:'missing',name:'Missing'}]}:{accounts:[]}};},auth:{admin:{createUser:async body=>{creates++;assert.equal(body.password,'bsv1956');assert.deepEqual(body.app_metadata.access_areas,['cashbook']);return {data:{user:{id}}};}}}};
  const result=await provisionCashbookAccounts(db,id,{});assert.equal(creates,2);assert.equal(result.provision.created,2);assert.deepEqual(result.provision.skipped,[]);assert.deepEqual(actions.filter(action=>action.action==='cashbook_bind').map(action=>action.personId),[id,'missing']);
});
test('provisioning retry binds an existing Suite identity without resetting its password',async()=>{
  const actions=[];
  const db={rpc:async(name,{payload})=>{actions.push(payload);return {data:payload.action==='cashbook_provision_data'?{accounts:[{id,personId:id,name:'Max'}]}:{accounts:[]}};},auth:{admin:{
    createUser:async()=>({error:{code:'email_exists',message:'Already registered'}}),
    listUsers:async()=>({data:{users:[{id,email:`cashbook-${id}@suite.bsvnordstern.invalid`}]}}),
    updateUserById:async()=>{assert.fail('Existing passwords must never be reset by provisioning.');},
  }}};
  const result=await provisionCashbookAccounts(db,id,{});
  assert.equal(result.provision.created,1);assert.deepEqual(result.provision.errors,[]);assert.equal(actions[1].action,'cashbook_bind');assert.equal(actions[1].userId,id);
});
test('mail delivery claims a durable outbox item and supplies an idempotency key',async()=>{
  const actions=[];let fetched=0;
  const db={rpc:async(name,{payload})=>{assert.equal(name,'cashbook_alert_request');actions.push(payload);return {data:payload.action==='claim'&&actions.length===1?{id,lease_id:id,recipient:'jugendkasse@bsvnordstern.de',balance_cents:4999}:null};}};
  const result=await deliverCashbookAlerts(db,{apiKey:'test',from:'BSV <test@example.org>',fetcher:async(url,options)=>{fetched++;assert.equal(options.headers['idempotency-key'],`cashbook-low-${id}`);const body=JSON.parse(options.body);assert.deepEqual(body.to,['jugendkasse@bsvnordstern.de']);assert.match(body.text,/49,99/);return new Response('{}');}});
  assert.equal(fetched,1);assert.equal(result.sent,1);assert.equal(actions[1].action,'sent');assert.equal(actions[1].leaseId,id);
});
test('a mail failure schedules another attempt; missing settings leave the outbox untouched',async()=>{
  const actions=[];const db={rpc:async(name,{payload})=>{actions.push(payload);return {data:actions.length===1?{id,lease_id:id,recipient:'test@example.org',balance_cents:100}:null};}};
  assert.equal((await deliverCashbookAlerts(db,{apiKey:'test',from:'test',fetcher:async()=>new Response('{}',{status:503})})).sent,0);assert.equal(actions[1].action,'failed');
  actions.length=0;assert.equal((await deliverCashbookAlerts(db,{})).configured,false);assert.equal(actions.length,0);
});
test('installable app shares the suite scope and both required PNG icon sizes',()=>{
  assert.equal(cashbookManifest.start_url,'/?area=cashbook');assert.equal(cashbookManifest.scope,'/');assert.equal(cashbookManifest.display,'standalone');assert.deepEqual(cashbookManifest.icons.map(i=>i.sizes),['192x192','512x512']);
});

test('server capability permits youth-leader deposits with a photo and immutable attribution',async()=>{
  let uploads=0;const calls=[];
  const db={rpc:async(_name,{actor,payload})=>{assert.equal(actor,id);calls.push(payload);return {data:payload.action==='authorize'?{canBook:true,canDeposit:true,user:{id,role:'trainer',isYouthLeader:true},teams:[{id}]}:{entries:[]}}},storage:{from:()=>({upload:async()=>{uploads++;return {}}})}};
  const response=await handleCashbook(request({...booking,direction:'deposit',signature:undefined,signatureDrawn:false,teamId:null,canDeposit:true,personName:'Fake',createdAt:'Fake'}),db);
  assert.equal(response.status,200);assert.equal(uploads,1);
  assert.equal(calls.at(-1).direction,'deposit');assert.equal(calls.at(-1).teamId,null);assert.equal(calls.at(-1).signaturePath,null);
  assert.equal(calls.at(-1).personName,undefined);assert.equal(calls.at(-1).createdAt,undefined);assert.ok(calls.at(-1).evidencePath.startsWith(`${id}/${id}/evidence-`));
});

test('deposit permission is rechecked before upload and cannot be supplied by the client',async()=>{
  let uploads=0;const db={rpc:async()=>({data:{canBook:true,canDeposit:false,user:{id,role:'trainer',isYouthLeader:false},teams:[{id}]}}),storage:{from:()=>({upload:async()=>{uploads++;return {}}})}};
  assert.equal((await handleCashbook(request({...booking,direction:'deposit',canDeposit:true,isYouthLeader:true,user:{role:'cashier'}}),db)).status,403);
  const revoked={...db,rpc:async()=>({data:{canBook:false,canDeposit:true,user:{id,role:'trainer',isYouthLeader:true},teams:[{id}]}})};
  assert.equal((await handleCashbook(request({...booking,direction:'deposit'}),revoked)).status,403);assert.equal(uploads,0);
});
