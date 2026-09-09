import { withSupabase } from 'npm:@supabase/server@1.4.1';

// Public advertising material only. Contracts, contacts and internal notes are
// used neither in the response nor in signed object paths supplied by callers.
export default {
  fetch: withSupabase({ auth: 'publishable' }, async (request, context) => {
    if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const date = new URL(request.url).searchParams.get('date') || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
      return Response.json({ error: 'invalid_date' }, { status: 400 });
    }
    const db = context.supabaseAdmin;
    const { data: type, error: typeError } = await db.from('social_sponsor_types').select('id').eq('slug', 'stadionheft').maybeSingle();
    if (typeError || !type) return Response.json({ error: 'sponsor_type_unavailable' }, { status: 503 });
    const [{ data: assignments, error: assignmentError }, { data: audiences, error: audienceError }] = await Promise.all([
      db.from('social_sponsor_website_assignments').select('sponsor_id,audience_id,page_size').eq('sponsor_type_id', type.id),
      db.from('social_post_audiences').select('id,slug,label,audience_group'),
    ]);
    if (assignmentError || audienceError) return Response.json({ error: 'assignments_unavailable' }, { status: 503 });
    const ids = [...new Set((assignments || []).map(row => row.sponsor_id))];
    const envelope = { version: 1, type: 'stadionheft', issueDate: date, fetchedAt: new Date().toISOString() };
    if (!ids.length) return Response.json({ ...envelope, sponsors: [] });
    const { data: sponsors, error } = await db.from('social_sponsors')
      .select('id,slug,name,website_url,logo_transparent_path,updated_at')
      .in('id', ids).eq('active', true).eq('logo_status', 'approved').not('logo_transparent_path', 'is', null)
      .or(`contract_start_date.is.null,contract_start_date.lte.${date}`)
      .or(`contract_end_date.is.null,contract_end_date.gte.${date}`)
      .order('slug');
    if (error) return Response.json({ error: 'sponsors_unavailable' }, { status: 503 });
    const audienceById = new Map((audiences || []).map(row => [row.id, row]));
    try {
      const result = await Promise.all((sponsors || []).map(async sponsor => {
        const { data: image, error: imageError } = await db.storage.from('social-story-previews').createSignedUrl(sponsor.logo_transparent_path, 900);
        if (imageError || !image?.signedUrl) throw new Error('image_unavailable');
        return {
          id: sponsor.id, slug: sponsor.slug, name: sponsor.name, websiteUrl: sponsor.website_url,
          imageUrl: image.signedUrl, updatedAt: sponsor.updated_at,
          assignments: (assignments || []).filter(row => row.sponsor_id === sponsor.id).map(row => {
            const audience = audienceById.get(row.audience_id);
            return { type: 'stadionheft', pageSize: row.page_size, audienceSlug: audience?.slug, audienceGroup: audience?.audience_group };
          }),
        };
      }));
      return Response.json({ ...envelope, sponsors: result }, { headers: { 'cache-control': 'private, no-store' } });
    } catch {
      return Response.json({ error: 'advertising_image_unavailable' }, { status: 503 });
    }
  }),
};
