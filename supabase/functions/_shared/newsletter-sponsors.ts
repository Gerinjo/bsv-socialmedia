// Freeze approved, contract-valid partner pools and permanent logos with the issue.
export async function prepareNewsletterSponsors(db: any, issue: any) {
  if (issue.advertising?.newsletterSponsors && issue.advertising.issueDate === issue.publishes_on) return issue.advertising;
  const [{data:sponsors,error}, {data:assignments,error:assignmentError}, {data:audiences,error:audienceError}, {data:types,error:typeError}] = await Promise.all([
    db.from('social_sponsors').select('id,name,website_url,logo_transparent_path,updated_at').eq('active',true).eq('logo_status','approved').not('logo_transparent_path','is',null)
      .or(`contract_start_date.is.null,contract_start_date.lte.${issue.publishes_on}`).or(`contract_end_date.is.null,contract_end_date.gte.${issue.publishes_on}`).order('id'),
    db.from('social_sponsor_website_assignments').select('sponsor_id,audience_id,sponsor_type_id'),
    db.from('social_post_audiences').select('id,audience_group'),
    db.from('social_sponsor_types').select('id,slug'),
  ]);
  if (error || assignmentError || audienceError || typeError) throw new Error('Die Newsletter-Sponsoren konnten nicht geladen werden.');
  const groups = new Map((audiences || []).map((row: any) => [row.id,row.audience_group]));
  const kinds = new Map((types || []).map((row: any) => [row.id,row.slug]));
  const general: any[] = [], youth: any[] = [];
  for (const sponsor of sponsors || []) {
    const assigned = (assignments || []).filter((row: any) => row.sponsor_id === sponsor.id);
    const isYouth = assigned.some((row: any) => ['youth_department','youth_team'].includes(String(groups.get(row.audience_id))));
    const isGeneral = !assigned.length || assigned.some((row: any) => kinds.get(row.sponsor_type_id) !== 'stadionheft');
    if (!isYouth && !isGeneral) continue;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sponsor.logo_transparent_path + ':' + sponsor.updated_at)));
    const hash = [...digest].map(byte => byte.toString(16).padStart(2,'0')).join('');
    const path = `${issue.id}/sponsors/${sponsor.id}-${hash}.png`;
    const {error:copyError} = await db.storage.from('social-story-previews').copy(sponsor.logo_transparent_path,path,{destinationBucket:'editorial-public-images'});
    if (copyError && String(copyError.statusCode) !== '409' && !/already exists|duplicate/i.test(copyError.message || '')) throw new Error(`Das Logo von ${sponsor.name} konnte nicht für den Newsletter bereitgestellt werden.`);
    const partner = {id:sponsor.id,name:sponsor.name,website:sponsor.website_url,logo:db.storage.from('editorial-public-images').getPublicUrl(path).data.publicUrl};
    if (isYouth) youth.push(partner);
    if (isGeneral) general.push(partner);
  }
  return {issueDate:issue.publishes_on,ads:[],newsletterSponsors:{general,youth}};
}
