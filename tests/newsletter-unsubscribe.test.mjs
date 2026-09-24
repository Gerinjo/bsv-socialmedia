import test from 'node:test';
import assert from 'node:assert/strict';
import {resendUnsubscribeTarget,renderNewsletterUnsubscribePage,unsubscribeConfirmationEmail} from '../src/newsletter-unsubscribe.mjs';
import {createUnsubscribeWebhook,NORDSTERN_SEGMENT_ID} from '../supabase/functions/newsletter-unsubscribe-webhook/handler.mjs';
const id='10000000-0000-4000-8000-000000000001';
const event={type:'contact.updated',data:{id,updated_at:'2026-09-24T14:00:00Z',unsubscribed:true,segment_ids:[NORDSTERN_SEGMENT_ID],email:'outdated@example.org'}};
const job={status:'processing',notification_id:'notification-one',lease_id:'lease-one'};
function setup({payload=event,replies=[job,true],responses,verify,config={}}={}) {
  const calls=[],requests=[];
  const db={rpc:async(name,args)=>{calls.push({name,args});const reply=replies.shift();return reply instanceof Error?{error:reply}:{data:reply,error:null};}};
  const options={db,verify:verify || (()=>structuredClone(payload)),config:{enabled:true,apiKey:'fake-key',from:'BSV <info@example.org>',...config},sleep:async()=>{},fetcher:async(url,options)=>{
    requests.push({url,...options,body:options.body?JSON.parse(options.body):null});
    if(responses)return responses.shift();
    return Response.json(options.method==='POST'?{id:'email-one'}:{id,email:'actual@example.org',unsubscribed:true});
  }};
  return {handle:createUnsubscribeWebhook(options),calls,requests};
}
const request=()=>new Request('https://example.test/webhook',{method:'POST',body:JSON.stringify(event),headers:{'svix-id':'message-one','svix-timestamp':'timestamp','svix-signature':'signature'}});
test('confirmation page accepts only personal HTTPS provider links and rejects other destinations',()=>{
  assert.equal(resendUnsubscribeTarget('#https://resend.com/unsubscribe/token?x=1&y=2'),'https://resend.com/unsubscribe/token?x=1&y=2');
  assert.equal(resendUnsubscribeTarget('#'+encodeURIComponent('https://u.resend.com/token')),'https://u.resend.com/token');
  for(const input of ['','#{{{RESEND_UNSUBSCRIBE_URL}}}','#javascript:alert(1)','#https://resend.com.evil.test/token','#https://evil.test/resend.com/token','#http://resend.com/token','#https://user:pass@resend.com/token','#https://resend.com:444/token','#https://resend.com/','#https://resend.com/<script>','#%invalid'])assert.equal(resendUnsubscribeTarget(input),null,input);
  const page=renderNewsletterUnsubscribePage();
  assert.match(page,/Abmeldung bestätigen/);
  assert.match(page,/addEventListener\('submit'/);
  assert.match(page,/location.replace\(target\)/);
  assert.doesNotMatch(page,/<script src|fetch\(|<img|<link[^>]+href=/);
});
test('confirmation mail only acknowledges opt-out without advertising or a re-subscribe button',()=>{
  const mail=unsubscribeConfirmationEmail();
  assert.match(mail.subject,/Abmeldung.*bestätigt/);
  for(const output of [mail.html,mail.text]){
    assert.match(output,/keine weiteren Newsletter/);
    assert.match(output,/Du musst nichts weiter tun/);
    assert.doesNotMatch(output,/Sponsor|Werbepartner|Jetzt anmelden|RESEND_UNSUBSCRIBE_URL/);
  }
});
test('webhook sends only after a verified opt-out, to the current provider address, with an idempotency key',async()=>{
  let verified=false;
  const {handle,calls,requests}=setup({verify:(raw,headers)=>{assert.equal(raw,JSON.stringify(event));assert.equal(headers['svix-id'],'message-one');verified=true;return event;}});
  assert.equal((await handle(request())).status,200);
  assert.ok(verified);
  assert.equal(calls[0].name,'claim_newsletter_unsubscribe_receipt');
  assert.equal(calls[0].args.p_unsubscribed,true);
  assert.equal(requests.length,2);
  assert.equal(requests[0].method,'GET');
  assert.deepEqual(requests[1].body.to,['actual@example.org']);
  assert.equal(requests[1].headers['Idempotency-Key'],'nordstern-unsubscribe/notification-one');
  assert.equal(calls[1].args.p_status,'sent');
});
test('GET, disabled setup, forged signatures, unrelated events and other segments never send',async()=>{
  for(const [options,req,status] of [
    [{},new Request('https://example.test/webhook'),405],
    [{config:{enabled:false}},request(),503],
    [{verify:()=>{throw new Error('bad')}},request(),400],
    [{payload:{...event,type:'email.clicked'}},request(),200],
    [{payload:{...event,data:{...event.data,id:'../emails'}}},request(),400],
    [{payload:{...event,data:{...event.data,segment_ids:['another-segment']}}},request(),200],
  ]){const ctx=setup(options);assert.equal((await ctx.handle(req)).status,status);assert.equal(ctx.calls.length,0);assert.equal(ctx.requests.length,0);}
});
test('duplicate, stale, in-flight and exhausted notifications cannot cause another email',async()=>{
  for(const state of ['sent','ignored','busy','skipped','needs_review']){
    const ctx=setup({replies:[{status:state}]});
    assert.equal((await ctx.handle(request())).status,['busy','needs_review'].includes(state)?503:200);
    assert.equal(ctx.requests.length,0);
  }
});
test('provider opt-in or deleted contact suppresses a delayed notification',async()=>{
  for(const response of [Response.json({id,email:'actual@example.org',unsubscribed:false}),new Response('',{status:404})]){
    const ctx=setup({responses:[response]});
    assert.equal((await ctx.handle(request())).status,200);
    assert.equal(ctx.requests.length,1);
    assert.equal(ctx.calls.at(-1).args.p_status,'skipped');
  }
});
test('send failure requeues the same receipt and returns a retryable webhook status',async()=>{
  const ctx=setup({responses:[Response.json({id,email:'actual@example.org',unsubscribed:true}),new Response('',{status:503})]});
  assert.equal((await ctx.handle(request())).status,503);
  assert.equal(ctx.calls.at(-1).args.p_status,'pending');
  assert.equal(ctx.requests[1].headers['Idempotency-Key'],'nordstern-unsubscribe/notification-one');
});
test('legacy events resolve segment membership and follow pagination before sending',async()=>{
  const payload=structuredClone(event);delete payload.data.segment_ids;
  const ctx=setup({payload,responses:[Response.json({data:[{id:'20000000-0000-4000-8000-000000000001'}],has_more:true}),Response.json({data:[{id:NORDSTERN_SEGMENT_ID}],has_more:false}),Response.json({id,email:'actual@example.org',unsubscribed:true}),Response.json({id:'mail-one'})]});
  assert.equal((await ctx.handle(request())).status,200);
  assert.match(ctx.requests[1].url,/after=20000000/);
  assert.equal(ctx.requests.at(-1).method,'POST');
});
test('provider rate limiting is retried, without changing the send key',async()=>{
  const ctx=setup({responses:[Response.json({id,email:'actual@example.org',unsubscribed:true}),new Response('',{status:429,headers:{'retry-after':'1'}}),Response.json({id:'mail-one'})]});
  assert.equal((await ctx.handle(request())).status,200);
  assert.equal(ctx.requests[1].headers['Idempotency-Key'],ctx.requests[2].headers['Idempotency-Key']);
});
