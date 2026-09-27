import { refereeExpensePreviewApi } from '/preview-referee-expenses.mjs';
import { canPayReferee, validateRefereeInput } from '/referee-model.mjs';
const key = 'bsv-referee-preview-v1';
const team = { id: '10000000-0000-0000-0000-000000000001', name: 'D1-Junioren', active: true };
const person = { id: '20000000-0000-0000-0000-000000000001', display_name: 'Alex Beispiel', active: true };
function seed() {
  return [
    { days: 3, home: 'BSV Nordstern', away: 'FC Beispielstadt', status: 'scheduled', name: null, field: null },
    { days: -2, home: 'BSV Nordstern', away: 'SV Musterhausen', status: 'finished', name: 'Robin Beispiel', field: 9 },
    { days: -8, home: 'FC Seeblick', away: 'BSV Nordstern', status: 'finished', name: 'Kim Muster', field: 7, paid: true },
  ].map((row, index) => ({ id: `30000000-0000-0000-0000-00000000000${index + 1}`, version: 1, referee_name: row.name, field_size: row.field, paid_at: row.paid ? new Date(Date.now() - 7 * 86400000).toISOString() : null,
    game: { id: `40000000-0000-0000-0000-00000000000${index + 1}`, team_id: team.id, team, home_team: row.home, away_team: row.away, kickoff_at: new Date(Date.now() + row.days * 86400000).toISOString(), status: row.status, venue: 'Nordstern-Sportplatz' } }));
}
function load() { try { return JSON.parse(localStorage.getItem(key)) || seed(); } catch { return seed(); } }
export async function refereePreviewApi(body) {
  if (!body) return { coaches: [{ team_id: team.id, person_id: person.id, role: 'Trainer', team, person }] };
  if (body.action?.startsWith('expense_') && (body.birthDate !== '1980-01-01' || body.personId !== person.id || body.teamId !== team.id)) throw new Error('Die Anmeldung konnte nicht bestätigt werden.');
  if (body.action?.startsWith('expense_') || ['referee_expense_load','referee_approve_expense','referee_reject_expense','referee_receipt_url','referee_sync_fees','referee_import_account'].includes(body.action)) return refereeExpensePreviewApi(body);
  const records = load();
  const record = records.find(row => row.id === body.id);
  if (['list', 'save'].includes(body.action) && (body.birthDate !== '1980-01-01' || body.personId !== person.id || body.teamId !== team.id)) throw new Error('Die Anmeldung konnte nicht bestätigt werden.');
  if (body.action === 'save') {
    const input = validateRefereeInput(body);
    if (!record || record.paid_at || record.version !== body.version) throw new Error('Das Spiel ist gesperrt oder wurde geändert.');
    Object.assign(record, { referee_name: input.refereeName, field_size: input.fieldSize, version: record.version + 1 });
  }
  if (body.action === 'referee_pay') {
    if (!record || !canPayReferee(record) || record.version !== body.version) throw new Error('Dieses Spiel kann nicht ausgezahlt werden.');
    Object.assign(record, { paid_at: new Date().toISOString(), paid_by: 'local-preview', version: record.version + 1 });
  }
  if (body.action === 'referee_birthdate') throw new Error('Der Beispielzugang verwendet immer den 01.01.1980.');
  localStorage.setItem(key, JSON.stringify(records));
  return { assignments: records, games: records.map(row => row.game), coaches: [{ personId: person.id, name: person.display_name, team: team.name, birthdayReady: true }] };
}
