export function createRefereeExpensesWorkspace(root, { request, admin = false }) {
  let data = { cases: [], coaches: [] }, filter = 'all';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const date = value => new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
  const title = row => row.home_team + ' – ' + row.away_team;
  const fileData = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.')); reader.readAsDataURL(file); });
  const eligible = row => row.game_status === 'finished' && row.appointment_state === 'assigned' && Date.parse(row.kickoff_at) <= Date.now() && Date.parse(row.checked_at) >= Date.now() - 48 * 3600000;

  async function action(button, body, message) {
    button.disabled = true;
    const feedback = root.querySelector('.expense-message'); feedback.textContent = 'Wird gespeichert …';
    try { await request(body); await open(); root.querySelector('.expense-message').textContent = message; }
    catch (error) { feedback.textContent = error.message; }
    finally { button.disabled = false; }
  }
  function cards() {
    const rows = data.cases.filter(row => filter === 'all' || (row.claim?.status || 'missing') === filter);
    root.querySelector('.expense-list').innerHTML = rows.length ? rows.map(row => {
      const claim = row.claim;
      const state = row.reserved ? 'Bereits eingereicht' : expenseState(claim);
      const sourceState = { assigned: 'Schiedsrichter angesetzt', missing: 'Kein Schiedsrichter angesetzt', unknown: 'Ansetzung nicht lesbar' }[row.appointment_state];
      let controls = '';
      if (admin && claim) {
        controls = `<button class="secondary" type="button" data-receipt="${esc(claim.receipt_id)}">Quittung ansehen</button>`;
        if (claim.status === 'submitted') controls += `<div class="expense-review"><button type="button" data-approve="${esc(claim.id)}" ${!eligible(row) || !claim.bankLast4 ? 'disabled' : ''}>Zur Überweisung freigeben</button><details><summary>Zur Korrektur zurückgeben</summary><form data-reject="${esc(claim.id)}"><label>Hinweis an den Trainer<textarea name="note" maxlength="1000" required></textarea></label><button type="submit" class="secondary">Zurückgeben</button></form></details></div>${!claim.bankLast4 ? '<p class="referee-note">Geprüfte Kontodaten fehlen noch.</p>' : ''}${!eligible(row) ? '<p class="referee-note">Ansetzung und Spielstatus müssen aktuell bestätigt sein.</p>' : ''}`;
        if (claim.status === 'approved') controls += '<p class="referee-note">Für die Banküberweisung vorbereitet. Noch nicht überwiesen.</p>';
      } else if (!admin && !row.reserved && (!claim || claim.status === 'rejected')) {
        controls = eligible(row) ? `<form class="expense-form" data-submit="${esc(row.id)}"><label>Quittung hochladen<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label><p class="referee-note">Foto: Betrag automatisch erkennen. PDF: Betrag selbst eintragen. Maximal 8 MB.</p><p class="expense-ocr" role="status"></p><label>Erstattungsbetrag in Euro<input name="amount" type="text" inputmode="decimal" placeholder="0,00" value="${claim ? esc((claim.amount_cents / 100).toFixed(2).replace('.', ',')) : ''}" required></label><label class="referee-confirm"><input name="confirmed" type="checkbox" required> Ich habe diese Gebühr bezahlt und den Betrag geprüft.</label><button type="submit">Erstattung einreichen</button><p class="expense-submit-status" role="status"></p></form>` : '<p class="referee-note">Eine Quittung kann nach dem Spiel und einer aktuellen Bestätigung der Ansetzung eingereicht werden.</p>';
      }
      return `<article class="referee-card"><div class="referee-card-top"><span>${esc(date(row.kickoff_at))}</span><span class="referee-badge">${esc(state)}</span></div><h3>${esc(title(row))}</h3><p class="referee-note">${esc(sourceState)} · ${row.game_status === 'finished' ? 'Beendet' : 'Spiel noch nicht als beendet bestätigt'}</p><p class="referee-note">Abgleich: ${esc(date(row.checked_at))}</p>${claim ? `<div class="expense-total">${formatEuro(claim.amount_cents)}</div>${admin ? `<p>${esc(claim.person_name)} · ${claim.bankLast4 ? 'IBAN endet auf ' + esc(claim.bankLast4) : 'Konto fehlt'}</p>` : ''}${claim.ocr_amount_cents && claim.ocr_amount_cents !== claim.amount_cents ? `<p class="referee-note">Erkannt: ${formatEuro(claim.ocr_amount_cents)} · vom Trainer korrigiert.</p>` : ''}${claim.review_note ? `<p class="expense-warning">${esc(claim.review_note)}</p>` : ''}` : ''}${controls}</article>`;
    }).join('') : '<div class="referee-empty">Keine Spiele für diese Auswahl.</div>';
    root.querySelectorAll('[data-submit]').forEach(form => {
      let file = null, ocrAmount = null, reading = false, generation = 0;
      const amount = form.elements.amount;
      form.elements.receipt.onchange = async () => {
        const token = ++generation; file = form.elements.receipt.files[0]; ocrAmount = null;
        const status = form.querySelector('.expense-ocr');
        reading = false; form.querySelector('button').disabled = false; status.textContent = '';
        if (!file) return;
        if (file.size > 8388608 || !['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)) { status.textContent = 'Bitte ein Foto oder PDF bis 8 MB auswählen.'; file = null; return; }
        const previous = amount.value; reading = true; form.querySelector('button').disabled = true;
        try {
          const result = await recognizeReceipt(file, text => { if (token === generation) status.textContent = text; });
          if (token !== generation) return;
          ocrAmount = result.cents;
          if (result.cents && amount.value === previous) amount.value = (result.cents / 100).toFixed(2).replace('.', ',');
          status.textContent = result.cents ? 'Erkannt: ' + formatEuro(result.cents) + '. Bitte prüfen und bei Bedarf korrigieren.' : result.note || 'Kein eindeutiger Gesamtbetrag erkannt. Bitte Betrag selbst eintragen.';
        } catch { if (token === generation) status.textContent = 'Die Texterkennung ist nicht verfügbar. Bitte Betrag selbst eintragen.'; }
        finally { if (token === generation) { reading = false; form.querySelector('button').disabled = false; } }
      };
      form.onsubmit = async event => {
        event.preventDefault(); if (reading) return;
        const status = form.querySelector('.expense-submit-status');
        const cents = parseEuroCents(amount.value);
        if (!file || cents === null) { status.textContent = 'Bitte Quittung und einen gültigen Eurobetrag angeben.'; return; }
        const row = data.cases.find(item => item.id === form.dataset.submit);
        const button = form.querySelector('button'); button.disabled = true;
        try { await action(button, { action: 'expense_submit', caseId: row.id, version: row.claim?.version, amountCents: cents, ocrAmountCents: ocrAmount, confirmed: form.elements.confirmed.checked, receiptData: await fileData(file) }, 'Erstattung mit Quittung eingereicht.'); }
        catch (error) { status.textContent = error.message; }
        finally { button.disabled = false; }
      };
    });
    root.querySelectorAll('[data-approve]').forEach(button => button.onclick = () => {
      const claim = data.cases.find(row => row.claim?.id === button.dataset.approve).claim;
      action(button, { action: 'referee_approve_expense', id: claim.id, version: claim.version }, 'Erstattung freigegeben. Die Banküberweisung ist vorbereitet.');
    });
    root.querySelectorAll('[data-reject]').forEach(form => form.onsubmit = event => {
      event.preventDefault(); const claim = data.cases.find(row => row.claim?.id === form.dataset.reject).claim;
      action(form.querySelector('button'), { action: 'referee_reject_expense', id: claim.id, version: claim.version, note: form.elements.note.value }, 'Erstattung zur Korrektur zurückgegeben.');
    });
    root.querySelectorAll('[data-receipt]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        const result = await request({ action: 'referee_receipt_url', receiptId: button.dataset.receipt });
        const dialog = document.createElement('dialog'); dialog.className = 'expense-receipt-dialog';
        dialog.innerHTML = '<button type="button">Schließen</button><h3>Quittung</h3>';
        const content = document.createElement(result.mime === 'application/pdf' ? 'a' : 'img');
        if (content.tagName === 'IMG') { content.src = result.url; content.alt = 'Eingereichte Schiedsrichterquittung'; } else { content.href = result.url; content.target = '_blank'; content.rel = 'noopener noreferrer'; content.textContent = 'PDF-Quittung öffnen'; }
        dialog.append(content); root.append(dialog); dialog.querySelector('button').onclick = () => dialog.close(); dialog.onclose = () => dialog.remove(); dialog.showModal();
      } catch (error) { root.querySelector('.expense-message').textContent = error.message; }
      finally { button.disabled = false; }
    });
  }
  function render() {
    const waiting = data.cases.filter(row => row.claim?.status === 'submitted');
    const ready = data.cases.filter(row => row.claim?.status === 'approved');
    root.innerHTML = `<section class="referee-workspace"><div class="referee-heading"><div><p class="referee-eyebrow">Jugend · Schiedsrichtergebühren</p><h2>${admin ? 'Erstattungen an Trainer' : 'Vorgestreckte Gebühren erstatten'}</h2><p>${admin ? 'Quittungen prüfen und Banküberweisungen vorbereiten.' : 'Wähle dein Spiel, lade die Quittung hoch und prüfe den Betrag.'}</p></div><button class="secondary expense-refresh" type="button">Neu laden</button></div><p class="expense-message referee-message" role="status" aria-live="polite"></p>${admin ? `<div class="referee-stats"><div><strong>${waiting.length}</strong><span>Quittungen zur Prüfung</span></div><div><strong>${formatEuro(waiting.reduce((sum,row)=>sum+row.claim.amount_cents,0))}</strong><span>Eingereicht</span></div><div><strong>${ready.length}</strong><span>Überweisungen vorbereitet</span></div><div><strong>${formatEuro(ready.reduce((sum,row)=>sum+row.claim.amount_cents,0))}</strong><span>Zur Auszahlung</span></div></div><p class="expense-warning">Der Zahlungsanbieter ist noch nicht angebunden. Freigaben bereiten die Auszahlung vor.</p>` : `<p class="expense-account">Erstattung auf dein hinterlegtes Konto${data.bankLast4 ? ' · IBAN endet auf ' + esc(data.bankLast4) : ' · Kontodaten werden noch vom Admin zugeordnet'}.</p>`}<div class="expense-toolbar"><label>Erstattungsstatus<select aria-label="Erstattungsstatus" class="expense-filter">${[['all','Alle'],['missing','Quittung fehlt'],['submitted','Zur Prüfung'],['rejected','Bitte korrigieren'],['approved','Zur Auszahlung'],['paid','Erstattet']].map(([value,label])=>`<option value="${value}" ${filter===value?'selected':''}>${label}</option>`).join('')}</select></label>${admin ? '<button type="button" class="secondary expense-sync">Ansetzungen abgleichen</button><button type="button" class="secondary expense-export">Auszahlungsliste herunterladen</button>' : ''}</div><div class="expense-list referee-list"></div>${admin ? `<details class="expense-import"><summary>Kontodaten aus Trainer-Onboarding zuordnen</summary><p>Trainer und Originalnachricht zuordnen. Kontodaten werden verschlüsselt abgelegt; in der Übersicht erscheinen nur die letzten vier IBAN-Zeichen.</p><form><label>Trainer<select name="personId" required><option value="">Bitte wählen</option>${(data.coaches||[]).map(coach=>`<option value="${esc(coach.id)}">${esc(coach.name)}</option>`).join('')}</select></label><label>Nachrichtenreferenz<input name="sourceMessageId" maxlength="200" required></label><label>Nachrichtentext mit Kontoinhaber, IBAN und BIC<textarea name="onboardingText" maxlength="30000" autocomplete="off" required></textarea></label><button type="submit">Kontodaten zuordnen</button></form></details>` : ''}</section>`;
    root.querySelector('.expense-refresh').onclick = () => open().catch(error => { root.querySelector('.expense-message').textContent = error.message; });
    root.querySelector('.expense-filter').onchange = event => { filter = event.target.value; cards(); };
    if (admin) {
      root.querySelector('.expense-sync').onclick = async event => { const button = event.target; button.disabled = true; try { const result = await request({ action: 'referee_sync_fees' }); await open(); root.querySelector('.expense-message').textContent = result.checked + ' Spiele geprüft. ' + (result.issues?.length ? result.issues.join(' · ') : 'Abgleich abgeschlossen.'); } catch (error) { root.querySelector('.expense-message').textContent = error.message; } finally { button.disabled = false; } };
      root.querySelector('.expense-export').onclick = () => {
        const rows = data.cases.filter(row => row.claim?.status === 'approved');
        // Review list only. Full account details remain private; download never marks money as paid.
        const cell = value => '"' + String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"','""') + '"';
        const csv = [['Zahlungsreferenz','Trainer','IBAN letzte 4','Betrag EUR','Spiel','Status'],...rows.map(row => [row.claim.payment_id,row.claim.person_name,row.claim.bankLast4,(row.claim.amount_cents/100).toFixed(2).replace('.',','),title(row),'Vorbereitet – nicht überwiesen'])].map(row=>row.map(cell).join(';')).join('\r\n');
        const url = URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})); const link=document.createElement('a');link.href=url;link.download='bsv-erstattungen-pruefliste.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      };
      const form = root.querySelector('.expense-import form'); form.onsubmit = async event => { event.preventDefault(); const body = Object.fromEntries(new FormData(form)); const button=form.querySelector('button'); await action(button,{...body,action:'referee_import_account'},'Kontodaten sicher zugeordnet.'); form.reset(); };
    }
    cards();
  }
  async function open() { data = await request({ action: admin ? 'referee_expense_load' : 'expense_list' }); render(); }
  return { open, clear() { data={cases:[],coaches:[]}; root.replaceChildren(); } };
}
