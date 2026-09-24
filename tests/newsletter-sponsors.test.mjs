import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fillSponsorSlots, selectSponsors, sponsorPools, sponsorSlots } from '../scripts/newsletter-sponsors.mjs';

const partners = JSON.parse(readFileSync(new URL('../emails/nordstern-post/sponsor-catalog.json', import.meta.url))).partners;

test('newsletter draws 3 general, 3 youth and 4 stadium partners without duplicates per block', () => {
  const selected = selectSponsors([...partners, partners[0]]);
  const pools = sponsorPools(partners);
  for (const [slot, values] of Object.entries(selected)) {
    assert.equal(values.length, sponsorSlots[slot].count);
    assert.equal(new Set(values.map(p => p.sourceId)).size, values.length);
    assert.ok(values.every(p => pools[slot].includes(p)));
  }
  assert.ok(selected.youth.every(p => p.audienceAssignments.some(a => ['youth_team', 'youth_department'].includes(a.audienceGroup))));
  assert.ok(selected.stadium.every(p => p.audienceAssignments.some(a => a.sponsorType?.slug === 'stadionheft')));
  assert.ok(selected.general.every(p => !p.audienceAssignments.length || p.audienceAssignments.some(a => a.sponsorType?.slug !== 'stadionheft')));
});

test('random draws can change the selection and insufficient pools do not silently change categories', () => {
  const left = selectSponsors(partners, () => 0);
  const right = selectSponsors(partners, maximum => maximum - 1);
  for (const slot of Object.keys(sponsorSlots)) assert.notDeepEqual(left[slot], right[slot]);
  assert.throws(() => selectSponsors([]), /Sponsoren benötigt/);
});

test('replacing sponsor slots preserves editorial content and keeps HTML and text selections aligned', () => {
  let html = '<p>Editorial remains.</p>', text = 'Editorial remains.\n';
  const selection = {};
  for (const [slot, { count, title, overview }] of Object.entries(sponsorSlots)) {
    html += `<!-- newsletter-sponsors:${slot}:start --><!-- newsletter-sponsors:${slot}:end -->`;
    text += `${title.toUpperCase()}\nAlle passenden Werbepartner: ${overview}\n`;
    selection[slot] = Array.from({ length: count }, (_, i) => ({
      name: `${slot} ${i} <Partner> & Co`, alt: `Logo ${slot} ${i}`, logo: `https://bsvnordstern.de/${slot}-${i}.png`,
      website: `https://example.org/${slot}/${i}?a=1&b=2`, width: 112, height: 50,
    }));
  }
  const first = fillSponsorSlots(html, text, selection);
  assert.deepEqual(fillSponsorSlots(first.html, first.text, selection), first);
  assert.equal((first.html.match(/<img /g) || []).length, 10);
  assert.ok(!first.html.includes('<Partner>'));
  assert.ok(first.html.startsWith('<p>Editorial remains.</p>'));
  for (const [slot, values] of Object.entries(selection)) {
    assert.ok(first.html.includes(`data-newsletter-sponsors="${slot}"`));
    for (const p of values) {
      assert.ok(first.text.includes(`${p.name}: ${p.website}`));
      assert.ok(first.html.includes(`href="${p.website.replaceAll('&', '&amp;')}"`));
    }
  }
  const newer = structuredClone(selection);
  newer.youth[0].name = 'New youth sponsor';
  const replaced = fillSponsorSlots(first.html, first.text, newer);
  assert.ok(replaced.text.includes('New youth sponsor'));
  assert.ok(!replaced.text.includes(selection.youth[0].name));
  assert.equal((replaced.html.match(/<img /g) || []).length, 10);
  assert.throws(() => fillSponsorSlots('', text, selection), /fehlt/);
});
