import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reviewedMagazineArtwork, loadReviewedArtwork, artworkDigest } from '../supabase/functions/_shared/magazine-artwork.mjs';
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

test('a deployment without static originals loads only the pinned and verified asset', async () => {
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const artwork = { id: 'test', asset: 'test.svg', sha256: await artworkDigest(bytes) };
  const readLocal = async () => { throw Object.assign(new Error('Missing asset'), { code: 'ENOENT' }); };
  const fetcher = async url => {
    assert.equal(url, 'https://raw.githubusercontent.com/Gerinjo/bsv-socialmedia/cde508dae7fb751d438614a0978f1c203aeb4a0b/supabase/functions/_shared/sponsor-artwork/test.svg');
    return new Response(bytes);
  };
  assert.deepEqual(await loadReviewedArtwork(artwork, { readLocal, fetcher }), bytes);
  await assert.rejects(loadReviewedArtwork(artwork, { readLocal, fetcher: async () => new Response('changed') }), /ungeprüft geändert/);
  await assert.rejects(loadReviewedArtwork(artwork, { readLocal, fetcher: async () => new Response('', { status: 503 }) }), /vorübergehend nicht verfügbar/);
  await assert.rejects(loadReviewedArtwork(artwork, { readLocal: async () => { throw Object.assign(new Error('Access denied'), { code: 'EACCES' }); }, fetcher: async () => assert.fail('Do not mask permission failures.') }), /Access denied/);
});
