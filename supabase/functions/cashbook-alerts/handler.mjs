import { cashbookMoney } from '../../../src/cashbook.mjs';

export async function deliverCashbookAlerts(db, { apiKey, from, fetcher = fetch }) {
  if (!apiKey || !from) return { configured: false, sent: 0 };
  let sent = 0;
  for (let index = 0; index < 10; index++) {
    const { data: alert, error } = await db.rpc('cashbook_alert_request', { payload: { action: 'claim' } });
    if (error) throw error;
    if (!alert) break;
    try {
      const transferred = alert.kind === 'advance_transferred';
      const mail = transferred ? {subject: 'Kassenbuch: Deine Erstattung wurde überwiesen', text: `Hallo ${alert.person_name},\n\ndie Kasse hat die Überweisung deiner vorgestreckten Schiedsrichterkosten über ${cashbookMoney(alert.amount_cents)} bestätigt.\n\nMannschaft: ${alert.team_name}\nEintrag: Nr. ${alert.sequence}\n\nBitte prüfe dein Konto. Sobald das Geld angekommen ist, öffne https://www.bsvnordstern.de/cs und bestätige im Kassenbuch mit „Geld erhalten“. Erst danach ist die Erstattung abgeschlossen.\n\nVielen Dank!\nBSV Nordstern Radolfzell`} : {subject: 'Jugendkasse: Safe bitte wieder auffüllen', text: `Hallo Wiebke,\n\nder Geldbestand im Schiedsrichter-Safe ist unter 50,00 € gefallen. Zum Buchungszeitpunkt waren noch ${cashbookMoney(alert.balance_cents)} im Safe.\n\nBitte versorge den Safe wieder mit neuem Geld und erfasse die Einzahlung samt Foto im Kassenbuch. Den aktuellen Bestand findest du in der Vereins-App unter Kassenbuch.\n\nVielen Dank!\nBSV Nordstern Radolfzell`};
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'idempotency-key': `cashbook-${transferred?'transfer':'low'}-${alert.id}` },
        body: JSON.stringify({ from, to: [alert.recipient], ...mail }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Mailanbieter meldet HTTP ${response.status}.`);
      const { error: completeError } = await db.rpc('cashbook_alert_request', { payload: { action: 'sent', id: alert.id, leaseId: alert.lease_id } });
      if (completeError) throw completeError;
      sent++;
    } catch {
      const { error: retryError } = await db.rpc('cashbook_alert_request', { payload: { action: 'failed', id: alert.id, leaseId: alert.lease_id, error: 'Versand fehlgeschlagen; erneuter Versuch folgt.' } });
      if (retryError) throw retryError;
    }
  }
  return { configured: true, sent };
}
