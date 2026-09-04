const groupParents = {
  mens_team: ['fussballabteilung', 'alle-abteilungen', 'gesamtverein'],
  womens_team: ['fussballabteilung', 'alle-abteilungen', 'gesamtverein'],
  youth_team: ['jugendabteilung', 'fussballabteilung', 'alle-abteilungen', 'gesamtverein'],
  youth_department: ['fussballabteilung', 'alle-abteilungen', 'gesamtverein'],
  football_department: ['alle-abteilungen', 'gesamtverein'],
  all_departments: ['gesamtverein'],
  club: [],
};

/** @param {any} audience */
export function audienceHierarchy(audience) {
  const slug = String(audience?.slug ?? 'gesamtverein').trim() || 'gesamtverein';
  return [...new Set([slug, ...(groupParents[String(audience?.audience_group ?? '')] ?? ['gesamtverein'])])];
}

/** @param {{websiteAssignments?: any[], audiences?: any[], sponsorId: string}} options */
export function websiteTeamAssignments({ websiteAssignments = [], audiences = [], sponsorId }) {
  const audienceById = new Map(audiences.map((item) => [item.id, item]));
  const assignmentsBySlug = new Map(
    websiteAssignments
      .filter((assignment) => assignment.sponsor_id === sponsorId)
      .map((assignment) => [audienceById.get(assignment.audience_id)?.slug, assignment])
      .filter(([slug]) => Boolean(slug)),
  );
  return audiences
    .filter((audience) => ['mens_team', 'womens_team', 'youth_team'].includes(String(audience.audience_group ?? '')))
    .map((audience) => {
      const sourceAudienceSlug = audienceHierarchy(audience).find((slug) => assignmentsBySlug.has(slug));
      if (!sourceAudienceSlug) return null;
      const assignment = assignmentsBySlug.get(sourceAudienceSlug);
      return {
        audienceSlug: String(audience.slug),
        sourceAudienceSlug,
        sponsorTypeId: assignment.sponsor_type_id ?? null,
        description: String(assignment.description ?? '').trim(),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.audienceSlug.localeCompare(right.audienceSlug));
}

/** @param {{websiteAssignments?: any[], audiences?: any[], sponsorId: string}} options */
export function websiteTeamAudienceSlugs(options) {
  return websiteTeamAssignments(options).map((assignment) => assignment.audienceSlug);
}

/** @param {{sponsors?: any[], assignments?: any[], audiences?: any[], audience: any, context: string}} options */
export function selectAssignedSponsors({ sponsors = [], assignments = [], audiences = [], audience, context }) {
  const audienceById = new Map(audiences.map((item) => [item.id, item]));
  const sponsorById = new Map(sponsors.filter((item) => item.active && item.logo_status === 'approved').map((item) => [item.id, item]));
  const hierarchy = audienceHierarchy(audience);
  const selected = new Map();
  const selectedSponsorIds = new Set();
  for (const slug of hierarchy) {
    for (const assignment of assignments) {
      const assignedAudience = audienceById.get(assignment.audience_id);
      if (assignedAudience?.slug !== slug || assignment.context !== context || selected.has(assignment.slot) || selectedSponsorIds.has(assignment.sponsor_id)) continue;
      const sponsor = sponsorById.get(assignment.sponsor_id);
      if (sponsor) { selected.set(assignment.slot, { ...sponsor, slot: assignment.slot }); selectedSponsorIds.add(assignment.sponsor_id); }
    }
  }
  return [...selected.values()].sort((left, right) => left.slot - right.slot).slice(0, 2);
}

/** @param {any[]} sponsors */
export function sponsorMentionLine(sponsors = []) {
  const handles = [...new Set(sponsors.map((item) => String(item.instagram_handle ?? '').trim()).filter(Boolean))];
  return handles.length ? `Partner: ${handles.join(' · ')}` : '';
}

/** @param {any} sponsor @param {string} context */
export function sponsorLogoReference(sponsor, context) {
  const transparent = String(sponsor?.logo_transparent_path ?? '').trim();
  const white = String(sponsor?.logo_white_path ?? '').trim();
  return context === 'result' ? transparent || white : white || transparent;
}
