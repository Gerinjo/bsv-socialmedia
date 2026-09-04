import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminSource = readFileSync(new URL('../admin-site/admin-page.html', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../supabase/functions/social-media-admin-api/index.ts', import.meta.url), 'utf8');
const feedSource = readFileSync(new URL('../supabase/functions/website-sponsor-feed/index.ts', import.meta.url), 'utf8');
const migrationSource = readFileSync(new URL('../supabase/migrations/20260904125648_add_sponsor_type_display_weight.sql', import.meta.url), 'utf8');

test('sponsor logo upload accepts SVG and rasterizes only safely checked vectors', () => {
  assert.match(adminSource, /accept="image\/png,image\/jpeg,image\/webp,image\/svg\+xml,\.svg"/);
  assert.match(adminSource, /function safeSvgDataUrl/);
  assert.match(adminSource, /script,style,foreignObject,iframe,object,embed,audio,video/);
  assert.match(adminSource, /name\.startsWith\('on'\)/);
  assert.match(adminSource, /!value\.startsWith\('#'\)/);
  assert.match(adminSource, /const originalDataUrl=svg\?canvas\.toDataURL\('image\/png'\):sourceDataUrl/);
});

test('sponsor type display weight is maintained by the backend and exported to the website', () => {
  assert.match(migrationSource, /display_weight smallint not null default 1/);
  assert.match(migrationSource, /check \(display_weight between 1 and 3\)/);
  assert.match(adminSource, /name="displayWeight"/);
  assert.match(apiSource, /display_weight: displayWeight/);
  assert.match(apiSource, /displayWeight < 1 \|\| displayWeight > 3/);
  assert.match(feedSource, /displayWeight: sponsorType\.display_weight/);
  assert.match(feedSource, /sortOrder: sponsorType\.sort_order/);
});

test('opening Sponsoring defaults to the sponsor overview section', () => {
  assert.match(adminSource, /area==='sponsoring'\?'sponsors'/);
});

test('sponsor overview prioritizes incomplete partners and collapses approved partners', () => {
  assert.match(adminSource, /function sponsorNeedsAttention\(sponsor\)\{return sponsor\.logo_status!=='approved'\}/);
  assert.match(adminSource, /<details class="sponsor-card"[^]*\(expanded\?'open':''\)/);
  assert.match(adminSource, /sponsorGroupHtml\('Noch zu bearbeiten',incomplete,true\)/);
  assert.match(adminSource, /sponsorGroupHtml\('Freigegebene Partner',approved,false\)/);
  assert.match(adminSource, /sort\(\(a,b\)=>a\.name\.localeCompare\(b\.name,'de'/);
});

test('sponsor search stays above the list and filters it live', () => {
  assert.ok(adminSource.indexOf('id="sponsorSearch"') < adminSource.indexOf('id="newSponsorForm"'));
  assert.ok(adminSource.indexOf('id="sponsorSearch"') < adminSource.indexOf('id="sponsorList"'));
  assert.match(adminSource, /querySelector\('#sponsorSearch'\)\.oninput=renderSponsors/);
  assert.match(adminSource, /sponsors\.length\+' von '\+allSponsors\.length\+' Partnern angezeigt'/);
});
