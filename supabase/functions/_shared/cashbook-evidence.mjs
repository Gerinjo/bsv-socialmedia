import { CASHBOOK_BUCKET, cashbookUuid, validateCashbookBooking, validateCashbookChange } from '../../../src/cashbook.mjs';
import { decodeRefereeReceipt, receiptHash } from './referee-receipts.mjs';

export async function cashbookRpc(db, actor, payload) {
  const result = await db.rpc('cashbook_request', { actor, payload });
  if (result.error) throw Object.assign(new Error('Das Kassenbuch ist vorübergehend nicht verfügbar. Bitte dieselbe Buchung erneut senden.'),{status:503});
  if (!result.data || result.data.error) {
    const error = new Error(result.data?.error || 'Das Kassenbuch ist nicht verfügbar.');
    error.status = result.data?.status || 503;
    throw error;
  }
  return result.data;
}
function photo(value, signature = false) {
  const decoded = decodeRefereeReceipt(value);
  if (!decoded.mime.startsWith('image/')) throw new Error('Bitte ein Belegfoto (JPG, PNG oder WebP) auswählen.');
  if (signature && (decoded.mime !== 'image/png' || decoded.bytes.length < 80 || decoded.bytes.length > 262144)) throw new Error('Bitte auf dem Unterschriftsfeld unterschreiben.');
  return decoded;
}
async function upload(db, prefix, label, decoded) {
  const hash = await receiptHash(decoded.bytes);
  const path = `${prefix}/${label}-${hash}.${decoded.extension}`;
  const { error } = await db.storage.from(CASHBOOK_BUCKET).upload(path, decoded.bytes, { contentType: decoded.mime, upsert: false });
  // Content-addressed names make an identical retry safe without replacing evidence.
  if (error && String(error.statusCode) !== '409' && error.error !== 'Duplicate' && !/already exists/i.test(error.message || '')) throw Object.assign(new Error('Das Belegfoto konnte nicht gespeichert werden. Bitte erneut senden.'),{status:503});
  return { path, hash };
}
export async function cashbookMedia(db, result) {
  if (!result || result.error) return result;
  const signed = async path => {
    if (!path) return null;
    const { data, error } = await db.storage.from(CASHBOOK_BUCKET).createSignedUrl(path, 120);
    if (error) throw error;
    return data.signedUrl;
  };
  return { evidenceUrl: await signed(result.evidencePath), signatureUrl: await signed(result.signaturePath) };
}
export async function handleCashbookWorkspace(db, actor, body) {
  const action = String(body.action).replace(/^cashbook_/, '');
  if (!['list','book','media','edit','cancel'].includes(action)) throw new Error('Unbekannte Kassenaktion.');
  if (body.before !== undefined && (!Number.isSafeInteger(body.before) || body.before < 1)) throw new Error('Ungültige Logbuchseite.');
  if (action === 'media' && !cashbookUuid(body.id)) throw new Error('Ungültiger Beleg.');
  let payload = { action, before: body.before, id: body.id };
  if (action === 'edit' || action === 'cancel') {
    const change = validateCashbookChange({...body,action});
    if (body.signatureDrawn !== true) throw new Error('Bitte die Änderung unterschreiben.');
    const signature = photo(body.signature, true);
    const evidence = action === 'edit' && body.evidence ? photo(body.evidence) : null;
    const identity = await cashbookRpc(db, actor, {action:'authorize_change',id:change.id,requestId:change.requestId,changeAction:action});
    if (!identity.canBook || identity.user.role !== 'trainer') throw Object.assign(new Error('Du darfst nur eigene Entnahmen ändern.'), {status:403});
    if (action === 'edit' && !identity.teams.some(team => team.id === change.teamId)) throw Object.assign(new Error('Bitte eine berechtigte Mannschaft auswählen.'), {status:403});
    const prefix = `${identity.user.id}/${change.requestId}`;
    const uploaded = evidence ? await upload(db,prefix,'evidence',evidence) : {path:identity.entry.evidencePath,hash:identity.entry.evidenceHash};
    const signed = await upload(db,prefix,'signature',signature);
    payload = {...change,evidencePath:uploaded.path,evidenceHash:uploaded.hash,signaturePath:signed.path,signatureHash:signed.hash};
  }
  if (action === 'book') {
    const booking = validateCashbookBooking(body);
    const evidence = photo(body.evidence);
    let signature;
    if (booking.direction === 'withdrawal') {
      if (body.signatureDrawn !== true) throw new Error('Bitte die Entnahme unterschreiben.');
      signature = photo(body.signature, true);
    }
    const identity = await cashbookRpc(db, actor, { action: 'authorize' });
    if (!identity.canBook || (booking.direction === 'deposit' && identity.user.role !== 'cashier')) throw Object.assign(new Error('Nur die Kasse darf Einzahlungen erfassen.'), { status: 403 });
    if (booking.direction === 'withdrawal' && (identity.user.role !== 'trainer' || !identity.teams.some(team => team.id === booking.teamId))) throw Object.assign(new Error('Bitte eine berechtigte Mannschaft auswählen.'), { status: 403 });
    const prefix = `${identity.user.id}/${booking.requestId}`;
    const uploaded = await upload(db, prefix, 'evidence', evidence);
    const signed = signature ? await upload(db, prefix, 'signature', signature) : null;
    payload = { action: 'book', ...booking, evidencePath: uploaded.path, evidenceHash: uploaded.hash, signaturePath: signed?.path || null, signatureHash: signed?.hash || null };
  }
  const result = await cashbookRpc(db, actor, payload);
  return action === 'media' ? cashbookMedia(db, result) : result;
}
