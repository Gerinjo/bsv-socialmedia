export const CASHBOOK_THRESHOLD_CENTS = 5000;
export const CASHBOOK_BUCKET = 'cashbook-evidence';
export const cashbookUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function cashbookUsername(name) {
  const [first = '', ...surname] = String(name).trim().split(/\s+/);
  const letters = value => value.toLowerCase().replaceAll('ß', 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  return letters(surname.join('')).slice(0, 4) + letters(first).slice(0, 1);
}

export function cashbookAmount(value) {
  const match = /^(\d{1,6})(?:[,.](\d{1,2}))?$/.exec(String(value).trim());
  if (!match) throw new Error('Bitte einen Betrag mit höchstens zwei Nachkommastellen eingeben.');
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Der Betrag muss größer als 0 € sein.');
  return cents;
}

export function validateCashbookBooking(body) {
  if (!cashbookUuid(body.requestId)) throw new Error('Bitte die Buchung erneut öffnen.');
  if (!['deposit', 'withdrawal'].includes(body.direction)) throw new Error('Ungültige Buchungsart.');
  if (!Number.isSafeInteger(body.amountCents) || body.amountCents < 1 || body.amountCents > 99999999) throw new Error('Bitte einen gültigen Betrag angeben.');
  if (body.confirmed !== true) throw new Error('Bitte den Geldbetrag und die Buchung bestätigen.');
  if (body.direction === 'withdrawal' && !cashbookUuid(body.teamId)) throw new Error('Bitte deine Mannschaft auswählen.');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > 500) throw new Error('Der Verwendungszweck darf höchstens 500 Zeichen lang sein.');
  return { requestId: body.requestId, direction: body.direction, amountCents: body.amountCents, teamId: body.direction === 'withdrawal' ? body.teamId : null, note, confirmed: true };
}

export const cashbookMoney = cents => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
