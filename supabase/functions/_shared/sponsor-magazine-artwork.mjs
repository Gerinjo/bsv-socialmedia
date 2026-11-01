import { prepareSvgSource } from '../../../src/svg-upload.mjs';

const formats = new Map([['image/png','png'],['image/jpeg','jpg'],['image/webp','webp'],['image/svg+xml','svg']]);
const digitalFields = ['logo_original_path','logo_transparent_path','logo_white_path'];
const magazineFields = ['magazine_ad_original_path','magazine_ad_path'];

export function sponsorArtworkPaths(sponsor, channel) {
  const fields = channel === 'magazine' ? magazineFields : channel === 'digital' ? digitalFields : [...digitalFields, ...magazineFields];
  const protectedFields = channel === 'magazine' ? digitalFields : channel === 'digital' ? magazineFields : [];
  const retained = new Set(protectedFields.map(key => sponsor[key]).filter(Boolean));
  return [...new Set(fields.map(key => sponsor[key]).filter(path => typeof path === 'string' && path.startsWith('sponsors/') && !retained.has(path)))];
}

export function magazineArtworkSource(sponsor) {
  if (sponsor.magazine_ad_path) return sponsor.magazine_ad_status === 'approved' ? sponsor.magazine_ad_path : null;
  return sponsor.logo_status === 'approved' ? sponsor.logo_transparent_path || null : null;
}

export function magazinePngDimensions(bytes) {
  if (bytes.length < 33 || bytes.slice(0,8).join(',') !== '137,80,78,71,13,10,26,10' || new TextDecoder().decode(bytes.slice(12,16)) !== 'IHDR') throw new Error('Die Heftanzeige muss als gültiges PNG vorbereitet werden.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 20000000) throw new Error('Die Heftanzeige darf höchstens 20 Megapixel und 8192 Pixel pro Seite haben.');
  return { width, height };
}

export async function handleSponsorMagazineArtwork({ action, body, admin, userId, parseDataUrl, DOMParser, XMLSerializer }) {
  if (!['save_sponsor_magazine_ad','approve_sponsor_magazine_ad','reject_sponsor_magazine_ad','discard_sponsor_magazine_ad'].includes(action)) return null;
  const sponsorId = String(body.sponsorId || '').trim();
  if (!sponsorId) throw new Error('Werbepartner fehlt.');
  const { data: sponsor, error } = await admin.from('social_sponsors').select('*').eq('id',sponsorId).maybeSingle();
  if (error) throw error;
  if (!sponsor) throw new Error('Der Werbepartner wurde nicht gefunden.');
  const storage = admin.storage.from('social-story-previews');
  let patch;
  let created = [];
  if (action === 'save_sponsor_magazine_ad') {
    const original = parseDataUrl(body.originalDataUrl, new Set(formats.keys()), 5 * 1024 * 1024);
    if (original.mime === 'image/svg+xml') {
      const source = new TextDecoder('utf-8',{fatal:true}).decode(original.bytes);
      original.bytes = new TextEncoder().encode(prepareSvgSource(source, new DOMParser({onError:()=>{throw new Error('Ungültiges SVG');}}), new XMLSerializer()));
    }
    const image = parseDataUrl(body.imageDataUrl, new Set(['image/png']), 5 * 1024 * 1024);
    const dimensions = magazinePngDimensions(image.bytes);
    const revision = `sponsors/${sponsor.slug}/magazine/${crypto.randomUUID()}`;
    const originalPath = `${revision}/original.${formats.get(original.mime)}`;
    const imagePath = `${revision}/advertisement.png`;
    created = [originalPath,imagePath];
    try {
      for (const [path, bytes, contentType] of [[originalPath,original.bytes,original.mime],[imagePath,image.bytes,'image/png']]) {
        const { error } = await storage.upload(path,bytes,{contentType,cacheControl:'604800',upsert:false});
        if (error) throw new Error('Heftanzeige konnte nicht hochgeladen werden: '+error.message);
      }
    } catch (error) { await storage.remove(created); throw error; }
    patch = { magazine_ad_original_path:originalPath, magazine_ad_path:imagePath, magazine_ad_status:'needs_review',
      magazine_ad_metadata:{...dimensions,fileName:String(body.fileName || '').slice(0,200),reviewed:false,uploadedBy:userId} };
  } else if (action === 'discard_sponsor_magazine_ad') {
    // Clear the record before storage cleanup; shared digital files survive.
    patch = {magazine_ad_original_path:null,magazine_ad_path:null,magazine_ad_status:'missing',magazine_ad_metadata:{}};
  } else {
    if (!sponsor.magazine_ad_path) throw new Error('Bitte zuerst eine Heftanzeige hochladen.');
    patch = {magazine_ad_status:action==='approve_sponsor_magazine_ad'?'approved':'rejected',
      magazine_ad_metadata:{...sponsor.magazine_ad_metadata,reviewed:true,reviewedAt:new Date().toISOString(),reviewedBy:userId}};
  }
  const {data, error: saveError} = await admin.from('social_sponsors').update(patch).eq('id',sponsorId).select().single();
  if (saveError) { if(created.length) await storage.remove(created); throw new Error(saveError.message); }
  if (action === 'discard_sponsor_magazine_ad') {
    const paths = sponsorArtworkPaths(sponsor,'magazine');
    if (paths.length) await storage.remove(paths);
  }
  return {ok:true,sponsor:data};
}
