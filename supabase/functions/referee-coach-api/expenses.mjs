import { validateExpenseSubmission } from '../../../src/referee-expenses.mjs';
import { decodeRefereeReceipt, receiptHash, RECEIPT_BUCKET } from '../_shared/referee-receipts.mjs';

export async function coachExpenses(db, body) {
  const identity = { personId: body.personId, teamId: body.teamId, birthDate: body.birthDate };
  if (body.action === 'expense_list') return db.rpc('referee_expense_coach_request', { payload: { ...identity, action: 'expense_list' } });
  let submission, receipt;
  try {
    submission = validateExpenseSubmission(body);
    receipt = decodeRefereeReceipt(body.receiptData);
    if (body.version != null && (!Number.isInteger(body.version) || body.version < 1)) throw new Error('Bitte die Erstattung neu laden.');
  } catch (error) { return { data: { error: error.message, status: 400 } }; }
  const hash = await receiptHash(receipt.bytes);
  const path = `${identity.personId}/${body.caseId}/${hash}.${receipt.extension}`;
  const payload = { ...identity, ...submission, action: 'expense_prepare', caseId: body.caseId, version: body.version ?? null, receiptSha256: hash };
  const prepared = await db.rpc('referee_expense_coach_request', { payload });
  if (prepared.error || prepared.data?.error) return prepared;
  if (!prepared.data.receiptExists) {
    const result = await db.storage.from(RECEIPT_BUCKET).upload(path, receipt.bytes, { contentType: receipt.mime, upsert: false });
    // A retry may encounter its own immutable, hash-addressed upload after an
    // interrupted database commit. Only this exact duplicate is safe to reuse.
    if (result.error && result.error.error !== 'Duplicate' && result.error.code !== 'Duplicate' && String(result.error.statusCode) !== '409') return { data: { error: 'Die Quittung konnte nicht gespeichert werden. Bitte neu laden und erneut versuchen.', status: 409 } };
  }
  const result = await db.rpc('referee_expense_coach_request', { payload: { ...payload, action: 'expense_submit', receiptPath: path, receiptMime: receipt.mime } });
  // Keep unreferenced uploads for later reconciliation. Immediate deletion can
  // race with another request committing the same hash-addressed receipt.
  return result;
}
