export function parseEuroCents(value) {
  const text = String(value ?? '').trim().replace(/\s*(?:€|EUR)\s*$/i, '').trim();
  if (!/^(?:\d{1,5}|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text) && !/^\d{1,5}\.\d{2}$/.test(text)) return null;
  const normalized = text.includes(',') ? text.replaceAll('.', '').replace(',', '.') : /^\d+\.\d{2}$/.test(text) ? text : text.replaceAll('.', '');
  const parts = normalized.split('.');
  const cents = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100000 ? cents : null;
}

export const formatEuro = cents => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);

export function detectReceiptAmount(text) {
  const candidates = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const amounts = [...line.matchAll(/(?<![\d.,-])(?:\d{1,3}(?:\.\d{3})*|\d{1,5})[,.]\d{2}(?!\d)/g)];
    for (const match of amounts) {
      const cents = parseEuroCents(match[0]);
      if (!cents) continue;
      const total = /gesamt(?:betrag|summe)?|endbetrag|auszahlungsbetrag|zu zahlen|summe|total/i.test(line);
      const component = /fahrt|kilometer|\bkm\b|spesen|entschädigung|entgelt|zwischensumme|mwst|steuer/i.test(line);
      candidates.push({ cents, score: total && !/zwischensumme/i.test(line) ? 3 : component ? -1 : /€|eur/i.test(line) ? 1 : 0 });
    }
  }
  const totals = [...new Set(candidates.filter(candidate => candidate.score === 3).map(candidate => candidate.cents))];
  if (totals.length === 1) return { cents: totals[0], confidence: 'total' };
  if (!totals.length && candidates.length === 1 && candidates[0].score >= 0) return { cents: candidates[0].cents, confidence: 'single' };
  return { cents: null, confidence: candidates.length ? 'ambiguous' : 'missing' };
}

export function normalizeIban(value) {
  const iban = String(value ?? '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban) || (iban.startsWith('DE') && iban.length !== 22)) throw new Error('Die IBAN ist ungültig.');
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, char => String(char.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  if (remainder !== 1) throw new Error('Die Prüfziffer der IBAN ist ungültig.');
  return iban;
}

export function parseTrainerBankDetails(text) {
  const field = label => String(text ?? '').match(new RegExp('^\\s*' + label + '\\s*:\\s*([^\\r\\n]+)', 'im'))?.[1]?.trim() || '';
  const iban = normalizeIban(field('IBAN'));
  const accountHolder = field('Kontoinhaber(?:in|\\s*\\(in\\))?');
  const bic = field('BIC').replace(/\s/g, '').toUpperCase();
  if (!accountHolder || accountHolder.length > 160) throw new Error('Kontoinhaber fehlt oder ist zu lang.');
  if (bic && !/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(bic)) throw new Error('Die BIC ist ungültig.');
  return { iban, accountHolder, bic };
}

export function expenseState(claim) {
  return { submitted: 'Zur Prüfung', approved: 'Zur Auszahlung', rejected: 'Bitte korrigieren', paid: 'Erstattet' }[claim?.status] || 'Quittung fehlt';
}

export function validateExpenseSubmission(body) {
  if (!Number.isInteger(body.amountCents) || body.amountCents < 1 || body.amountCents > 100000) throw new Error('Bitte einen Betrag zwischen 0,01 € und 1.000,00 € angeben.');
  if (body.confirmed !== true) throw new Error('Bitte bestätigen, dass du die Gebühr vorgestreckt hast und der Betrag stimmt.');
  if (body.ocrAmountCents != null && (!Number.isInteger(body.ocrAmountCents) || body.ocrAmountCents < 1 || body.ocrAmountCents > 100000)) throw new Error('Ungültiger erkannter Betrag.');
  return { amountCents: body.amountCents, ocrAmountCents: body.ocrAmountCents ?? null, confirmed: true };
}
