import assert from 'node:assert/strict';
import { Webhook } from 'npm:svix@2.5.0';
import { createUnsubscribeWebhook } from '../supabase/functions/newsletter-unsubscribe-webhook/handler.mjs';
Deno.test('real Svix signatures accept unchanged recent events and reject tampering and replay',async()=>{
  const verifier=new Webhook('whsec_'+btoa('01234567890123456789012345678901'));
  const raw=JSON.stringify({type:'email.sent'}),id='msg_signature_test',date=new Date();
  const signature=verifier.sign(id,date,raw);
  let queries=0;
  const handle=createUnsubscribeWebhook({db:{rpc:()=>{queries++;throw new Error('Unexpected database call');}},verify:(body:string,headers:Record<string,string>)=>verifier.verify(body,headers),config:{enabled:true,apiKey:'fake',from:'fake@example.org'}});
  const request=(body=raw,stamp=date,sign=signature)=>new Request('https://example.test/webhook',{method:'POST',body,headers:{'svix-id':id,'svix-timestamp':String(Math.floor(stamp.getTime()/1000)),'svix-signature':sign}});
  assert.equal((await handle(request())).status,200);
  assert.equal((await handle(request(raw+' '))).status,400);
  const old=new Date(Date.now()-600000);
  assert.equal((await handle(request(raw,old,verifier.sign(id,old,raw)))).status,400);
  assert.equal((await handle(request(raw,date,'v1,broken'))).status,400);
  assert.equal(queries,0);
});
