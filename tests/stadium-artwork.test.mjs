import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reviewedMagazineArtwork } from '../supabase/functions/_shared/magazine-artwork.mjs';
import { previewAdvertising } from '../admin-site/preview/sponsors.mjs';
import { DOMParser } from '@xmldom/xmldom';

test('all 26 reviewed originals match their exact source and remain safe standalone image assets', async () => {
  let originals = 0;
  for (const ad of previewAdvertising.ads) {
    const source = ad.sourceAsset || ad.asset;
    const bytes = await readFile(new URL('../admin-site/preview/sponsors/' + source.split('/').pop(), import.meta.url));
    const original = await reviewedMagazineArtwork(ad.id, bytes);
    if (!original) { assert.equal(ad.asset, source); continue; }
    originals++;
    assert.equal(ad.asset, '/preview-artwork/' + original.asset);
    assert.equal(ad.width, original.width);
    const svg = new TextDecoder().decode(original.bytes);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    assert.equal(doc.documentElement.localName, 'svg');
    for (const node of Array.from(doc.getElementsByTagName('*'))) {
      assert.ok(!['script', 'foreignObject', 'iframe', 'animate', 'set'].includes(node.localName));
      for (const attr of Array.from(node.attributes)) {
        assert.ok(!/^on/i.test(attr.name));
        if (attr.localName === 'href') assert.match(attr.value, /^(#|data:image\/(png|jpeg);base64,)/);
      }
    }
  }
  assert.equal(originals, 26);
});

test('a changed upload or different sponsor never receives an older original', async () => {
  const bytes = await readFile(new URL('../admin-site/preview/sponsors/firma-koschnik-87430369c787.png', import.meta.url));
  assert.equal(await reviewedMagazineArtwork('unknown', bytes), null);
  bytes[bytes.length - 1] ^= 1;
  assert.equal(await reviewedMagazineArtwork('firma-koschnik', bytes), null);
});
