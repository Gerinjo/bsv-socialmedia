import test from 'node:test';
import assert from 'node:assert/strict';
import { packAdvertisements } from '../src/stadium-magazine/ad-layout.mjs';
import { FORMATS } from '../src/stadium-magazine/platform-sponsors.mjs';

const ads = sizes => sizes.map((format, index) => ({ id: `partner-${index}`, format }));
function verify(result, expected, pages) {
  const all = [...result.placements, ...result.extraPages];
  assert.deepEqual(all.flat().filter(slot => !slot.repeated).map(slot => slot.ad.id).sort(), expected.map(ad => ad.id).sort());
  assert.equal(all.flat().filter(slot => slot.repeated).length, expected.filter(ad => ad.format === '1/6').length % 2);
  for (let i = 0; i < all.length; i++) {
    const occupied = new Set();
    for (const { ad, frame } of all[i]) {
      const [x, y, right, bottom] = frame;
      const [width, height] = FORMATS[ad.format];
      assert(Math.abs((right - x) * 2 - width) < 1e-8);
      assert(Math.abs((bottom - y) * 6 - height) < 1e-8);
      assert.equal(Math.round(y * 6) % height, 0);
      assert(y * 6 >= (pages[i]?.contentRows || 0) - 1e-8);
      for (let row = Math.round(y * 6); row < Math.round(bottom * 6); row++) for (let col = x * 2; col < right * 2; col++) {
        const key = `${row},${col}`;
        assert(!occupied.has(key), 'Überlappende Anzeigen');
        occupied.add(key);
      }
    }
  }
}

test('thirds use full-width strips, sixths half strips, quarters exact quadrants', () => {
  for (const [format, count] of [['1',1],['1/2',2],['1/3',3],['1/4',4],['1/6',6]]) {
    const items = ads(Array(count).fill(format));
    const result = packAdvertisements(items, []);
    assert.equal(result.extraPages.length, 1);
    verify(result, items, []);
  }
});

test('packing uses free areas below content and minimizes extra pages', () => {
  const items = ads(['1', '1/2', '1/3', '1/6', '1/6', '1/4', '1/4']);
  const pages = [6,4,3,3,4].map(contentRows => ({ contentRows }));
  const result = packAdvertisements(items, pages);
  assert.equal(result.extraPages.length, 1);
  assert.equal(result.placedInContent, 6);
  assert.equal(result.placements[0].length, 0);
  verify(result, items, pages);
  assert.deepEqual(result, packAdvertisements([...items].reverse(), pages));
});

test('layout follows content changes without fixed sponsor positions', () => {
  const items = ads(['1/2', '1/3']);
  const first = packAdvertisements(items, [{contentRows:3},{contentRows:6}]);
  const revised = packAdvertisements(items, [{contentRows:6},{contentRows:3},{contentRows:4}]);
  assert.equal(first.extraPages.length, 1);
  assert.equal(revised.extraPages.length, 0);
  verify(revised, items, [{contentRows:6},{contentRows:3},{contentRows:4}]);
  assert.throws(() => packAdvertisements(ads(['1/8']), []));
  assert.throws(() => packAdvertisements([{id:'x',format:'1'},{id:'x',format:'1'}], []));
});

test('sixth-page ads stay side by side even with quarters and odd inventories', () => {
  for (const count of [1, 2, 3, 4, 5, 6]) {
    const items = ads(['1/4', '1/3', ...Array(count).fill('1/6')]);
    const pages = [2, 3, 4].map(contentRows => ({ contentRows }));
    const result = packAdvertisements(items, pages);
    verify(result, items, pages);
    const strips = [...result.placements, ...result.extraPages].flatMap(slots => {
      const rows = new Map();
      for (const slot of slots.filter(slot => slot.ad.format === '1/6')) {
        const row = slot.frame[1];
        rows.set(row, [...(rows.get(row) || []), slot]);
      }
      return [...rows.values()];
    });
    assert.equal(strips.filter(slots => slots.length === 2).length, Math.ceil(count / 2));
    assert.equal(strips.filter(slots => slots.length === 1).length, 0);
    for (const pair of strips.filter(slots => slots.length === 2)) {
      assert.equal(pair[0].frame[0], 0);
      assert.equal(pair[0].frame[2], pair[1].frame[0]);
      assert.equal(pair[1].frame[2], 1);
      assert.equal(pair[0].frame[3], pair[1].frame[3]);
    }
    assert.equal(result.placedInContent, result.placements.flat().length);
    assert.deepEqual(result, packAdvertisements([...items].reverse(), pages));
  }
});

test('a single free column cannot separate a sixth pair or cover the other table',()=>{
 // Left column ends after row two, right column uses the full page.
 const occupied=Array.from({length:6},(_,r)=>(1<<(2*r+1))|(r<2?1<<(2*r):0)).reduce((a,b)=>a|b,0);
 const layout=packAdvertisements([{id:'small',format:'1/6'}],[{contentRows:6,contentMask:occupied}],{maxAdsPerPage:3});
 assert.equal(layout.extraPages.length,1);assert.equal(layout.placements[0].length,0);
 assert.equal(layout.extraPages[0].length,2);assert.equal(layout.extraPages[0][1].repeated,true);
});

test('paired sixths count individually toward the three-banner page limit',()=>{
 const items=ads(['1/6','1/6','1/6','1/6','1/6','1/3']);
 const result=packAdvertisements(items,[],{maxAdsPerPage:3});
 verify(result,items,[]);
 assert.ok(result.extraPages.every(page=>page.length<=3));
 assert.throws(()=>packAdvertisements(items,[],{maxAdsPerPage:1}),/Paar/);
});
