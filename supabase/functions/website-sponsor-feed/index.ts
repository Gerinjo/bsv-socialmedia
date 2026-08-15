import { withSupabase } from 'npm:@supabase/server@1.4.1';
import { runtimeConfig } from '../_shared/config.ts';

const bucket = 'social-story-previews';

function secretsMatch(candidate: string, expected: string): boolean {
  if (!candidate || !expected || candidate.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

const secretHandler = withSupabase({ auth: 'secret' }, async (request, context) => {
  if (request.method !== 'GET') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }

  const { data, error } = await context.supabaseAdmin
    .from('social_sponsors')
    .select('id, slug, name, website_url, instagram_handle, logo_transparent_path, sort_order, updated_at')
    .eq('active', true)
    .eq('logo_status', 'approved')
    .not('logo_transparent_path', 'is', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('Werbepartner konnten nicht geladen werden:', error);
    return Response.json({ error: 'sponsors_unavailable' }, { status: 500 });
  }

  const partners = await Promise.all((data ?? []).map(async (partner) => {
    const { data: signed, error: signedError } = await context.supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(partner.logo_transparent_path, 15 * 60);
    if (signedError || !signed?.signedUrl) {
      throw new Error(`Logo für ${partner.slug} konnte nicht bereitgestellt werden.`);
    }
    return {
      id: partner.id,
      slug: partner.slug,
      name: partner.name,
      websiteUrl: partner.website_url,
      instagramHandle: partner.instagram_handle,
      logoUrl: signed.signedUrl,
      sortOrder: partner.sort_order,
      updatedAt: partner.updated_at,
    };
  }));

  return Response.json(
    { ok: true, partners },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});

export default {
  fetch(request: Request): Promise<Response> {
    const expected = runtimeConfig.websiteSponsorSyncSecret;
    const candidate = request.headers.get('x-bsv-sponsor-sync-secret') ?? '';
    if (!expected) {
      console.error('WEBSITE_SPONSOR_SYNC_SECRET ist nicht konfiguriert.');
      return Promise.resolve(Response.json({ error: 'sync_not_configured' }, { status: 503 }));
    }
    if (!secretsMatch(candidate, expected)) {
      return Promise.resolve(Response.json({ error: 'unauthorized' }, { status: 401 }));
    }

    const headers = new Headers(request.headers);
    headers.set('apikey', runtimeConfig.workerApiKey);
    return secretHandler(new Request(request, { headers }));
  },
};
