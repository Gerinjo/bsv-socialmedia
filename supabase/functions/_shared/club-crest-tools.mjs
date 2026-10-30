const maxCrestBytes = 5 * 1024 * 1024;
function publicAddress(address) {
  const value = address.toLowerCase();
  if (value.includes(':')) return /^2[0-9a-f]{3}:/i.test(value) && !/^2001:(?:0*0:|0*2:|0*10:|0*db8:)/i.test(value);
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a,b] = parts;
  return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && [0,168].includes(b)) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && [18,19,51].includes(b)) && !(a === 203 && b === 0);
}
export function crestSourceImageUrl(value) {
  let url;
  try {url = new URL(String(value || ''));} catch {throw new Error('Bitte einen gültigen Bildlink eingeben.');}
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2048 || !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname) || url.hostname.endsWith('.') || /[\[\]:]/.test(url.hostname)) throw new Error('Bitte einen öffentlichen HTTPS-Bildlink verwenden.');
  if (/^[0-9.]+$/.test(url.hostname) && !publicAddress(url.hostname)) throw new Error('Diese Bildadresse ist nicht öffentlich.');
  if (['www.fussball.de','fussball.de'].includes(url.hostname) && url.pathname.startsWith('/verein/')) {
    const id = url.pathname.match(/\/id\/([A-Z0-9]{32})(?:\/|$)/i)?.[1];
    if (id) url = new URL('https://www.fussball.de/export.media/-/action/getLogo/id/'+id);
  }
  return url;
}
export async function fetchClubCrestImage(value, {fetcher = fetch, resolveDns = (hostname, type) => globalThis.Deno.resolveDns(hostname,type)} = {}) {
  let url = crestSourceImageUrl(value);
  const visited = new Set();
  const signal = AbortSignal.timeout(15000);
  for(let hop = 0; hop <= 3; hop++) {
    if (visited.has(url.href)) throw new Error('Die Bildadresse enthält eine Weiterleitungsschleife.');
    visited.add(url.href);
    // The official fixed hosts work even in runtimes without a DNS API.
    const official = ['www.fussball.de','fussball.de','bsvnordstern.de','www.bsvnordstern.de','gerinjo.github.io'].includes(url.hostname);
    if (!official) {
      const results = await Promise.allSettled(['A','AAAA'].map(type => resolveDns(url.hostname,type)));
      const addresses = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      if (!addresses.length || addresses.some(address => !publicAddress(address))) throw new Error('Der Bildlink muss auf einen öffentlich erreichbaren Server zeigen.');
    }
    const response = await fetcher(url,{redirect:'manual',signal,headers:{accept:'image/png,image/jpeg,image/webp,image/svg+xml'}});
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');await response.body?.cancel();
      if (!location) throw new Error('Die Bildweiterleitung enthält keine Zieladresse.');
      url = crestSourceImageUrl(new URL(location,url).href);continue;
    }
    if (!response.ok) {await response.body?.cancel();throw new Error(`Das Wappen konnte nicht geladen werden (HTTP ${response.status}).`);}
    if (Number(response.headers.get('content-length')) > maxCrestBytes) {await response.body?.cancel();throw new Error('Die Bilddatei darf höchstens 5 MB groß sein.');}
    const chunks = [];let size = 0;const reader = response.body?.getReader();
    if (!reader) throw new Error('Der Bildlink liefert keine Bilddatei.');
    try {while (true) {const {done,value:chunk} = await reader.read();if(done)break;size += chunk.length;if(size > maxCrestBytes) throw new Error('Die Bilddatei darf höchstens 5 MB groß sein.');chunks.push(chunk);}} finally {await reader.cancel();}
    const bytes = new Uint8Array(size);let offset = 0;for(const chunk of chunks){bytes.set(chunk,offset);offset += chunk.length;}
    let mime;
    if (size >= 24 && bytes.slice(0,8).join(',') === '137,80,78,71,13,10,26,10') mime='image/png';
    else if (size >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime='image/jpeg';
    else if (size >= 12 && new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP') mime='image/webp';
    else if (size && /^(?:\uFEFF)?\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(new TextDecoder().decode(bytes.slice(0,4096)))) mime='image/svg+xml';
    if (!mime) throw new Error('Der Link liefert kein unterstütztes Bild. Bitte einen direkten Link zu PNG, JPG, WebP oder SVG verwenden.');
    let binary = '';for(let i=0;i<size;i+=8192)binary += String.fromCharCode(...bytes.subarray(i,i+8192));
    return {dataUrl:`data:${mime};base64,${btoa(binary)}`,mime,sourceUrl:url.href};
  }
  throw new Error('Der Bildlink enthält zu viele Weiterleitungen.');
}
async function clubRow(db,id) {
  if (typeof id !== 'string' || !id) throw new Error('Bitte einen Verein auswählen.');
  const {data,error} = await db.from('social_clubs').select('*').eq('id',id).maybeSingle();
  if (error) throw error;if (!data) throw new Error('Der Verein wurde nicht gefunden.');return data;
}
export async function handleClubCrestTools(db,actor,payload,{fetchImage = fetchClubCrestImage,uuid = () => crypto.randomUUID()} = {}) {
  const target = await clubRow(db,payload.clubId);
  if (payload.action === 'fetch_club_crest_source') return {image:await fetchImage(payload.sourceUrl || target.crest_source_url)};
  if (payload.action !== 'reuse_club_crest') throw new Error('Unbekannte Wappen-Aktion.');
  if (payload.sourceClubId === target.id) throw new Error('Bitte einen anderen Verein auswählen.');
  const source = await clubRow(db,payload.sourceClubId);
  if (!['approved','needs_review'].includes(source.crest_status) || !source.crest_original_path || !source.crest_transparent_path) throw new Error('Für diesen Verein stehen kein verwendbares Original und transparentes Wappen bereit.');
  const extension = source.crest_original_path.match(/\.(png|jpe?g|webp|svg)$/i)?.[1]?.toLowerCase();
  if (!extension) throw new Error('Das Originalformat konnte nicht erkannt werden.');
  const base = `club-crests/${target.slug}/${uuid()}`;
  const originalPath = `${base}/original.${extension}`, transparentPath = `${base}/transparent.png`;
  const created=[];
  try {
    for(const [from,to] of [[source.crest_original_path,originalPath],[source.crest_transparent_path,transparentPath]]) {
      const {error} = await db.storage.from('social-story-previews').copy(from,to);
      if (error) throw new Error(`Das Wappen von ${source.name} konnte nicht kopiert werden.`);created.push(to);
    }
    const update = {crest_original_path:originalPath,crest_transparent_path:transparentPath,crest_source_url:source.crest_source_url,crest_status:source.crest_status,transparency_confidence:source.transparency_confidence,last_checked_at:new Date().toISOString(),transparency_metadata:{...source.transparency_metadata,method:'club-crest-copy',copiedFromClubId:source.id,copiedFromClubName:source.name,copiedAt:new Date().toISOString(),copiedBy:actor}};
    const {data,error} = await db.from('social_clubs').update(update).eq('id',target.id).eq('updated_at',target.updated_at).select().maybeSingle();
    if (error) throw error;if (!data) throw new Error('Das Wappen wurde zwischenzeitlich geändert. Bitte neu laden.');
    return {club:data};
  } catch(error) {if(created.length)await db.storage.from('social-story-previews').remove(created);throw error;}
}
