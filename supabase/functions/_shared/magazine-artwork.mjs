import { readFile } from 'node:fs/promises';
import { reviewedArtworks } from './sponsor-artwork/catalogue.mjs';

export async function artworkDigest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}

// Match the exact reviewed upload, not just the sponsor. A changed upload wins.
export async function reviewedMagazineArtwork(id, sourceBytes) {
  const sourceSha256 = await artworkDigest(sourceBytes);
  const artwork = reviewedArtworks.find(item => item.id === id && item.sourceSha256 === sourceSha256);
  if (!artwork) return null;
  const bytes = new Uint8Array(await readFile(new URL('./sponsor-artwork/' + artwork.asset, import.meta.url)));
  if (await artworkDigest(bytes) !== artwork.sha256) throw new Error(`Originalmotiv wurde ungeprüft geändert: ${id}`);
  return { ...artwork, bytes };
}
