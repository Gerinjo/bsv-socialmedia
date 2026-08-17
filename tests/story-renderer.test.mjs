import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { birthdayRoleText, compactLineupName, displayTeamName, fillTemplate, renderStorySvg, scorerRows, teamCategoryLabel, teamCrestKey, xmlEscape } from '../src/story-renderer.mjs';

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

test('Mannschaftskategorien unterscheiden Herren, Frauen, Junioren und Juniorinnen', () => {
  assert.equal(teamCategoryLabel({ slug: 'herren-1' }), 'HERREN');
  assert.equal(teamCategoryLabel({ slug: 'frauen-1' }), 'FRAUEN');
  assert.equal(teamCategoryLabel({ slug: 'u15-c1-junioren' }), 'JUNIOREN');
  assert.equal(teamCategoryLabel({ slug: 'u15-juniorinnen', audienceGroup: 'youth_team' }), 'JUNIORINNEN');
  assert.equal(teamCategoryLabel({ slug: 'u7-bambinis', audienceGroup: 'youth_team' }), 'JUNIOREN');
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

test('Vornamen werden in der Aufstellung platzsparend abgekürzt', () => {
  assert.equal(compactLineupName('Pascal Brandenburg'), 'P. Brandenburg');
  assert.equal(compactLineupName('Mohamad Salim Hartel'), 'M. Salim Hartel');
  assert.equal(compactLineupName('Baqer Al Daraji'), 'B. Al Daraji');
  assert.equal(compactLineupName('David Pereira Honorato'), 'D. Pereira Honorato');
  assert.equal(compactLineupName('M. Test'), 'M. Test');
});

test('Aufstellungs-SVG zeigt abgekürzte Vornamen', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'lineup',
    match,
    lineup: { players: [{ number: 14, name: 'Mohamad Salim Hartel' }] },
  });
  assert.match(svg, />M\. Salim Hartel<\/text>/);
  assert.doesNotMatch(svg, />Mohamad Salim Hartel<\/text>/);
});

test('Mannschaftsfarben werden auf das fertige Story-Template angewendet', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'lineup',
    match,
    lineup: { players: [{ number: 14, name: 'M. Test' }] },
    colorScheme: {
      background: '#112233',
      panel: '#223344',
      primary: '#33aa77',
      accent: '#ffbb22',
      muted: '#aabbcc',
      surface: '#fefefe',
      ink: '#111111',
    },
  });
  assert.match(svg, /#112233/);
  assert.match(svg, /#33aa77/);
  assert.match(svg, /#ffbb22/);
  assert.doesNotMatch(svg, /#071f16/i);
  assert.doesNotMatch(svg, /#91c82f/i);
});

test('Mannschaftsfarben werden auch auf Spielankündigungen angewendet', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'announcement',
    match,
    colorScheme: {
      background: '#05010e',
      panel: '#5113ae',
      primary: '#9a8dc9',
      accent: '#2f1736',
      muted: '#a8cbb4',
      surface: '#f4f1e8',
      ink: '#12071d',
    },
  });
  for (const color of ['#05010e', '#5113ae', '#9a8dc9', '#2f1736', '#a8cbb4', '#f4f1e8', '#12071d']) {
    assert.match(svg, new RegExp(color, 'i'));
  }
  assert.doesNotMatch(svg, /#071f16/i);
  assert.doesNotMatch(svg, /#91c82f/i);
});

test('Spielankündigungen zeigen die Mannschaftskategorie groß im Header', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'announcement',
    match: { ...match, teamCategory: 'JUNIORINNEN' },
  });
  assert.match(svg, /font-size="38" class="handwritten">JUNIORINNEN<\/text>/);
});

test('Heim- und Gastwappen bilden in der Spielankündigung ein diagonales Duell', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'announcement',
    match: { ...match, awayTeam: 'TSV Aach-Linz 2' },
  });
  assert.match(svg, /tsv-aach-linz|data:image\/png;base64,/);
  assert.match(svg, /font-size="44" class="team">BSV Nordstern/);
  assert.match(svg, /x="280" y="175" width="140" height="140"/);
  assert.match(svg, /x="530" y="205" width="140" height="140"/);
  assert.match(svg, /x1="468" y1="194" x2="468" y2="326" transform="rotate\(15 468 260\)" stroke="#111111" stroke-width="6"/);
  assert.doesNotMatch(svg, />GEGEN</);
  assert.doesNotMatch(svg, /DANKE, NORDSTERN-FAMILIE!/);
  assert.doesNotMatch(svg, /resultBallClip/);
});

test('Abgesagte und abgebrochene Spiele erhalten einen roten Querhinweis', async () => {
  for (const [gameStatus, label, size] of [['cancelled', 'ABGESAGT', 160], ['aborted', 'ABGEBROCHEN', 130]]) {
    const svg = await renderStorySvg({
      rootDir,
      type: 'announcement',
      match: { ...match, gameStatus },
    });
    assert.match(svg, new RegExp(`opacity="1"[\\s\\S]*fill="#d62828"[\\s\\S]*font-size="${size}"[\\s\\S]*>${label}<`));
  }
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

for (const type of ['announcement', 'lineup', 'result', 'report']) {
  test(`${type} rendert ein vollständiges Story-SVG`, async () => {
    const svg = await renderStorySvg({
      rootDir,
      type,
      match,
      lineup: { players: [{ number: 1, name: 'M. Test' }] },
    });
    assert.match(svg, new RegExp(`viewBox="0 0 1080 ${type === 'report' ? '1080' : '1920'}"`));
    assert.doesNotMatch(svg, /\{\{[A-Z0-9_]+\}\}/);
    assert.match(svg, /BSV Nordstern &amp; Freunde/);
  });
}

test('Spielbericht ist ein quadratischer Feed-Post mit Wellenfoto, Partie und Ergebnis', async () => {
  const customImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAF';
  const svg = await renderStorySvg({
    rootDir,
    type: 'report',
    match: { ...match, resultMessage: 'Dieser Text gehört ausschließlich in die Caption.', actionPhotoDataUri: customImage },
  });
  assert.match(svg, /width="1080" height="1080" viewBox="0 0 1080 1080"/);
  assert.match(svg, /clipPath id="photoWave"/);
  assert.match(svg, /preserveAspectRatio="xMidYMid slice" clip-path="url\(#photoWave\)"/);
  assert.match(svg, /class="handwritten">SPIELBERICHT<\/text>/);
  assert.match(svg, />3<\/text>/);
  assert.match(svg, />1<\/text>/);
  assert.doesNotMatch(svg, /Dieser Text gehört ausschließlich/);
  assert.match(svg, />SEITE 1 \/ 1<\/text>/);
});

test('zweite Spielbericht-Seite zeigt Torschützen auf dem zweiten Wellenfoto', async () => {
  const customImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAF';
  const svg = await renderStorySvg({
    rootDir,
    type: 'report',
    match: { ...match, reportScorers: '(19., 46.) M. Oosbrugger\n(72.) N. Beispiel' },
    actionPhotoDataUri: customImage,
    reportPage: 2,
    reportPageCount: 4,
    reportPageKind: 'scorers',
  });
  assert.match(svg, /class="handwritten">TORSCHÜTZEN<\/text>/);
  assert.match(svg, /\(19\., 46\.\) M\. Oosbrugger/);
  assert.match(svg, /\(72\.\) N\. Beispiel/);
  assert.match(svg, />SEITE 2 \/ 4<\/text>/);
  assert.match(svg, new RegExp(customImage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('weitere Spielbericht-Seiten bleiben reine Wellen-Fotoseiten', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'report',
    match,
    reportPage: 3,
    reportPageCount: 3,
    reportPageKind: 'photo',
  });
  assert.match(svg, /clipPath id="photoWave"/);
  assert.match(svg, />SEITE 3 \/ 3<\/text>/);
  assert.doesNotMatch(svg, />ENDSTAND<\/text>/);
  assert.doesNotMatch(svg, />TORSCHÜTZEN<\/text>/);
});

test('unabhängiger Beitrag zeigt Zielgruppe, Titel und erstes Wellenfoto', async () => {
  const customImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAF';
  const svg = await renderStorySvg({
    rootDir,
    type: 'post',
    match: { postTitle: 'Saisonabschluss 2026', postAudience: 'U17 · B-Juniorinnen' },
    actionPhotoDataUri: customImage,
    reportPage: 1,
    reportPageCount: 3,
  });
  assert.match(svg, /width="1080" height="1080"/);
  assert.match(svg, /Saisonabschluss 2026/);
  assert.match(svg, /U17 · B-Juniorinnen/);
  assert.match(svg, />SEITE 1 \/ 3</);
  assert.match(svg, /clipPath id="photoWave"/);
});

test('weitere Beitragsbilder werden als reine Wellen-Fotoseite gerendert', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'post',
    match: { postTitle: 'Saisonabschluss 2026', postAudience: 'Jugendabteilung' },
    reportPage: 2,
    reportPageCount: 3,
  });
  assert.match(svg, />SEITE 2 \/ 3</);
  assert.match(svg, /Jugendabteilung/);
  assert.doesNotMatch(svg, /Saisonabschluss 2026/);
});

test('Torschützenzeilen werden escaped und bei fünf Einträgen nach außen ausgerichtet', () => {
  const rows = scorerRows('1. A & B\n2. C\n3. D\n4. E\n5. F');
  assert.match(rows, /A &amp; B/);
  assert.match(rows, /5\. F/);
  assert.match(rows, /x="0"/);
  assert.match(rows, /x="984"[^>]*text-anchor="end"/);
});

test('BSV wird im Spielbericht größer als der Gegner gesetzt', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'report',
    match: { ...match, homeTeam: 'BSV Nordstern Radolfzell', awayTeam: 'VfR Test' },
  });
  assert.match(svg, /font-size="52" class="team">BSV Nordstern Radolfzell<\/text>/);
  assert.match(svg, /font-size="44" class="team">VfR Test<\/text>/);
});

test('Startelf verwendet Matchday-Titel, freien Footer und Fußball in der Gegnerkarte', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'lineup',
    match: { ...match, homeTeam: 'BSV Nordstern Radolfzell', formation: '4 – 4 – 2' },
    lineup: { players: [{ number: 1, name: 'M. Test' }] },
  });
  assert.match(svg, /font-size="132" class="handwritten">MATCHDAY<\/text>/);
  assert.match(svg, /font-size="28" class="caps">EIN TEAM\.<\/text>/);
  assert.match(svg, /font-size="28" class="caps">EIN ZIEL\.<\/text>/);
  assert.match(svg, /<text x="136" y="40"[^>]*font-size="34" class="caps">4 – 4 – 2<\/text>/);
  assert.match(svg, /<text x="72" y="1780"[^>]*>#aufgehtsgrün<\/text>/);
  assert.match(svg, /<text x="1008" y="1780"[^>]*>bsvnordstern\.de<\/text>/);
  assert.match(svg, /<g transform="translate\(842 95\)">[\s\S]*M0-21 20-7/);
  assert.doesNotMatch(svg, /<rect width="260" height="48"/);
  assert.doesNotMatch(svg, /<rect width="410" height="96"/);
  assert.doesNotMatch(svg, /<circle cx="42" cy="42"/);
  assert.match(svg, /<text x="0" y="58" class="number">01<\/text>/);
  assert.match(svg, /<text x="76" y="58" class="player">M\. Test<\/text>/);
  assert.match(svg, /VS\. &lt;VfR Test&gt;<\/text>/);
  assert.match(svg, />HEIMSPIEL<\/text>/);
});

test('Startelf nennt auch auswärts immer den Gegner unten', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'lineup',
    match: { ...match, homeTeam: 'VfR Gastgeber', awayTeam: 'BSV Nordstern Radolfzell' },
    lineup: { players: [{ number: 1, name: 'M. Test' }] },
  });
  assert.match(svg, /font-size="25" class="sans" font-weight="900">BSV Nordstern Radolfzell<\/text>/);
  assert.match(svg, /VS\. VfR Gastgeber<\/text>/);
  assert.doesNotMatch(svg, /VS\. BSV Nordstern Radolfzell/);
  assert.match(svg, />AUSWÄRTSSPIEL<\/text>/);
});

test('Ergebnis übernimmt Capture-It-Titel, freien Endstand und das Wappen-Duell', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'result',
    match: { ...match, awayTeam: 'TSV Aach-Linz 2' },
  });
  assert.match(svg, /font-size="88" class="handwritten">ABPFIFF · ERGEBNIS<\/text>/);
  assert.match(svg, /text-anchor="middle"[^>]*class="handwritten">HEIMSIEG<\/text>/);
  assert.match(svg, /font-size="48" class="handwritten">Testspiel<\/text>/);
  assert.match(svg, /font-size="44" class="handwritten">ENDSTAND<\/text>/);
  assert.match(svg, /<g transform="translate\(148 76\)">/);
  assert.doesNotMatch(svg, /width="236" height="50"/);
  assert.doesNotMatch(svg, /width="640" height="200" rx="100"/);
  assert.match(svg, /x="280" y="356" width="140" height="140"/);
  assert.match(svg, /x="530" y="386" width="140" height="140"/);
  assert.doesNotMatch(svg, />GEGEN</);
  assert.match(svg, /<text x="72" y="1800"[^>]*>#aufgehtsgrün<\/text>/);
});

test('Lange Ergebnis-Untertitel bleiben mittig innerhalb der Seite', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'result',
    match: { ...match, resultLabel: 'Sieg gegen Verbandsligist' },
  });
  assert.match(svg, /text-anchor="middle"[^>]*font-size="60"[^>]*>Sieg gegen Verbandsligist<\/text>/);
});

test('birthday rendert Namen, Glückwunsch und Spielerbild', async () => {
  const svg = await renderStorySvg({
    rootDir,
    type: 'birthday',
    match: {
      birthdayName: 'Max & Freunde',
      birthdayRoles: ['Spieler:in', 'Vereinsmitglied'],
      birthdayMessage: 'Alles Gute vom ganzen Verein!',
    },
  });
  assert.match(svg, /Max &amp; Freunde/);
  assert.match(svg, /Alles Gute vom ganzen Verein!/);
  assert.match(svg, /class="handwritten">Spieler:in<\/text>/);
  assert.doesNotMatch(svg, /Vereinsmitglied/);
  assert.match(svg, /data:image\/png;base64,/);
  assert.doesNotMatch(svg, /\{\{[A-Z0-9_]+\}\}/);
});

test('eine eigene Action-Foto-URL wird im Spielbericht verwendet', async () => {
  const customImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAF';
  const svg = await renderStorySvg({
    rootDir,
    type: 'report',
    match: { ...match, actionPhotoDataUri: customImage },
  });
  assert.match(svg, new RegExp(customImage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Geburtstagsrollen lassen Vereinsmitglied weg und behalten Fachrollen', () => {
  assert.equal(
    birthdayRoleText(['Vereinsmitglied', 'Trainer', 'Co-Trainer', 'Trainer']),
    'Trainer · Co-Trainer',
  );
  assert.equal(birthdayRoleText(['Vereinsmitglied']), '');
});
