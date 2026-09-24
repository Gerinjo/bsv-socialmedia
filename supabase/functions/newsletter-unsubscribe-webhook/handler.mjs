import { unsubscribeConfirmationEmail } from '../../../src/newsletter-unsubscribe.mjs';
export const NORDSTERN_SEGMENT_ID = '76a53fca-4c76-40a7-8c56-404806f88364';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const response = (status, state) => Response.json({status:state},{status,headers:{'cache-control':'no-store'}});
const checked = async query => {
  const result = await query;
  if (result.error) throw new Error('database_unavailable');
  return result.data;
};

export function createUnsubscribeWebhook({ db, verify, config, fetcher = fetch, sleep = ms => new Promise(resolve=>setTimeout(resolve,ms)) }) {
  async function resend(method,path,body,key) {
    for(let attempt=0;attempt<3;attempt++) {
      const result = await fetcher(`https://api.resend.com${path}`,{
        method,headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),
      });
      if (result.status === 404 && method === 'GET') return null;
      if (result.status === 429 && attempt < 2) {
        await result.body?.cancel();
        await sleep(Math.min(10000,Math.max(1000,Number(result.headers.get('retry-after'))*1000 || 1000)));
        continue;
      }
      if (!result.ok) throw new Error('provider_unavailable');
      return result.json();
    }
  }
  async function isNewsletterContact(data) {
    if (Array.isArray(data.segment_ids)) return data.segment_ids.includes(config.segmentId || NORDSTERN_SEGMENT_ID);
    // Older Resend payloads use audience_id instead of segment_ids.
    if (data.audience_id === (config.segmentId || NORDSTERN_SEGMENT_ID)) return true;
    let after = '';
    for(let page=0;page<20;page++) {
      const result = await resend('GET',`/contacts/${data.id}/segments?limit=100${after?`&after=${encodeURIComponent(after)}`:''}`);
      if (!result) return false;
      if (!Array.isArray(result.data)) throw new Error('provider_unavailable');
      if (result.data.some(segment=>segment.id === (config.segmentId || NORDSTERN_SEGMENT_ID))) return true;
      if (!result.has_more) return false;
      const next = result.data.at(-1)?.id;
      if (!uuid.test(next || '') || next === after) throw new Error('provider_unavailable');
      after=next;
    }
    throw new Error('provider_unavailable');
  }
  return async request => {
    if (request.method !== 'POST') return response(405,'method_not_allowed');
    if (!config.enabled || !config.apiKey || !config.from || !verify) return response(503,'not_configured');
    if (Number(request.headers.get('content-length'))>32768) return response(413,'too_large');
    let event;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length>32768) return response(413,'too_large');
      event = await verify(raw,Object.fromEntries(['svix-id','svix-timestamp','svix-signature'].map(name=>[name,request.headers.get(name)||''])));
    } catch { return response(400,'invalid_signature'); }
    if (event?.type !== 'contact.updated') return response(200,'ignored');
    const data = event.data;
    const timestamp = Date.parse(data?.updated_at);
    if (!uuid.test(data?.id || '') || typeof data?.unsubscribed !== 'boolean' || !Number.isFinite(timestamp) || timestamp>Date.now()+300000) return response(400,'invalid_event');
    let job;
    const finish = status => checked(db.rpc('finish_newsletter_unsubscribe_receipt',{
      p_contact_id:data.id,p_lease_id:job.lease_id,p_status:status,p_provider_id:null,
    }));
    try {
      if (!await isNewsletterContact(data)) return response(200,'ignored');
      job = await checked(db.rpc('claim_newsletter_unsubscribe_receipt',{
        p_contact_id:data.id,p_event_at:new Date(timestamp).toISOString(),p_unsubscribed:data.unsubscribed,
      }));
      if (job.status === 'busy' || job.status === 'needs_review') return response(503,job.status);
      if (job.status !== 'processing') return response(200,job.status);
      // A delayed webhook must not confirm an outdated opt-out after re-subscription.
      // Never use an address supplied by the browser, or the webhook's old address.
      const contact = await resend('GET',`/contacts/${data.id}`);
      if (!contact || contact.unsubscribed !== true) {
        await finish('skipped');
        return response(200,'skipped');
      }
      if (typeof contact.email !== 'string' || contact.email.length>254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact.email)) throw new Error('invalid_contact');
      const mail = unsubscribeConfirmationEmail();
      const sent = await resend('POST','/emails',{
        from:config.from,to:[contact.email],...mail,
      },`nordstern-unsubscribe/${job.notification_id}`);
      if (!sent?.id) throw new Error('provider_unavailable');
      const saved = await checked(db.rpc('finish_newsletter_unsubscribe_receipt',{
        p_contact_id:data.id,p_lease_id:job.lease_id,p_status:'sent',p_provider_id:sent.id,
      }));
      if (!saved) throw new Error('lease_changed');
      return response(200,'sent');
    } catch {
      // Non-2xx asks Resend to retry. The same notification uses the same send key.
      // Do not log webhook bodies, email addresses, provider errors or bearer links.
      if (job?.status === 'processing') { try { await finish('pending'); } catch { /* lease expires */ } }
      return response(503,'retry');
    }
  };
}
