export const RECEIPT_BUCKET = 'referee-receipts';
export function decodeRefereeReceipt(value) {
  if (typeof value !== 'string' || value.length > 11200000) throw new Error('Die Quittung darf höchstens 8 MB groß sein.');
  const match = /^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new Error('Bitte ein Foto (JPG, PNG, WebP) oder PDF hochladen.');
  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
  if (!bytes.length || bytes.length > 8388608) throw new Error('Die Quittung darf höchstens 8 MB groß sein.');
  const starts = values => values.every((byte, index) => bytes[index] === byte);
  const valid = match[1] === 'image/jpeg' ? starts([255,216,255]) : match[1] === 'image/png' ? starts([137,80,78,71,13,10,26,10])
    : match[1] === 'application/pdf' ? starts([37,80,68,70,45]) : starts([82,73,70,70]) && [87,69,66,80].every((byte,index) => bytes[index + 8] === byte);
  if (!valid) throw new Error('Der Dateiinhalt passt nicht zum Belegformat.');
  return { bytes, mime: match[1], extension: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[match[1]] };
}
export async function receiptHash(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
export async function encryptTrainerBankDetails(details, personId, secret) {
  let raw;
  try { raw = Uint8Array.from(atob(secret || ''), char => char.charCodeAt(0)); } catch { /* checked below */ }
  if (raw?.length !== 32) throw new Error('Die sichere Kontodatenablage ist noch nicht konfiguriert.');
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(personId) }, key, new TextEncoder().encode(JSON.stringify(details))));
  return 'v1.' + btoa(String.fromCharCode(...iv)) + '.' + btoa(String.fromCharCode(...ciphertext));
}
