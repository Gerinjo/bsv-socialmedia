import { withSupabase } from 'npm:@supabase/server@1.4.1';
import { deliverCashbookAlerts } from './handler.mjs';
const handler = withSupabase({ auth: 'none' }, async (request, context) => {
  const secret = Deno.env.get('SOCIAL_WORKER_CRON_SECRET');
  if (!secret || request.headers.get('x-bsv-cron-secret') !== secret) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    return Response.json(await deliverCashbookAlerts(context.supabaseAdmin, { apiKey: Deno.env.get('RESEND_API_KEY'), from: Deno.env.get('CASHBOOK_FROM') || Deno.env.get('NEWSLETTER_FROM') }));
  } catch { return Response.json({ error: 'Versand vorübergehend nicht verfügbar.' }, { status: 503 }); }
});
export default { fetch: handler };
