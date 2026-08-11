import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayTeamName, fillTemplate, renderStorySvg, teamCrestKey, xmlEscape } from '../src/story-renderer.mjs';

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

test('lange SG-Mannschaftsnamen werden nur im Bild abgekürzt', () => {
  const fullName = 'SG Nordstern Radolfzell/Öhningen-Gaienhofen/Bankholzen-Moos';
  assert.equal(displayTeamName(fullName), 'SG Nordstern Radolfzell / Höri');
  assert.equal(displayTeamName(`${fullName} 2`), 'SG Nordstern Radolfzell / Höri 2');
});

test('Gastwappen werden für bekannte Vereinsnamen zugeordnet', () => {
  assert.equal(teamCrestKey('TSV Aach-Linz 2'), 'tsv-aach-linz');
  assert.equal(teamCrestKey('TSV Aach Linz II'), 'tsv-aach-linz');
  assert.equal(teamCrestKey('SG Nordstern Radolfzell/Öhningen-Gaienhofen/Bankholzen-Moos'), 'bsv');
  assert.equal(teamCrestKey('Unbekannter Gegner'), undefined);
});

test('bekanntes Gastwappen wird in die Spielankündigung eingebettet', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'announcement',
    match: { ...match, awayTeam: 'TSV Aach-Linz 2' },
  });
  assert.match(svg, /tsv-aach-linz|data:image\/png;base64,/);
  assert.match(svg, /opacity="1"/);
  assert.match(svg, /y="383"/);
});

test('Story-SVG verwendet den abgekürzten SG-Mannschaftsnamen', async () => {
  const fullName = 'SG Nordstern Radolfzell/Öhningen-Gaienhofen/Bankholzen-Moos';
  const svg = await renderStorySvg({
    rootDir,
    type: 'announcement',
    match: { ...match, homeTeam: fullName },
  });
  assert.match(svg, /SG Nordstern Radolfzell \/ Höri/);
  assert.doesNotMatch(svg, /Öhningen-Gaienhofen/);
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
  assert.match(svg, /data:image\/png;base64,/);
  assert.doesNotMatch(svg, /\{\{[A-Z0-9_]+\}\}/);
});
