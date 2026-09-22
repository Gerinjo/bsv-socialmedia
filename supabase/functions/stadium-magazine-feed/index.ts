import { loadMagazineSponsors } from '../_shared/magazine-sponsors.ts';
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
    const envelope = { version: 1, type: 'stadionheft', issueDate: date, fetchedAt: new Date().toISOString() };
    try {
      const sponsors = await loadMagazineSponsors(db, date);
      const result = await Promise.all(sponsors.map(async ({ sourcePath, ...sponsor }: any) => {
        const { data: image, error: imageError } = await db.storage.from('social-story-previews').createSignedUrl(sourcePath, 900);
        if (imageError || !image?.signedUrl) throw new Error('image_unavailable');
        return { ...sponsor, imageUrl: image.signedUrl };
      }));
      return Response.json({ ...envelope, sponsors: result }, { headers: { 'cache-control': 'private, no-store' } });
    } catch (error) {
      return Response.json({ error: error instanceof Error && ['sponsor_type_unavailable', 'assignments_unavailable', 'sponsors_unavailable'].includes(error.message) ? error.message : 'advertising_image_unavailable' }, { status: 503 });
    }
  }),
};
