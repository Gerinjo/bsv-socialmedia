import { loadMagazineSponsors } from './magazine-sponsors.ts';
import { selectMagazineSponsors } from '../../../src/stadium-magazine/platform-sponsors.mjs';
import { artworkDigest, reviewedMagazineArtwork } from './magazine-artwork.mjs';

const bucket = 'editorial-advertisements';

export async function prepareEditorialAdvertising(db: any, issue: any) {
  const sponsors = await loadMagazineSponsors(db, issue.publishes_on);
  const { ads, missing } = selectMagazineSponsors({ version: 1, type: 'stadionheft', sponsors: sponsors.map((sponsor: any) => ({ ...sponsor, imageUrl: sponsor.sourcePath })) });
  if (missing.length) throw new Error('Bitte die Stadionheft-Zuordnungen prüfen: ' + missing.map((item: any) => `${item.name}: ${item.reason}`).join('; '));
  const created: string[] = [];
  const frozen: any[] = [];
  try {
    // Sequential uploads bound memory and guarantee cleanup after any failure.
    for (const ad of ads) {
      const { data: file, error } = await db.storage.from('social-story-previews').download(ad.imageUrl);
      if (error || !file) throw new Error(`Das Anzeigenmotiv von ${ad.name} konnte nicht geladen werden.`);
      let bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length < 24 || bytes.length > 25 * 1024 * 1024 || bytes.slice(0, 8).join(',') !== '137,80,78,71,13,10,26,10') throw new Error(`Ungültiges PNG-Anzeigenmotiv: ${ad.name}`);
      const dimensions = new DataView(bytes.buffer);
      let width = dimensions.getUint32(16), height = dimensions.getUint32(20);
      if (!width || !height) throw new Error(`Leeres Anzeigenmotiv: ${ad.name}`);
      const original = await reviewedMagazineArtwork(ad.id, bytes);
      if (original) { bytes = original.bytes; width = original.width; height = original.height; }
      const contentType = original ? 'image/svg+xml' : 'image/png';
      const digest = original?.sha256 || await artworkDigest(bytes);
      const previous = issue.advertising?.ads?.find((item: any) => item.sha256 === digest);
      const asset_path = previous?.asset_path || `${issue.id}/${crypto.randomUUID()}.${original ? 'svg' : 'png'}`;
      if (!previous) {
        const { error: uploadError } = await db.storage.from(bucket).upload(asset_path, bytes, { contentType, upsert: false });
        if (uploadError) throw uploadError;
        created.push(asset_path);
      }
      frozen.push({ id: ad.id, name: ad.name, format: ad.format, websiteUrl: ad.websiteUrl, width, height, asset_path, sha256: digest });
    }
    return { snapshot: { issueDate: issue.publishes_on, fetchedAt: new Date().toISOString(), ads: frozen }, cleanup: async () => { if (created.length) await db.storage.from(bucket).remove(created); } };
  } catch (error) {
    if (created.length) await db.storage.from(bucket).remove(created);
    throw error;
  }
}

export async function withEditorialAdvertising(db: any, snapshot: any) {
  if (!snapshot.advertising) return snapshot;
  const ads = await Promise.all(snapshot.advertising.ads.map(async ({ asset_path, sha256: _hash, ...ad }: any) => {
    const { data, error } = await db.storage.from(bucket).createSignedUrl(asset_path, 3600);
    if (error || !data?.signedUrl) throw new Error(`Anzeigenmotiv vorübergehend nicht verfügbar: ${ad.name}`);
    return { ...ad, asset: data.signedUrl };
  }));
  return { ...snapshot, advertising: { ...snapshot.advertising, ads } };
}
