import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMagazineSponsors } from '../src/stadium-magazine/platform-sponsors.mjs';

const sponsor = (slug, assignments, extra = {}) => ({ id: slug, slug, name: slug, imageUrl: 'https://example.com/motif.png', assignments, ...extra });
const assignment = (pageSize, type = 'stadionheft') => ({ type, pageSize, audienceSlug: 'gesamtverein' });
const feed = sponsors => ({ version: 1, type: 'stadionheft', sponsors });

test('only the explicit type qualifies, names and other sponsor types do not', () => {
  const result = selectMagazineSponsors(feed([
    sponsor('stadionheft-im-namen', [assignment('1/2','teamsponsor')]),
    sponsor('ohne-typ', []), sponsor('partner', [assignment('1/6')]),
  ]));
  assert.deepEqual(result.ads.map(ad => ad.id), ['partner']);
});

test('same-size audience assignments appear once, conflicts and missing assets are reported', () => {
  const result = selectMagazineSponsors(feed([
    sponsor('einmal', [assignment('1/3'), {...assignment('1/3'), audienceSlug:'jugendabteilung'}]),
    sponsor('konflikt', [assignment('1/2'),assignment('1/4')]),
    sponsor('format-fehlt', [assignment(null)]),
    sponsor('bild-fehlt', [assignment('1')], {imageUrl:null}),
  ]));
  assert.equal(result.ads.length,1);
  assert.equal(result.ads[0].audiences.length,2);
  assert.equal(result.missing.length,3);
});

test('invalid responses fail instead of silently clearing all advertisements', () => {
  assert.throws(() => selectMagazineSponsors({error:'unavailable'}));
  assert.throws(() => selectMagazineSponsors(feed([sponsor('../invalid',[assignment('1')])])));
  const duplicate=sponsor('duplicate',[assignment('1')]);
  assert.throws(() => selectMagazineSponsors(feed([duplicate,duplicate])));
  assert.deepEqual(selectMagazineSponsors(feed([])), {ads:[],missing:[]});
});

