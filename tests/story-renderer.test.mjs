import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillTemplate, renderStorySvg, xmlEscape } from '../src/story-renderer.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const match = {
  matchId: 'TEST-123',
  competition: 'Testspiel',
  homeTeam: 'BSV Nordstern & Freunde',
  awayTeam: '<VfR Test>',
  date: '13. August 2026',
  time: '19:00 Uhr',
  venue: 'Nordstern-Sportplatz',
  homeScore: 3,
  awayScore: 1,
};

test('XML-Inhalte werden sicher escaped', () => {
  assert.equal(xmlEscape('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
});

test('fehlende Template-Werte führen zu einem Fehler', () => {
  assert.throws(() => fillTemplate('{{MISSING}}', {}), /Fehlender Template-Wert/);
});

for (const type of ['announcement', 'lineup', 'result']) {
  test(`${type} rendert ein vollständiges Story-SVG`, async () => {
    const svg = await renderStorySvg({
      rootDir,
      type,
      match,
      lineup: { players: [{ number: 1, name: 'M. Test' }] },
    });
    assert.match(svg, /viewBox="0 0 1080 1920"/);
    assert.doesNotMatch(svg, /\{\{[A-Z0-9_]+\}\}/);
    assert.match(svg, /BSV Nordstern &amp; Freunde/);
  });
}

test('birthday rendert Namen, Glückwunsch und Spielerbild', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'birthday',
    match: {
      birthdayName: 'Max & Freunde',
      birthdayMessage: 'Alles Gute vom ganzen Verein!',
    },
  });
  assert.match(svg, /Max &amp; Freunde/);
  assert.match(svg, /Alles Gute vom ganzen Verein!/);
  assert.match(svg, /data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(svg, /\{\{[A-Z0-9_]+\}\}/);
});
