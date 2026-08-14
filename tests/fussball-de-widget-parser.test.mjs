import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeWidgetText, extractWidgetPageProps, parseGermanKickoff, parseNextMatches } from '../supabase/functions/_shared/fussball-de-widget-parser.mjs';

const glyphs = new Map([
  ['\ue001', 'S'], ['\ue002', 'V'], ['\ue003', 'space'], ['\ue004', 'M'],
  ['\ue005', 'a'], ['\ue006', 'r'], ['\ue007', 'k'], ['\ue008', 'e'], ['\ue009', 'l'],
  ['\ue00a', 'f'], ['\ue00b', 'i'], ['\ue00c', 'n'], ['\ue00d', 'g'], ['\ue00e', 'comma'],
  ['\ue00f', 'two'], ['\ue010', 'three'], ['\ue011', 'period'], ['\ue012', 'zero'],
  ['\ue013', 'eight'], ['\ue014', 'six'], ['\ue015', 'one'], ['\ue016', 'colon'],
  ['\ue017', 'five'], ['\ue018', 'B'], ['\ue019', 'N'], ['\ue01a', 'o'],
  ['\ue01b', 'd'], ['\ue01c', 's'], ['\ue01d', 't'], ['\ue01e', 'R'],
  ['\ue01f', 'z'], ['\ue020', 'K'], ['\ue021', 'b'], ['\ue022', 'A'],
]);
const resolve = (character) => glyphs.get(character);

test('decodes obfuscated glyph names and removes invisible separators', () => {
  assert.equal(decodeWidgetText('\ue001\ue002\ue003\ue004\ue005\ue006\ue007\ue008\ue009\ue00a\ue00b\ue00c\ue00d\ue008\ue00c', resolve), 'SV Markelfingen');
});

test('extracts the Next.js widget payload', () => {
  const props = extractWidgetPageProps('<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"nextMatches":[]}}}</script>');
  assert.deepEqual(props.nextMatches, []);
});

test('converts German summer and winter kickoffs to UTC', () => {
  assert.equal(parseGermanKickoff('Sonntag, 23.08.2026', '16:30'), '2026-08-23T14:30:00.000Z');
  assert.equal(parseGermanKickoff('Donnerstag, 31.12.2026', '12:11'), '2026-12-31T11:11:00.000Z');
});

test('maps a widget match to the import model', () => {
  const props = {
    competitionName: '',
    nextMatches: [{
      id: 'MATCH-1', status: 'scheduled',
      kickoff: { dateWithWeekday: '\ue004\ue00a, 23.08.2026', time: '16:30' },
      competitionName: 'Kreisliga',
      homeTeam: { name: 'BSV Nordstern Radolfzell', teamPermanentId: 'BSV-ID', clubId: 'BSV-CLUB' },
      guestTeam: { name: 'SV Markelfingen', teamPermanentId: 'SV-ID', clubId: 'SV-CLUB' },
    }],
  };
  const [match] = parseNextMatches(props, resolve);
  assert.equal(match.sourceMatchId, 'MATCH-1');
  assert.equal(match.homeTeam.teamPermanentId, 'BSV-ID');
  assert.equal(match.awayTeam.name, 'SV Markelfingen');
  assert.equal(match.kickoffAt, '2026-08-23T14:30:00.000Z');
});
