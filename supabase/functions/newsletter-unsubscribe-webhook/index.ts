import { withSupabase } from 'npm:@supabase/server@1.4.1';
import { Webhook } from 'npm:svix@2.5.0';
import { createUnsubscribeWebhook, NORDSTERN_SEGMENT_ID } from './handler.mjs';

export default {
  fetch: withSupabase({auth:'none'}, async (request, context) => {
    const secret = Deno.env.get('RESEND_NEWSLETTER_WEBHOOK_SECRET');
    let webhook: Webhook | null = null;
    try { if (secret) webhook = new Webhook(secret); } catch { /* fail closed below */ }
    return createUnsubscribeWebhook({
      db:context.supabaseAdmin,
      verify:webhook ? (raw: string, headers: Record<string,string>)=>webhook!.verify(raw,headers) : null,
      config:{
        enabled:Deno.env.get('NEWSLETTER_UNSUBSCRIBE_EMAIL_ENABLED') === 'true',
        apiKey:Deno.env.get('RESEND_API_KEY') || '',
        from:Deno.env.get('NEWSLETTER_FROM') || 'BSV Nordstern Radolfzell <info@bsvnordstern.de>',
        segmentId:Deno.env.get('NEWSLETTER_RESEND_SEGMENT_ID') || NORDSTERN_SEGMENT_ID,
      },
    })(request);
  }),
};
