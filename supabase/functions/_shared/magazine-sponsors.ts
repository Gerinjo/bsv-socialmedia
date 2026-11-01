import { magazineArtworkSource } from './sponsor-magazine-artwork.mjs';
// Shared selection for the external magazine feed and the editorial preview.
// Only fields intended for an advertisement leave this module.
export async function loadMagazineSponsors(db: any, date: string) {
  const { data: type, error: typeError } = await db.from('social_sponsor_types').select('id').eq('slug', 'stadionheft').maybeSingle();
  if (typeError || !type) throw new Error('sponsor_type_unavailable');
  const [{ data: assignments, error: assignmentError }, { data: audiences, error: audienceError }] = await Promise.all([
    db.from('social_sponsor_website_assignments').select('sponsor_id,audience_id,page_size').eq('sponsor_type_id', type.id),
    db.from('social_post_audiences').select('id,slug,label,audience_group'),
  ]);
  if (assignmentError || audienceError) throw new Error('assignments_unavailable');
  const ids = [...new Set((assignments || []).map((row: any) => row.sponsor_id))];
  if (!ids.length) return [];
  const { data: sponsors, error } = await db.from('social_sponsors')
    .select('id,slug,name,website_url,logo_transparent_path,logo_status,magazine_ad_path,magazine_ad_status,updated_at')
    .in('id', ids).eq('active', true)
    .or(`contract_start_date.is.null,contract_start_date.lte.${date}`)
    .or(`contract_end_date.is.null,contract_end_date.gte.${date}`)
    .order('slug');
  if (error) throw new Error('sponsors_unavailable');
  const audienceById = new Map((audiences || []).map((row: any) => [row.id, row]));
  return (sponsors || []).filter((sponsor: any) => magazineArtworkSource(sponsor)).map((sponsor: any) => ({
    id: sponsor.id, slug: sponsor.slug, name: sponsor.name, websiteUrl: sponsor.website_url,
    sourcePath: magazineArtworkSource(sponsor), updatedAt: sponsor.updated_at,
    assignments: (assignments || []).filter((row: any) => row.sponsor_id === sponsor.id).map((row: any) => {
      const audience: any = audienceById.get(row.audience_id);
      return { type: 'stadionheft', pageSize: row.page_size, audienceSlug: audience?.slug, audienceGroup: audience?.audience_group };
    }),
  }));
}
