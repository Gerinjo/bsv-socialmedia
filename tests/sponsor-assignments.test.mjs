import test from 'node:test';
import assert from 'node:assert/strict';
import { audienceHierarchy, selectAssignedSponsors, sponsorLogoReference, sponsorMentionLine } from '../src/sponsor-assignments.mjs';
import { sponsorLogoStrip } from '../src/story-renderer.mjs';

test('teams inherit sponsor slots while keeping their own overrides', () => {
  const audiences = [
    { id: 'club', slug: 'gesamtverein', audience_group: 'club' },
    { id: 'football', slug: 'fussballabteilung', audience_group: 'football_department' },
    { id: 'team', slug: 'herren-1', audience_group: 'mens_team' },
  ];
  const sponsors = [
    { id: 'a', name: 'Clubpartner', active: true, logo_status: 'approved', instagram_handle: '@club' },
    { id: 'b', name: 'Teampartner', active: true, logo_status: 'approved', instagram_handle: '@team' },
  ];
  const assignments = [
    { sponsor_id: 'a', audience_id: 'club', context: 'announcement', slot: 1 },
    { sponsor_id: 'b', audience_id: 'team', context: 'announcement', slot: 1 },
    { sponsor_id: 'a', audience_id: 'football', context: 'announcement', slot: 2 },
  ];
  assert.deepEqual(audienceHierarchy(audiences[2]), ['herren-1', 'fussballabteilung', 'alle-abteilungen', 'gesamtverein']);
  const selected = selectAssignedSponsors({ sponsors, assignments, audiences, audience: audiences[2], context: 'announcement' });
  assert.deepEqual(selected.map((item) => item.name), ['Teampartner', 'Clubpartner']);
  assert.equal(sponsorMentionLine(selected), 'Partner: @team · @club');
});

test('renderer places at most two sponsor logos without a background box', () => {
  const svg = sponsorLogoStrip('announcement', ['data:image/png;base64,ONE', 'data:image/png;base64,TWO', 'data:image/png;base64,THREE']);
  assert.match(svg, /aria-label="Werbepartner"/);
  assert.match(svg, /ONE/);
  assert.match(svg, /TWO/);
  assert.doesNotMatch(svg, /THREE/);
  assert.doesNotMatch(svg, /<rect/);
  assert.doesNotMatch(svg, /fill="#071f16"/);
});

test('renderer centers one sponsor and places two sponsors side by side', () => {
  const one = sponsorLogoStrip('announcement', ['data:image/png;base64,ONE']);
  assert.match(one, /<image[^>]+x="144"[^>]+width="792"/);

  const two = sponsorLogoStrip('announcement', ['data:image/png;base64,ONE', 'data:image/png;base64,TWO']);
  assert.match(two, /<image[^>]+x="144"[^>]+width="396"/);
  assert.match(two, /<image[^>]+x="540"[^>]+width="396"/);
});

test('lineup doubles the height of a single sponsor but keeps two sponsors compact', () => {
  const one = sponsorLogoStrip('lineup', ['data:image/png;base64,ONE']);
  assert.match(one, /<image[^>]+y="1744"[^>]+height="96"/);

  const two = sponsorLogoStrip('lineup', ['data:image/png;base64,ONE', 'data:image/png;base64,TWO']);
  assert.match(two, /<image[^>]+y="1768"[^>]+height="48"/);
  assert.equal((two.match(/height="48"/g) ?? []).length, 2);
});

test('result uses the colored transparent sponsor logo at a larger size', () => {
  const sponsor = { logo_transparent_path: 'sponsors/acme/transparent.png', logo_white_path: 'sponsors/acme/white.png' };
  assert.equal(sponsorLogoReference(sponsor, 'result'), 'sponsors/acme/transparent.png');
  assert.equal(sponsorLogoReference(sponsor, 'announcement'), 'sponsors/acme/white.png');
  const svg = sponsorLogoStrip('result', ['data:image/png;base64,COLOR']);
  assert.match(svg, /y="1405"[^>]+height="250"/);
  assert.doesNotMatch(svg, /<rect/);
});
