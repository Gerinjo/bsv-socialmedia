const crestClubText = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').toLocaleLowerCase('de').replace(/[^a-z0-9]+/g,' ').trim();
const crestClubNames = club => [club.name,...(club.aliases || []).map(alias => alias.alias || alias)].filter(Boolean);
const crestClubTokens = name => crestClubText(name).split(' ').filter(token => token.length >= 3 && !/^(?:sg|jsg|sgm|sgg|fc|sv|sc|tsv|tv|vfb|vfl|fsv|bsv|spvgg|spvggg|spielgemeinschaft|junioren|juniorinnen|herren|frauen|[0-9]+)$/.test(token));
export function isJointClub(club) {
  return crestClubNames(club).some(name => /^(?:(?:j\s*\.?\s*)?s\s*\.?\s*g(?:m|g)?\.?)(?:\s|[/-])|^spielgemeinschaft\b/i.test(String(name).trim()));
}
export function crestClubSuggestions(club, clubs, query = '') {
  const terms = crestClubText(query).split(' ').filter(Boolean);
  const target = crestClubNames(club).flatMap(crestClubTokens);
  return clubs.filter(candidate => candidate.id !== club.id && candidate.crest_original_url && candidate.crest_transparent_url && ['approved','needs_review'].includes(candidate.crest_status))
    .map(candidate => {
      const names = crestClubNames(candidate);
      const tokens = names.flatMap(crestClubTokens);
      const score = tokens.reduce((sum,token) => sum + (target.some(part => part === token || Math.min(part.length,token.length) >= 4 && (part.startsWith(token) || token.startsWith(part))) ? 100 : 0),0);
      return {club:candidate,score:score ? score + (isJointClub(candidate) ? 0 : 25) : 0,matches:terms.every(term => crestClubText(names.join(' ')).includes(term))};
    }).filter(item => item.matches).sort((a,b) => b.score-a.score || a.club.name.localeCompare(b.club.name,'de'));
}
export function crestDownloadName(club, variant, url = '') {
  let extension = variant === 'transparent' ? 'png' : 'png';
  try { const match = new URL(url, 'https://example.org').pathname.match(/\.(png|jpe?g|webp|svg)$/i); if (match) extension = match[1].toLowerCase(); } catch {}
  return `${crestClubText(club.name).replaceAll(' ','-') || 'verein'}-wappen-${variant === 'transparent' ? 'transparent' : 'original'}.${extension}`;
}
