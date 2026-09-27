export const REFEREE_ROLE = 'referee-admin';

export function canPayReferee(record, now = Date.now()) {
  return !record.paid_at && Boolean(record.referee_name?.trim())
    && [7, 9].includes(record.field_size) && record.game?.status === 'finished'
    && Date.parse(record.game.kickoff_at) <= now;
}

export function refereeStatus(record) {
  if (record.paid_at) return { key: 'paid', label: 'Ausgezahlt' };
  if (!record.referee_name) return { key: 'missing', label: 'Schiri fehlt' };
  if (canPayReferee(record)) return { key: 'payable', label: 'Auszahlung offen' };
  return { key: 'assigned', label: 'Schiri zugewiesen' };
}

export function validateRefereeInput(body) {
  const refereeName = typeof body.refereeName === 'string' ? body.refereeName.trim() : '';
  if (!refereeName || refereeName.length > 160) throw new Error('Bitte einen Schirinamen mit höchstens 160 Zeichen eintragen.');
  if (![7, 9].includes(body.fieldSize)) throw new Error('Bitte 7er- oder 9er-Feld auswählen.');
  if (!Number.isSafeInteger(body.version) || body.version < 1) throw new Error('Bitte die Spiele neu laden.');
  return { refereeName, fieldSize: body.fieldSize, version: body.version };
}
