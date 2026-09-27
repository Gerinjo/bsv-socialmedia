import { parseTrainerBankDetails } from '../../../src/referee-expenses.mjs';
import { encryptTrainerBankDetails, RECEIPT_BUCKET } from '../_shared/referee-receipts.mjs';
import { syncRefereeFees } from '../_shared/referee-fee-sync.ts';

export async function handleRefereeExpenses(db: any, actor: string, body: Record<string, any>) {
  if (body.action === 'referee_sync_fees') return syncRefereeFees(db);
  if (body.action === 'referee_receipt_url') {
    const { data, error } = await db.from('referee_receipts').select('storage_path,mime_type').eq('id', body.receiptId).single();
    if (error) throw error;
    const signed = await db.storage.from(RECEIPT_BUCKET).createSignedUrl(data.storage_path, 180);
    if (signed.error) throw signed.error;
    return { url: signed.data.signedUrl, mime: data.mime_type };
  }
  let payload;
  if (body.action === 'referee_import_account') {
    if (typeof body.onboardingText !== 'string' || body.onboardingText.length > 30000 || !/^[a-f0-9-]{36}$/i.test(body.personId || '')) throw new Error('Bitte Trainer und Onboarding-Nachricht angeben.');
    if (!String(body.sourceMessageId || '').trim() || String(body.sourceMessageId).length > 200) throw new Error('Bitte eine Nachrichtenreferenz angeben.');
    const details = parseTrainerBankDetails(body.onboardingText);
    payload = { action: body.action, personId: body.personId, sourceMessageId: body.sourceMessageId,
      ibanLast4: details.iban.slice(-4), encryptedDetails: await encryptTrainerBankDetails(details, body.personId, Deno.env.get('REFEREE_BANK_ENCRYPTION_KEY')) };
  } else if (['referee_expense_load','referee_approve_expense','referee_reject_expense'].includes(body.action)) {
    payload = { action: body.action, id: body.id, version: body.version, note: body.note };
  } else throw new Error('Unbekannte Erstattungsaktion.');
  const { data, error } = await db.rpc('referee_expense_admin_request', { actor, payload });
  if (error) throw error;
  if (data.error) throw new Error(data.error);
  if (body.action === 'referee_expense_load') {
    const coaches = await db.from('social_team_people').select('person_id,person:social_people!inner(display_name,active)').ilike('role', '%trainer%').eq('person.active', true);
    if (coaches.error) throw coaches.error;
    data.coaches = [...new Map((coaches.data || []).map((row: any) => [row.person_id, { id: row.person_id, name: row.person.display_name }])).values()];
  }
  return data;
}
