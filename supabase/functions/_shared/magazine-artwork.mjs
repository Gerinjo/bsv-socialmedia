import { readFile } from 'node:fs/promises';
import { reviewedArtworks } from './sponsor-artwork/catalogue.mjs';

export async function artworkDigest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}

// MCP deployments do not support the CLI's static_patterns. Keep the exact
// reviewed originals available there, pinned to their immutable source commit.
const reviewedAssetBase = 'https://raw.githubusercontent.com/Gerinjo/bsv-socialmedia/cde508dae7fb751d438614a0978f1c203aeb4a0b/supabase/functions/_shared/sponsor-artwork/';
export async function loadReviewedArtwork(artwork, { readLocal = readFile, fetcher = fetch } = {}) {
  let bytes;
  try {
    bytes = new Uint8Array(await readLocal(new URL('./sponsor-artwork/' + artwork.asset, import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT' && error.name !== 'NotFound') throw error;
    const response = await fetcher(reviewedAssetBase + artwork.asset, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Originalmotiv ist vorübergehend nicht verfügbar: ${artwork.id}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (await artworkDigest(bytes) !== artwork.sha256) throw new Error(`Originalmotiv wurde ungeprüft geändert: ${artwork.id}`);
  return bytes;
}

// Match the exact reviewed upload, not just the sponsor. A changed upload wins.
export async function reviewedMagazineArtwork(id, sourceBytes) {
  const sourceSha256 = await artworkDigest(sourceBytes);
  const artwork = reviewedArtworks.find(item => item.id === id && item.sourceSha256 === sourceSha256);
  if (!artwork) return null;
  const bytes = await loadReviewedArtwork(artwork);
  return { ...artwork, bytes };
}
