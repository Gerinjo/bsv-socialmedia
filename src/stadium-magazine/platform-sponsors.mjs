export const FORMATS = Object.freeze({ '1': [2, 6], '1/2': [2, 3], '1/3': [2, 2], '1/4': [1, 3], '1/6': [1, 2] });

export function selectMagazineSponsors(feed) {
  if (feed?.version !== 1 || feed.type !== 'stadionheft' || !Array.isArray(feed.sponsors)) throw new Error('Ungültiger Plattform-Export');
  const ads = [], missing = [], seen = new Set();
  for (const sponsor of feed.sponsors) {
    if (!sponsor.id || seen.has(sponsor.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sponsor.slug)) throw new Error('Ungültiger oder doppelter Sponsor');
    seen.add(sponsor.id);
    const assignments = (sponsor.assignments || []).filter(item => item.type === 'stadionheft');
    if (!assignments.length) continue;
    const sizes = [...new Set(assignments.map(item => item.pageSize))];
    const reason = sizes.length !== 1 ? 'Widersprüchliche Formate in den Zuordnungen' : !FORMATS[sizes[0]] ? 'Gültiges Stadionheft-Format fehlt' : !sponsor.imageUrl ? 'Freigegebenes Motiv fehlt' : null;
    if (reason) { missing.push({ id: sponsor.id, name: sponsor.name, reason }); continue; }
    ads.push({ id: sponsor.slug, platformId: sponsor.id, name: sponsor.name, format: sizes[0], websiteUrl: sponsor.websiteUrl || null, updatedAt: sponsor.updatedAt, audiences: [...new Set(assignments.map(item => item.audienceSlug).filter(Boolean))], imageUrl: sponsor.imageUrl });
  }
  return { ads: ads.sort((a, b) => a.id.localeCompare(b.id)), missing };
}
