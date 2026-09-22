// Only the team's own hero image is a team photo; navigation previews and
// general football images must never become substitutes for a missing photo.
export function discoverEditorialTeamPhoto(html, pageUrl) {
  const hero = String(html).match(/<section\b[^>]*class=["'][^"']*\bgirls-team-hero\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i)?.[1];
  if (!hero || /class=["'][^"']*\bteam-image-placeholder\b/.test(hero)) return null;
  const tag = hero.match(/<div\b[^>]*class=["'][^"']*\bhero-image\b[^"']*["'][^>]*>\s*(<img\b[^>]*>)/i)?.[1];
  if (!tag) return null;
  const decode = text => text.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
  const source = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  if (!source) return null;
  const url = new URL(decode(source), pageUrl);
  if (url.protocol !== 'https:' || !['bsvnordstern.de', 'www.bsvnordstern.de'].includes(url.hostname) || !url.pathname.startsWith('/images/') || /platzhalter|placeholder/i.test(url.pathname)) return null;
  return { source_url: url.href, alt: decode(tag.match(/\balt="([^"]*)"/i)?.[1] || tag.match(/\balt='([^']*)'/i)?.[1] || 'Mannschaftsbild') };
}
