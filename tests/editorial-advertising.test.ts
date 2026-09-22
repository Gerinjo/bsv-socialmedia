import assert from 'node:assert/strict';
import { prepareEditorialAdvertising, withEditorialAdvertising } from '../supabase/functions/_shared/editorial-advertising.ts';
import { loadMagazineSponsors } from '../supabase/functions/_shared/magazine-sponsors.ts';
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII='), c => c.charCodeAt(0));
function database({ format = '1/2', failUpload = false, source = png, slug = 'partner' } = {}) {
  const calls: any[] = [], uploads: any[] = [], removed: any[] = [];
  const replies: any = {
    social_sponsor_types: { id: 'type' },
    social_sponsor_website_assignments: [{ sponsor_id: 'sponsor', audience_id: 'audience', page_size: format }],
    social_post_audiences: [{ id: 'audience', slug: 'club' }],
    social_sponsors: [{ id: 'sponsor', slug, name: 'Partner', website_url: 'https://example.org', logo_transparent_path: 'sponsors/approved.png', updated_at: '2026-09-20' }],
  };
  const db = { from(table: string) {
    const query: any = new Proxy({}, { get(_target, key) {
      if (key === 'then') return (resolve: any) => resolve({ data: replies[table], error: null });
      return (...args: any[]) => { calls.push([table, key, ...args]); return query; };
    } }); return query;
  }, storage: { from(bucket: string) { return {
    download: async () => ({ data: new Blob([source]), error: null }),
    upload: async (path: string, bytes: Uint8Array, options: any) => { uploads.push({ bucket, path, bytes, options }); return { error: failUpload ? new Error('Storage failed') : null }; },
    remove: async (paths: string[]) => { removed.push(...paths); return { error: null }; },
    createSignedUrl: async (path: string) => ({ data: { signedUrl: 'https://example.org/' + path }, error: null }),
  }; } } };
  return { db, calls, uploads, removed };
}
Deno.test('preview and feed select active approved magazine assignments valid on the issue date', async () => {
  const { db, calls } = database();
  const result = await loadMagazineSponsors(db, '2026-09-27');
  assert.equal(result.length, 1);
  assert.ok(calls.some(call => call[1] === 'eq' && call[2] === 'active' && call[3] === true));
  assert.ok(calls.some(call => call[1] === 'eq' && call[2] === 'logo_status' && call[3] === 'approved'));
  assert.ok(calls.some(call => call[1] === 'or' && call[2].includes('contract_end_date.gte.2026-09-27')));
  assert.ok(calls.some(call => call[1] === 'or' && call[2].includes('contract_start_date.lte.2026-09-27')));
});
Deno.test('advertising copies approved bytes and freezes only public advertisement fields', async () => {
  const { db, uploads, removed } = database();
  const { snapshot, cleanup } = await prepareEditorialAdvertising(db, { id: 'issue', publishes_on: '2026-09-27' });
  assert.equal(snapshot.ads.length, 1);
  assert.deepEqual(uploads[0].bytes, png);
  assert.equal(uploads[0].bucket, 'editorial-advertisements');
  assert.equal(snapshot.ads[0].width, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /sourcePath|assignments|contract|approved.png/);
  const publicSnapshot = await withEditorialAdvertising(db, { advertising: snapshot });
  assert.doesNotMatch(JSON.stringify(publicSnapshot), /asset_path|sha256/);
  assert.match(publicSnapshot.advertising.ads[0].asset, /^https:/);
  await cleanup();
  assert.equal(removed.length, 1);
});
Deno.test('unchanged artwork is reused without another upload or deleting retained images', async () => {
  const { db, uploads, removed } = database();
  const first = await prepareEditorialAdvertising(db, { id: 'issue', publishes_on: '2026-09-27' });
  const second = await prepareEditorialAdvertising(db, { id: 'issue', publishes_on: '2026-09-27', advertising: first.snapshot });
  assert.equal(uploads.length, 1);
  assert.equal(second.snapshot.ads[0].asset_path, first.snapshot.ads[0].asset_path);
  await second.cleanup();
  assert.equal(removed.length, 0);
});
Deno.test('invalid formats or failed uploads fail the preview rather than silently dropping sponsors', async () => {
  const invalid = database({ format: '1/8' });
  await assert.rejects(prepareEditorialAdvertising(invalid.db, { id: 'issue', publishes_on: '2026-09-27' }), /Zuordnungen/);
  assert.equal(invalid.uploads.length, 0);
  const failed = database({ failUpload: true });
  await assert.rejects(prepareEditorialAdvertising(failed.db, { id: 'issue', publishes_on: '2026-09-27' }), /Storage failed/);
});
Deno.test('Koschnik freezes the exact reviewed vector original; a new upload retains its own bytes', async () => {
  const source = await Deno.readFile(new URL('../admin-site/preview/sponsors/firma-koschnik-87430369c787.png', import.meta.url));
  const { db, uploads } = database({ slug: 'firma-koschnik', source });
  const first = await prepareEditorialAdvertising(db, { id: 'issue', publishes_on: '2026-09-27' });
  assert.equal(uploads[0].options.contentType, 'image/svg+xml');
  assert.match(first.snapshot.ads[0].asset_path, /\.svg$/);
  assert.equal(first.snapshot.ads[0].width, 595.276);
  assert.match(new TextDecoder().decode(uploads[0].bytes), /^<svg/);
  const second = await prepareEditorialAdvertising(db, { id: 'issue', publishes_on: '2026-09-27', advertising: first.snapshot });
  assert.equal(uploads.length, 1);
  assert.equal(first.snapshot.ads[0].asset_path, second.snapshot.ads[0].asset_path);
  const changed = database({ slug: 'firma-koschnik', source: png });
  const next = await prepareEditorialAdvertising(changed.db, { id: 'issue', publishes_on: '2026-09-27', advertising: first.snapshot });
  assert.equal(changed.uploads[0].options.contentType, 'image/png');
  assert.deepEqual(changed.uploads[0].bytes, png);
  assert.notEqual(next.snapshot.ads[0].asset_path, first.snapshot.ads[0].asset_path);
});
