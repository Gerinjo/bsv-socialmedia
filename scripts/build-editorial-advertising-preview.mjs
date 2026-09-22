import { readFile, writeFile } from 'node:fs/promises';
import { previewAdvertising } from '../admin-site/preview/sponsors.mjs';
import { reviewedMagazineArtwork } from '../supabase/functions/_shared/magazine-artwork.mjs';

for (const ad of previewAdvertising.ads) {
  const sourceAsset = ad.sourceAsset || ad.asset;
  if (!/^\/preview-sponsors\/[a-z0-9-]+\.png$/.test(sourceAsset)) throw new Error('Invalid preview source');
  const bytes = await readFile(new URL('../admin-site/preview/sponsors/' + sourceAsset.split('/').pop(), import.meta.url));
  const original = await reviewedMagazineArtwork(ad.id, bytes);
  ad.asset = original ? '/preview-artwork/' + original.asset : sourceAsset;
  if (original) {
    ad.sourceAsset = sourceAsset;
    ad.width = original.width;
    ad.height = original.height;
  }
}
await writeFile(new URL('../admin-site/preview/sponsors.mjs', import.meta.url),
  '// Local demonstration only: approved inventory saved by bsv-stadionheft for 12 September 2026.\n' +
  '// Reviewed SVG originals resolved by scripts/build-editorial-advertising-preview.mjs.\n' +
  'export const previewAdvertising = ' + JSON.stringify(previewAdvertising, null, 2) + ';\n');
