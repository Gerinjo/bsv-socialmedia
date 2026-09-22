import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {previewSports} from '../admin-site/preview/sports.mjs';
import {editorialSportsBody} from '../src/editorial-sports-format.mjs';
const source=readFileSync(new URL('../admin-site/stadium-reader/app.js',import.meta.url),'utf8');
const ownTeam=runInNewContext(`(${source.slice(source.indexOf('function editorialOwnTeam('),source.indexOf('function editorialSportsMarkup('))})`);

test('own rows resolve across adult and youth tables, including all SG names',()=>{
 const expected=['BSV Nordstern Radolfzell','SG Markelfingen/BSV N. Radolfz. 2','SG No. Radolfz./Öhning.-Gai./Bankh.-Moos','SG No. Radolfz./Öhning.-Gai./Bankh.-Moos 2','SG Markelfingen','SG BSV Nordstern Radolfzell','BSV Nordstern Radolfzell','BSV Nordstern Radolfzell 2 (9er)','BSV Nordstern Radolfzell','BSV Nordstern Radolfzell 2',null,'BSV Nordstern Radolfzell (9er)','BSV Nordstern Radolfzell (9er)','BSV Nordstern Radolfzell'];
 previewSports.forEach(({team,snapshot},index)=>assert.equal(ownTeam(editorialSportsBody(team,snapshot)),expected[index],team.slug));
});
test('table-only fallback distinguishes reserve teams and never selects an ambiguous opponent',()=>{
 const table='TABELLE\nPlatz | Mannschaft | Punkte\n1 | BSV Nordstern Radolfzell | 12\n2 | BSV Nordstern Radolfzell 2 (9er) | 9';
 assert.equal(ownTeam('SPORT KOMPAKT · BSV Nordstern Radolfzell · U15 C2-Junioren\n\n'+table),'BSV Nordstern Radolfzell 2 (9er)');
 assert.equal(ownTeam('BSV Nordstern Radolfzell\n\n'+table),'BSV Nordstern Radolfzell');
 assert.equal(ownTeam('Unbekannt\n\n'+table+'\n\nLETZTE PARTIE\nDatum | Uhrzeit | Begegnung | Ergebnis\n20.09.2026 | 15:00 | BSV Nordstern Radolfzell – Gast | 2:0'),null);
 assert.equal(ownTeam('SPORT KOMPAKT · Jugend\n\nTABELLE\nKeine Verbandstabelle verfügbar.'),null);
});
