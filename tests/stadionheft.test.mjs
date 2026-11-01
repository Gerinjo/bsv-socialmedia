import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { normalizeSponsorPageSize, websiteAudienceAssignments, websiteTeamAssignments } from '../src/sponsor-assignments.mjs';

const admin = readFileSync(new URL('../admin-site/admin-page.html', import.meta.url), 'utf8');
function uiFunction(name, globals = {}) {
  const source = admin.split('\n').find(line => line.trimStart().startsWith(`function ${name}(`));
  return vm.runInNewContext(`${source}; ${name}`, globals);
}

test('Stadionheft requires one of the five supported page sizes', () => {
  for (const size of ['1', '1/2', '1/3', '1/4', '1/6']) {
    assert.equal(normalizeSponsorPageSize(size, 'stadionheft'), size);
  }
  for (const invalid of [undefined, null, '', '1/5', '2', '1 Seite']) {
    assert.throws(() => normalizeSponsorPageSize(invalid, 'stadionheft'), /Seitengröße/);
  }
  assert.equal(normalizeSponsorPageSize('1/2', 'teamsponsor'), null);
  assert.equal(normalizeSponsorPageSize('1/2', undefined), null);
});

test('page size remains attached to its exact audience and team assignment', () => {
  const options = {
    sponsorId: 'partner',
    audiences: [{ id: 'team', slug: 'u15', audience_group: 'youth_team' }],
    websiteAssignments: [{ sponsor_id: 'partner', audience_id: 'team', sponsor_type_id: 'heft', page_size: '1/3' }],
  };
  assert.equal(websiteAudienceAssignments(options)[0].pageSize, '1/3');
  assert.equal(websiteTeamAssignments(options)[0].pageSize, '1/3');
});

test('dropdown offers all five formats and restores the saved selection', () => {
  const html = uiFunction('stadiumPageSizeHtml')('1/4');
  assert.deepEqual([...html.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]), ['1', '1/2', '1/3', '1/4', '1/6']);
  assert.match(html, /value="1\/4" selected/);
});

test('each service requires a page size only for its own enabled Stadionheft type', () => {
  const type = { value: 'heft' };
  const size = { value: '1/2' };
  let hidden;
  const service = { querySelector: selector => ({
    '.websiteSponsorType': type, '.stadiumPageSize': size,
    '.stadiumPageSizeLabel': { classList: { toggle: (_name, value) => { hidden = value; } } },
  })[selector] };
  const update = uiFunction('updateSponsorServiceControls', {
    appData: { sponsorTypes: [{ id: 'heft', slug: 'stadionheft' }, { id: 'boards', slug: 'bandensponsor' }] },
  });
  update(service, true, true);
  assert.equal(hidden, false);
  assert.equal(size.required, true);
  assert.equal(type.required, true);
  assert.equal(size.disabled, false);
  assert.equal(size.value, '1/2');
  update(service, false, true);
  assert.equal(size.required, false);
  assert.equal(type.required, false);
  assert.equal(size.disabled, true);
  update(service, true, true);
  assert.equal(size.value, '1/2');
  type.value = 'boards';
  update(service, true, true);
  assert.equal(hidden, true);
  assert.equal(size.required, false);
  assert.equal(size.disabled, true);
  assert.equal(size.value, '');
});
