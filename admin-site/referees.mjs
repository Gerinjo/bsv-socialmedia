export function createRefereeWorkspace(root, { request, admin = false, notify = () => {} }) {
  let data = { assignments: [], games: [], coaches: [] };
  let filter = 'all';
  let query = '';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const date = value => new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
  const gameLabel = game => `${game.home_team} – ${game.away_team}`;
  async function submit(form, body, message) {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const status = form.querySelector('[role="status"]');
    status.textContent = 'Wird gespeichert …';
    try {
      const result = await request(body);
      if (admin) await open(); else { data = result; render(); }
      notify(message);
      root.querySelector('.referee-message').textContent = message;
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  }
  function cards() {
    const records = data.assignments.filter(record => (filter === 'all' || refereeStatus(record).key === filter)
      && `${gameLabel(record.game)} ${record.game.team?.name || ''} ${record.referee_name || ''}`.toLocaleLowerCase('de-DE').includes(query.toLocaleLowerCase('de-DE')));
    root.querySelector('.referee-list').innerHTML = records.length ? records.map(record => {
      const state = refereeStatus(record);
      const editable = !record.paid_at && ['scheduled', 'live', 'finished'].includes(record.game.status);
      const payout = record.paid_at ? `<p class="referee-paid">Ausgezahlt am ${escape(date(record.paid_at))}</p>` : '';
      const form = admin ? (canPayReferee(record)
        ? `<form data-pay="${escape(record.id)}"><label class="referee-confirm"><input type="checkbox" required> Geld wurde ausgezahlt</label><button type="submit">Auszahlung bestätigen</button><p role="status"></p></form>`
        : (!record.paid_at && record.referee_name ? '<p class="referee-note">Auszahlung möglich, sobald das Spiel als beendet erfasst ist.</p>' : ''))
        : editable ? `<form data-save="${escape(record.id)}" class="referee-edit"><label>Schiedsrichter<input name="refereeName" value="${escape(record.referee_name)}" maxlength="160" autocomplete="off" placeholder="Vor- und Nachname" required></label><label>Spielfeldgröße<select aria-label="Spielfeldgröße" name="fieldSize" required><option value="">Bitte wählen</option><option value="7" ${record.field_size === 7 ? 'selected' : ''}>7er-Feld</option><option value="9" ${record.field_size === 9 ? 'selected' : ''}>9er-Feld</option></select></label><button type="submit">Zuweisung speichern</button><p role="status"></p></form>`
        : '<p class="referee-note">' + (record.paid_at ? 'Die Zuweisung ist nach der Auszahlung gesperrt.' : 'Dieses Spiel kann derzeit nicht bearbeitet werden.') + '</p>';
      const gameState = { finished: 'Beendet', scheduled: 'Geplant', live: 'Läuft', postponed: 'Verlegt', cancelled: 'Abgesagt', aborted: 'Abgebrochen' }[record.game.status] || record.game.status;
      return `<article class="referee-card"><div class="referee-card-top"><span>${escape(date(record.game.kickoff_at))}</span><span class="referee-badge referee-${state.key}">${state.label}</span></div><h3>${escape(gameLabel(record.game))}</h3><p class="referee-note">${escape([record.game.team?.name, record.game.venue, gameState].filter(Boolean).join(' · '))}</p>${admin || !editable ? `<dl><div><dt>Schiedsrichter</dt><dd>${escape(record.referee_name || 'Noch offen')}</dd></div><div><dt>Spielfeld</dt><dd>${record.field_size ? record.field_size + 'er-Feld' : 'Noch offen'}</dd></div></dl>` : ''}${payout}${form}</article>`;
    }).join('') : '<div class="referee-empty">Keine Spiele für diese Auswahl.</div>';
    root.querySelectorAll('[data-save],[data-pay]').forEach(form => form.onsubmit = event => {
      event.preventDefault();
      const record = data.assignments.find(row => row.id === (form.dataset.save || form.dataset.pay));
      const values = new FormData(form);
      submit(form, admin ? { action: 'referee_pay', id: record.id, version: record.version }
        : { action: 'save', id: record.id, version: record.version, refereeName: values.get('refereeName'), fieldSize: Number(values.get('fieldSize')) }, admin ? 'Auszahlung gespeichert.' : 'Schiri und Spielfeldgröße gespeichert.');
    });
  }
  function render() {
    const counts = Object.fromEntries(['missing', 'assigned', 'payable', 'paid'].map(key => [key, data.assignments.filter(record => refereeStatus(record).key === key).length]));
    root.innerHTML = `<section class="referee-workspace"><div class="referee-heading"><div><p class="referee-eyebrow">BSV Nordstern · Spielbetrieb</p><h2>${admin ? 'Schiedsrichter & Auszahlungen' : 'Meine Schiri-Zuweisungen'}</h2><p>${admin ? 'Beendete Spiele prüfen und Auszahlungen bestätigen.' : 'Trage für deine Mannschaft den Schiri und die Spielfeldgröße ein.'}</p></div><button type="button" class="secondary referee-refresh">Neu laden</button></div><p class="referee-message" role="status" aria-live="polite"></p><div class="referee-stats">${[['missing', 'Schiri fehlt'], ['assigned', 'Zugewiesen'], ['payable', 'Auszahlung offen'], ['paid', 'Ausgezahlt']].map(([key, label]) => `<div><strong>${counts[key]}</strong><span>${label}</span></div>`).join('')}</div><div class="referee-filters"><label>Spiele durchsuchen<input class="referee-search" type="search" value="${escape(query)}" placeholder="Mannschaft oder Schiri …"></label><label>Status<select aria-label="Status" class="referee-filter">${[['all', 'Alle Spiele'], ['missing', 'Schiri fehlt'], ['assigned', 'Zugewiesen'], ['payable', 'Auszahlung offen'], ['paid', 'Ausgezahlt']].map(([key, label]) => `<option value="${key}" ${key === filter ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><div class="referee-list"></div>${admin ? administration() : ''}</section>`;
    root.querySelector('.referee-filter').onchange = event => { filter = event.target.value; cards(); };
    root.querySelector('.referee-search').oninput = event => { query = event.target.value; cards(); };
    root.querySelector('.referee-refresh').onclick = () => open().catch(error => { root.querySelector('.referee-message').textContent = error.message; });
    const register = root.querySelector('[data-register]');
    if (register) register.onsubmit = event => { event.preventDefault(); submit(register, { action: 'referee_register', gameId: new FormData(register).get('gameId') }, 'Spiel für die Schiri-Zuweisung aufgenommen.'); };
    const birthday = root.querySelector('[data-birthday]');
    if (birthday) birthday.onsubmit = event => { event.preventDefault(); const values = new FormData(birthday); submit(birthday, { action: 'referee_birthdate', personId: values.get('personId'), birthDate: values.get('birthDate') }, 'Geburtsdatum für den Portalzugang gespeichert.'); };
    cards();
  }
  function administration() {
    const registered = new Set(data.assignments.map(record => record.game.id));
    const games = (data.games || []).filter(game => !registered.has(game.id));
    const coaches = [...new Map((data.coaches || []).map(coach => [coach.personId, coach])).values()];
    return `<div class="referee-tools"><p>Portalzugang: <a href="/schiedsrichter" target="_blank" rel="noopener">Schiri-Zuweisung öffnen</a></p><details><summary>Spiel ohne Schirieinteilung aufnehmen</summary><p>Nur Spiele aufnehmen, für die der Verein selbst einen Schiri stellen muss.</p><form data-register><label>Spiel<select name="gameId" required><option value="">Bitte wählen</option>${games.map(game => `<option value="${escape(game.id)}">${escape(date(game.kickoff_at) + ' · ' + gameLabel(game))}</option>`).join('')}</select></label><button type="submit">Spiel aufnehmen</button><p role="status"></p></form></details><details><summary>Geburtsdatum für Portalzugang hinterlegen</summary><p>Trainerzuordnungen und freigeschaltete Vereinsfunktionen bestimmen den Zugang. Geburtsdaten werden hier nicht angezeigt.</p><form data-birthday><label>Person<select name="personId" required><option value="">Bitte wählen</option>${coaches.map(coach => `<option value="${escape(coach.personId)}">${escape(coach.name)} · ${coach.birthdayReady ? 'Geburtsdatum hinterlegt' : 'Geburtsdatum fehlt'}</option>`).join('')}</select></label><label>Vollständiges Geburtsdatum<input name="birthDate" type="date" min="1900-01-01" max="${new Date().toLocaleDateString('sv-SE')}" required></label><button type="submit">Geburtsdatum speichern</button><p role="status"></p></form></details></div>`;
  }
  async function open() {
    if (!root.querySelector('.referee-workspace')) root.innerHTML = '<p role="status">Schiri-Zuweisungen werden geladen …</p>';
    try { data = await request({ action: admin ? 'referee_load' : 'list' }); render(); }
    catch (error) { if (!root.querySelector('.referee-workspace')) root.innerHTML = `<p role="alert">${escape(error.message)}</p>`; throw error; }
  }
  return { open, clear() { data = { assignments: [], games: [], coaches: [] }; root.replaceChildren(); } };
}
