import { randomInt } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://bsvnordstern.de';
export const sponsorSlots = {
  general: { count: 3, title: 'Danke an unsere Sponsoren', overview: `${origin}/werbepartner` },
  youth: { count: 3, title: 'Danke an unsere Jugendsponsoren', overview: `${origin}/werbepartner?bereich=jugendabteilung` },
  stadium: { count: 4, title: 'Danke an unsere Stadionheft-Sponsoren', overview: `${origin}/werbepartner?sponsorart=stadionheft` },
};

export function sponsorPools(partners) {
  const unique = [...new Map(partners.map(partner => [partner.sourceId, partner])).values()];
  return {
    // Same approved general pool as HomeSponsorShowcase: exclude stadium-only partners.
    general: unique.filter(p => p.audienceAssignments.length === 0 || p.audienceAssignments.some(a => a.sponsorType?.slug !== 'stadionheft')),
    youth: unique.filter(p => p.audienceAssignments.some(a => ['youth_department', 'youth_team'].includes(a.audienceGroup))),
    stadium: unique.filter(p => p.audienceAssignments.some(a => a.sponsorType?.slug === 'stadionheft')),
  };
}

export function selectSponsors(partners, draw = randomInt) {
  const pools = sponsorPools(partners);
  return Object.fromEntries(Object.entries(sponsorSlots).map(([slot, { count }]) => {
    const pool = [...pools[slot]];
    if (pool.length < count) throw new Error(`${slot}: ${count} Sponsoren benötigt, nur ${pool.length} vorhanden.`);
    // Fisher–Yates: uniform draw without replacement, freshly performed on each run.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = draw(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return [slot, pool.slice(0, count)];
  }));
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function publicSponsor(partner) {
  if (!/^\/images\/sponsors\/synced\/[a-z0-9-]+\.png$/.test(partner.logoSrc)) throw new Error(`Ungültiges Logo: ${partner.slug}`);
  const width = partner.logoWidth, height = partner.logoHeight;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error(`Ungültige Bildgröße: ${partner.slug}`);
  const scale = Math.min(112 / width, 64 / height, 1);
  const website = new URL(partner.website || `${origin}/werbepartner`);
  if (!['https:', 'http:'].includes(website.protocol) || website.username || website.password) throw new Error(`Ungültiger Sponsorlink: ${partner.slug}`);
  return {
    id: partner.sourceId, name: partner.name, logo: new URL(partner.logoSrc, origin).href,
    alt: partner.logoAlt || `Logo von ${partner.name}`, website: website.href,
    width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)),
  };
}

export function renderSponsors(slot, sponsors) {
  const { title, overview, count } = sponsorSlots[slot];
  if (sponsors.length !== count) throw new Error(`Falsche Anzahl für ${slot}.`);
  const columns = slot === 'stadium' ? 2 : 3;
  const rows = [];
  for (let i = 0; i < sponsors.length; i += columns) {
    rows.push(`<tr>${sponsors.slice(i, i + columns).map(p => `
      <td class="newsletter-sponsor-cell" width="${100 / columns}%" valign="top" align="center" bgcolor="#ffffff" style="width:${100 / columns}%;padding:12px 8px;border:1px solid #dce4d9;background-color:#ffffff;vertical-align:top;text-align:center;">
        <table role="presentation" width="100%"><tr><td height="72" align="center" valign="middle" style="height:72px;text-align:center;vertical-align:middle;">
          <a href="${escapeHtml(p.website)}" style="color:#17613a;text-decoration:none;"><img src="${escapeHtml(p.logo)}" alt="${escapeHtml(p.alt)}" width="${p.width}" height="${p.height}" style="display:block;width:${p.width}px;height:${p.height}px;max-width:100%;border:0;margin:0 auto;" /></a>
        </td></tr></table>
        <p style="margin:10px 0 0;font-size:12px;line-height:18px;overflow-wrap:anywhere;"><a href="${escapeHtml(p.website)}" style="color:#17613a;font-weight:bold;text-decoration:none;">${escapeHtml(p.name)}</a></p>
      </td>`).join('')}</tr>`);
  }
  return {
    html: `<div data-newsletter-sponsors="${slot}" style="margin-top:24px;padding-top:20px;border-top:1px solid #dce4d9;">
      <p style="margin:0 0 12px;color:#17613a;font-size:13px;line-height:20px;font-weight:bold;">${title}</p>
      <table role="presentation" width="100%" style="width:100%;table-layout:fixed;border-collapse:collapse;">${rows.join('\n')}</table>
      <p style="margin:12px 0 0;font-size:12px;line-height:20px;"><a href="${escapeHtml(overview)}" style="color:#17613a;">Alle passenden Werbepartner ansehen →</a></p>
    </div>`,
    text: `${title.toUpperCase()}\n${sponsors.map(p => `${p.name}: ${p.website}`).join('\n')}\nAlle passenden Werbepartner: ${overview}`,
  };
}

export function fillSponsorSlots(html, text, selection) {
  for (const [slot, sponsors] of Object.entries(selection)) {
    const { title, overview } = sponsorSlots[slot];
    const block = renderSponsors(slot, sponsors);
    const htmlPattern = new RegExp(`(<!-- newsletter-sponsors:${slot}:start -->)[\\s\\S]*?(<!-- newsletter-sponsors:${slot}:end -->)`, 'g');
    const textPattern = new RegExp(`${escapeRegex(title.toUpperCase())}\\n[\\s\\S]*?Alle passenden Werbepartner: ${escapeRegex(overview)}(?=\\n|$)`, 'g');
    if ([...html.matchAll(htmlPattern)].length !== 1 || [...text.matchAll(textPattern)].length !== 1) throw new Error(`Sponsorplatz ${slot} fehlt oder ist mehrfach vorhanden.`);
    html = html.replace(htmlPattern, (_, start, end) => `${start}\n${block.html}\n${end}`);
    text = text.replace(textPattern, () => block.text);
  }
  return { html, text };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2];
  if (!base) throw new Error('Aufruf: node scripts/newsletter-sponsors.mjs emails/nordstern-post/2026-09');
  if (/\.sent$/.test(base)) throw new Error('Das Versandarchiv darf nicht verändert werden. Bitte eine neue Ausgabe anlegen.');
  const partners = JSON.parse(readFileSync(resolve(root, 'emails/nordstern-post/sponsor-catalog.json'), 'utf8')).partners;
  const chosen = selectSponsors(partners);
  const selection = Object.fromEntries(Object.entries(chosen).map(([slot, values]) => [slot, values.map(publicSponsor)]));
  const result = fillSponsorSlots(readFileSync(`${base}.html`, 'utf8'), readFileSync(`${base}.txt`, 'utf8'), selection);
  // Only local files are changed. The same stored selection is used for HTML and text.
  writeFileSync(`${base}.html`, result.html);
  writeFileSync(`${base}.txt`, result.text);
  writeFileSync(`${base}.sponsors.json`, JSON.stringify({ selected_at: new Date().toISOString(), selection }, null, 2) + '\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(selection).map(([slot, values]) => [slot, values.map(p => p.name)])), null, 2));
}
