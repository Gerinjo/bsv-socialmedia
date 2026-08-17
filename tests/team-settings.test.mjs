import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TEAM_COLOR_SCHEME,
  applyTeamColorScheme,
  normalizeTeamColorScheme,
  resolveTeamColorScheme,
  teamFamilyKey,
  teamAllowsAutomaticPublishing,
  teamContentEnabled,
} from '../src/team-settings.mjs';

test('team content requires an active team and enabled generation', () => {
  assert.equal(teamContentEnabled({ active: true, content_enabled: true }), true);
  assert.equal(teamContentEnabled({ active: false, content_enabled: true }), false);
  assert.equal(teamContentEnabled({ active: true, content_enabled: false }), false);
});

test('team slugs map to the four color families', () => {
  assert.equal(teamFamilyKey('herren-1'), 'herren');
  assert.equal(teamFamilyKey('alte-herren'), 'herren');
  assert.equal(teamFamilyKey('frauen-2'), 'frauen');
  assert.equal(teamFamilyKey('u15-c1-junioren'), 'junioren');
  assert.equal(teamFamilyKey('u17-juniorinnen'), 'juniorinnen');
});

test('team color source resolves global, family, and individual palettes', () => {
  const groupScheme = { ...DEFAULT_TEAM_COLOR_SCHEME, primary: '#123456' };
  const teamScheme = { ...DEFAULT_TEAM_COLOR_SCHEME, primary: '#abcdef' };
  assert.equal(resolveTeamColorScheme({ source: 'global', groupScheme, teamScheme }).primary, '#91c82f');
  assert.equal(resolveTeamColorScheme({ source: 'group', groupScheme, teamScheme }).primary, '#123456');
  assert.equal(resolveTeamColorScheme({ source: 'custom', groupScheme, teamScheme }).primary, '#abcdef');
});

test('automatic publishing additionally respects the global safety switch', () => {
  const team = { active: true, content_enabled: true, publishing_mode: 'automatic' };
  assert.equal(teamAllowsAutomaticPublishing(team, false), true);
  assert.equal(teamAllowsAutomaticPublishing(team, true), false);
  assert.equal(teamAllowsAutomaticPublishing({ ...team, publishing_mode: 'manual' }, false), false);
});

test('invalid or incomplete colors safely fall back to the BSV palette', () => {
  assert.deepEqual(normalizeTeamColorScheme({ primary: '#2255AA', accent: 'red' }), {
    ...DEFAULT_TEAM_COLOR_SCHEME,
    primary: '#2255aa',
  });
});

test('team palette replaces template colors without touching unrelated colors', () => {
  const svg = '<svg fill="#071f16" stroke="#91c82f"><path fill="#d62828"/></svg>';
  const themed = applyTeamColorScheme(svg, { background: '#112233', primary: '#abcdef' });
  assert.match(themed, /fill="#112233"/);
  assert.match(themed, /stroke="#abcdef"/);
  assert.match(themed, /fill="#d62828"/);
});
