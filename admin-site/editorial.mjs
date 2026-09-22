export function createEditorialWorkspace(
  root,
  {
    api,
    esc,
    show,
    editorialCalendarDays,
    editorialMilestones,
    editorialReleaseState,
    editorialCanDeleteArticle,
    editorialCoverDefaults,
    renderEditorialMagazine,
    editorialPersonCandidates,
    createEditorialDictation,
  },
) {
  let issues = [],
    departments = [],
    teams = [],
    people = [],
    editingGalleries = [],
    selected = null,
    articles = [],
    month = new Date()
      .toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" })
      .slice(0, 7),
    filter = "",
    loaded = false;
  let editing = null,
    editingIssue = null,
    dirty = false,
    coverDirty = false,
    busy = false,
    selectionRequest = 0,
    rewriteAvailable = false;
  const expandedPlanGroups = new Set();
  const $ = (selector) => root.querySelector(selector);
  const kindLabel = (kind) =>
    kind === "stadium" ? "Stadionheft" : "Newsletter";
  const statusLabel = {
    draft: "Offen",
    review: "In Prüfung",
    ready: "Freigegeben",
    waived: "Verzicht",
  };
  const coachLabel = article => {
    const team = teams.find(team => team.id === article.team_id);
    const match = /^(herren|frauen)-([12])$/.exec(team?.slug || '');
    if (article.kind === 'board') return 'Grußwort Vorstandschaft';
    if (article.kind === 'youth') return 'Grußwort Jugendabteilung';
    if (article.kind !== 'coach' || !match) return article.title;
    const ordinal = match[2] === '1' ? 'Erste' : 'Zweite';
    return match[1] === 'herren' ? `Grußwort ${ordinal} Mannschaft (Herren)` : `Grußwort ${ordinal} Frauenmannschaft`;
  };
  const dateLabel = (date) =>
    new Date(`${date}T12:00:00`).toLocaleDateString("de-DE");
  const call = (action, data = {}) =>
    api("POST", { action: `editorial_${action}`, ...data });
  root.innerHTML = `
    <section class="panel editorial-hero"><div><span class="editorial-eyebrow">VEREINSREDAKTION</span><h2>Redaktion für Heft & Newsletter</h2><p>Stadionhefte und Newsletter gemeinsam planen, schreiben und fertigstellen.</p></div><button id="edNewIssue" class="primary-action">＋ Ausgabe anlegen</button></section>
    <section class="panel"><div class="editorial-calendar-heading"><div><h3>Redaktionskalender</h3><div class="editorial-legend"><span class="ed-start">● Redaktionsstart</span><span class="ed-close">● Redaktionsschluss</span><span class="ed-publish">● Erscheinung</span><span>▰ Redaktionszeitraum</span></div></div><label>Ausgabeart<select id="edFilter"><option value="">Alle Ausgaben</option><option value="stadium">Stadionheft</option><option value="newsletter">Newsletter</option></select></label></div><div class="editorial-month-nav"><button class="ghost" id="edPrev" aria-label="Vorheriger Monat">←</button><h3 id="edMonth" aria-live="polite"></h3><button class="ghost" id="edNext" aria-label="Nächster Monat">→</button><button class="ghost" id="edToday">Heute</button></div><div class="editorial-calendar-scroll"><div id="edCalendar" class="editorial-calendar"></div></div></section>
    <div class="editorial-columns"><section class="panel"><h3>Ausgaben</h3><div id="edIssues" aria-live="polite"></div></section><section class="panel" id="edDetail"><div class="empty">Lege die erste Ausgabe an oder wähle eine Ausgabe aus.</div></section></div>
    <dialog id="edIssueDialog" aria-labelledby="edIssueHeading"><div class="dialog-header"><h2 id="edIssueHeading">Ausgabe anlegen</h2><button type="button" class="ghost" id="edIssueClose" aria-label="Schließen">✕</button></div><form id="edIssueForm" class="fields"><label>Ausgabeart<select name="kind"><option value="stadium">Stadionheft</option><option value="newsletter">Newsletter</option></select></label><label>Titel<input name="title" required maxlength="180" placeholder="Zum Beispiel: Nordstern · Heimspielausgabe 01"></label><label>Redaktionsstart<input name="starts_on" type="date" required></label><label>Redaktionsschluss<input name="closes_on" type="date" required></label><label>Erscheinungsdatum<input name="publishes_on" type="date" required></label><p class="small">Im Stadionheft werden Grußworte, Trainerbegrüßungen und Sportdaten als feste Beiträge angelegt. Newsletter starten mit einem freien Inhaltsplan.</p><div class="wide toolbar"><button type="submit">Ausgabe speichern</button><span id="edIssueMessage" role="status"></span></div></form></dialog>
    <dialog id="edArticleDialog" aria-labelledby="edArticleHeading"><div class="dialog-header"><div><span class="editorial-eyebrow">TEXTREDAKTION</span><h2 id="edArticleHeading">Beitrag bearbeiten</h2></div><button type="button" class="ghost" id="edArticleClose" aria-label="Editor schließen">✕</button></div><form id="edArticleForm"><div class="fields"><label class="wide">Titel<input name="title" required maxlength="180"></label><label>Abteilung<select name="department_id"></select></label><label>Autor / Verantwortlich<input name="author" maxlength="180" placeholder="Name"></label><div><span class="small">Freigabestatus</span><p id="edApprovalStatus"></p><input type="hidden" name="status" value="draft"></div><div class="small" id="edSource"></div><fieldset class="wide ed-person-selection" id="edPersonSelection"><legend>Personen zum Beitrag auswählen</legend><p class="small">Eine oder mehrere Personen auswählen. Hinterlegte Bilder erscheinen beim Text.</p><div id="edPersonCandidates"></div></fieldset><div class="wide ed-dictation" id="edDictation"><button type="button" class="ghost" id="edDictate" aria-pressed="false" aria-controls="edBody" aria-describedby="edDictationHint"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg><span>Diktieren</span></button><p class="small" id="edDictationHint"></p><p class="small" id="edDictationStatus" role="status" aria-live="polite"></p></div><label class="wide">Beitrag<textarea id="edBody" name="body" maxlength="30000" rows="15" spellcheck="true" lang="de" placeholder="Hier ist Platz für euren Beitrag …"></textarea></label><fieldset class="wide ed-gallery-editor" id="edGalleryEditor"><legend>Bildgruppen zum Beitrag</legend><p class="small">Jeder Upload bildet eine eigene Gruppe. Wähle je Gruppe ein Titelbild für die Heftseite. Ein Klick darauf öffnet alle Bilder der Gruppe.</p><div id="edGalleryGroups"></div><label>Neue Bildgruppe hinzufügen (bis 20 Bilder)<input id="edGalleryFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p class="small">Bis zu 6 Gruppen. JPG, PNG oder WebP, bis 5 MB je Original. Fotos werden auf höchstens 1600 Pixel verkleinert.</p></fieldset></div><p class="small" id="edRewriteHint"></p><div class="toolbar"><button type="submit" id="edSaveArticle">Speichern & überarbeiten</button><button type="submit" class="ghost" id="edRetryRewrite" data-rewrite="true">Erneut überarbeiten</button><button type="button" class="ghost" id="edHistory">Original & Verlauf</button><button type="button" class="ghost hidden" id="edDeleteArticle">Beitrag löschen</button><button type="button" class="ghost hidden" id="edWaiveArticle">Verzicht</button><button type="button" class="primary-action" id="edApproveArticle">Beitrag freigeben</button><span class="small" id="edWordCount"></span></div><p id="edArticleMessage" role="status" aria-live="polite"></p><div id="edRevisionList"></div></form></dialog>
    <dialog id="edEventDialog" aria-labelledby="edEventHeading"><div class="dialog-header"><h2 id="edEventHeading">Veranstaltung ins Heft aufnehmen</h2><button class="ghost" id="edEventClose" type="button" aria-label="Schließen">✕</button></div><form id="edEventForm" class="fields"><label class="wide">Termin auswählen<select id="edEventSource"><option value="">Eigene Veranstaltung</option></select></label><label class="wide">Titel<input name="title" maxlength="180" required></label><label>Datum<input type="date" name="date" required></label><label>Uhrzeit<input type="time" name="time"></label><label class="wide">Ort<input name="location" maxlength="200"></label><label class="wide">Beschreibung im Heft<textarea name="description" required maxlength="30000" rows="6"></textarea></label><p class="small wide">Der Termin erscheint als eigener Beitrag im Heft und lässt sich in der Titelblatt-Karte für das Cover auswählen. Bitte bei wiederkehrenden Stories das gewünschte Veranstaltungsdatum prüfen. Der Beitrag muss anschließend freigegeben werden.</p><div class="toolbar wide"><button type="submit">Veranstaltung aufnehmen</button><span id="edEventMessage" role="status"></span></div></form></dialog>
    <dialog id="edPreviewDialog" aria-labelledby="edPreviewHeading"><div class="dialog-header"><h2 id="edPreviewHeading">Heftvorschau · Entwurf</h2><button class="ghost" id="edPreviewClose" type="button" aria-label="Vorschau schließen">✕</button></div><iframe id="edMagazineFrame" title="Stadionheft vor Veröffentlichung ansehen" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe></dialog>`;

  const dictation = createEditorialDictation({
    button: $('#edDictate'), status: $('#edDictationStatus'), hint: $('#edDictationHint'), textarea: $('#edArticleForm').elements.body,
    canStart: () => !busy && !editing?.automatic_sports && editing?.status !== 'waived',
    onChange: () => { dirty = true; updateApprovalButton(); wordCount(); },
    onActiveChange: active => { lock($('#edArticleForm'), active); updateApprovalButton(); },
  });
  window.addEventListener('pagehide', () => dictation.reset());
  $('#edArticleDialog').addEventListener('close', () => dictation.reset());

  function calendar() {
    $("#edMonth").textContent = new Date(
      `${month}-01T12:00:00`,
    ).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    const visible = issues.filter((issue) => !filter || issue.kind === filter);
    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Europe/Berlin",
    });
    const cells = editorialCalendarDays(month).map((date) => {
      const value = new Date(`${date}T12:00:00Z`);
      const events = visible
        .flatMap((issue) => {
          const marks = editorialMilestones(issue, date);
          if (
            !marks.length &&
            issue.starts_on <= date &&
            date <= issue.closes_on
          )
            return [
              `<button class="ed-period" data-issue="${esc(issue.id)}" title="${esc(issue.title)} · Redaktionszeitraum" aria-label="${esc(issue.title)} · Redaktionszeitraum am ${dateLabel(date)}">${esc(issue.title)}</button>`,
            ];
          return marks.map(
            ({ kind, label }) =>
              `<button class="ed-event ed-${kind}" data-issue="${esc(issue.id)}" title="${kindLabel(issue.kind)} · ${esc(issue.title)}"><strong>${label}</strong><span>${esc(issue.title)}</span></button>`,
          );
        })
        .join("");
      return `<div class="ed-day ${date.slice(0, 7) !== month ? "ed-outside" : ""} ${date === today ? "ed-today" : ""}"><time datetime="${date}">${value.getUTCDate()}</time>${events}</div>`;
    });
    $("#edCalendar").innerHTML =
      ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
        .map((day) => `<div class="ed-weekday">${day}</div>`)
        .join("") + cells.join("");
    $("#edCalendar")
      .querySelectorAll("[data-issue]")
      .forEach(
        (button) => (button.onclick = () => selectIssue(button.dataset.issue)),
      );
  }
  function issueList() {
    const visible = issues.filter((issue) => !filter || issue.kind === filter);
    $("#edIssues").innerHTML = visible.length
      ? visible
          .map(
            (issue) =>
              `<button class="ed-issue ${selected?.id === issue.id ? "selected" : ""}" data-issue="${esc(issue.id)}"><span class="editorial-eyebrow">${kindLabel(issue.kind)}</span><strong>${esc(issue.title)}</strong><span>${dateLabel(issue.publishes_on)} · ${issue.closes_on < new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }) ? "Redaktionsschluss erreicht" : "In Planung"}</span></button>`,
          )
          .join("")
      : '<p class="empty">Noch keine Ausgaben. Mit „Ausgabe anlegen“ beginnt euer Redaktionsplan.</p>';
    $("#edIssues")
      .querySelectorAll("[data-issue]")
      .forEach(
        (button) => (button.onclick = () => selectIssue(button.dataset.issue)),
      );
  }
  function articlePlan(manual, automatic) {
    const addActions = `<div class="toolbar ed-card-actions"><button id="edAddEvent" class="secondary">＋ Veranstaltung auswählen</button><button id="edAddArticle">＋ Beitrag hinzufügen</button></div>`;
    const teamFor = article => teams.find(team => team.id === article.team_id);
    const row = (article, label = coachLabel(article)) => `<button class="ed-article" data-article="${esc(article.id)}"><span><strong>${esc(label)}</strong><small>${article.kind === 'event' ? 'Veranstaltung' : article.kind === 'free' ? 'Freier Beitrag' : 'Feste Rubrik'}${article.department_id ? ' · ' + esc(departments.find(d => d.id === article.department_id)?.label || 'Abteilung') : ''}${article.author ? ' · ' + esc(article.author) : ''}</small></span><span class="ed-status ed-status-${article.status}">${article.automatic_sports ? article.status === 'ready' ? 'Automatisch freigegeben' : 'Datenabruf erforderlich' : statusLabel[article.status]}</span></button>`;
    const group = (id, title, entries, content, { automatic = false, nested = false } = {}) => {
      const ready = entries.filter(article => article.status === 'ready').length;
      const waived = entries.filter(article => article.kind === 'coach' && article.status === 'waived').length;
      const complete = entries.length > 0 && ready + waived === entries.length;
      const status = entries.length ? `${ready}/${entries.length} ${automatic ? 'automatisch freigegeben' : 'freigegeben'}` : 'Keine Beiträge';
      return `<details class="ed-plan-group ${nested ? 'ed-sports-group' : 'ed-plan-section'}" data-plan-group="${id}" aria-labelledby="${id}" ${expandedPlanGroups.has(`${selected.id}:${id}`) ? 'open' : ''}><summary><span class="ed-plan-group-heading"><strong id="${id}">${esc(title)}</strong><span class="ed-plan-group-status"><span class="ed-status ed-status-${complete ? 'ready' : 'draft'}">${status}</span>${waived ? `<span class="ed-status ed-status-waived">${waived} Verzicht</span>` : ''}</span></span></summary>${content}</details>`;
    };
    const list = (entries, empty, label) => `<div class="ed-article-list">${entries.map(article => row(article, label ? label(article) : coachLabel(article))).join('') || `<p class="empty">${empty}</p>`}</div>`;
    if (selected.kind !== 'stadium') return `<div id="edManualArticles">${group('edOtherHeading', 'Weitere Beiträge', manual, list(manual, 'Der Inhaltsplan ist noch frei. Füge den ersten Beitrag hinzu.') + addActions)}</div>`;
    const greetingRank = article => article.kind === 'board' ? 0 : article.kind === 'youth' ? 5 : article.kind === 'coach' ? ['herren-1','herren-2','frauen-1','frauen-2'].indexOf(teamFor(article)?.slug) + 1 || 99 : 99;
    const greetings = manual.filter(article => greetingRank(article) < 99).sort((a,b) => greetingRank(a) - greetingRank(b));
    const grouped = new Set(greetings.map(article => article.id));
    const sportEntries = [];
    const sports = ['herren','frauen'].map(teamGroup => {
      const entries = [...manual, ...automatic].filter(article => article.kind === 'sports' && teamFor(article)?.slug.startsWith(teamGroup + '-')).sort((a,b) => Number(teamFor(a).slug.split('-')[1]) - Number(teamFor(b).slug.split('-')[1]));
      if (!entries.length) return '';
      entries.forEach(article => grouped.add(article.id));
      sportEntries.push(...entries);
      return group(`edSport-${teamGroup}`, `Sport: Tabellen & Ergebnisse ${teamGroup === 'herren' ? 'Herren' : 'Frauen'}`, entries, list(entries, '', article => `${teamFor(article).slug.split('-')[1]}. Mannschaft`), { automatic: entries.every(article => article.automatic_sports), nested: true });
    }).join('');
    const youth = automatic.filter(article => !grouped.has(article.id)).sort((a,b) => (teamFor(a)?.sort_order ?? a.position) - (teamFor(b)?.sort_order ?? b.position));
    const remaining = manual.filter(article => !grouped.has(article.id));
    return `<div id="edManualArticles">${group('edGreetingsHeading', 'Grußworte', greetings, list(greetings, 'Noch keine Grußworte angelegt.'))}${group('edOtherHeading', 'Weitere Beiträge', remaining, list(remaining, 'Noch keine weiteren Beiträge angelegt.') + addActions)}</div>
      ${group('edSportHeading', 'Sport', sportEntries, (sports || '<p class="empty">Noch keine Sportbeiträge angelegt. Bitte Sportdaten aktualisieren.</p>') + '<p id="edSportsMessage" class="small" role="status"></p><div class="toolbar ed-card-actions"><button class="secondary" id="edSports">Sportdaten aktualisieren</button></div>', { automatic: sportEntries.every(article => article.automatic_sports) })}
      ${group('edYouthSportHeading', 'Sport kompakt (Jugend)', youth, `<p class="small">Tabellen und Ergebnisse werden beim Abruf automatisch freigegeben. Hier kannst du den gespeicherten Stand ansehen.</p>${list(youth, 'Noch keine Jugend-Sportdaten angelegt.', article => `Sport kompakt · ${(teamFor(article)?.name || article.title).replace(/^Sport(?: kompakt)?\s*[·:]\s*/i, '')}`)}`, { automatic: true })}`;
  }

  function coverCard() {
    const settings = editorialCoverDefaults(selected, articles);
    const field = (name, flag, label, max) => `<div class="ed-cover-field"><label class="ed-cover-check"><input type="checkbox" name="${flag}" ${settings[flag] ? 'checked' : ''}> ${label}</label><input name="${name}" aria-label="${label}" maxlength="${max}" value="${esc(settings[name])}" ${settings[flag] ? '' : 'disabled'}></div>`;
    const selectedArticles = new Map(settings.articles.map(item => [item.id,item.alias]));
    const choices = entries => entries.map(article => `<div class="ed-cover-choice"><label class="ed-cover-check"><input type="checkbox" data-cover-article="${esc(article.id)}" ${selectedArticles.has(article.id) ? 'checked' : ''}><span>${esc(coachLabel(article))}${article.status === 'waived' ? '<small>Verzicht · erscheint nicht im Heft</small>' : !article.body.trim() || article.kind === 'coach' && article.status !== 'ready' ? '<small>Erscheint erst mit einem verfügbaren Beitrag im Heft</small>' : ''}</span></label><input data-cover-alias="${esc(article.id)}" aria-label="Cover-Alias für ${esc(coachLabel(article))}" placeholder="Alias (optional)" maxlength="100" value="${esc(selectedArticles.get(article.id) || '')}" ${selectedArticles.has(article.id) ? '' : 'disabled'}></div>`).join('') || '<p class="small">Noch keine Beiträge vorhanden.</p>';
    const greetings = articles.filter(article => ['board','youth','coach'].includes(article.kind));
    const other = articles.filter(article => ['free','event'].includes(article.kind));
    const activeTeams = teams.filter(team => team.active !== false && /^(herren|frauen)-[1-9][0-9]*$/.test(team.slug || ''));
    return `<details class="ed-context-card ed-plan-group" id="edCoverCard" data-plan-group="edCoverHeading" aria-labelledby="edCoverHeading" ${expandedPlanGroups.has(`${selected.id}:edCoverHeading`) ? 'open' : ''}><summary><strong id="edCoverHeading">Titelblatt</strong></summary><p class="small">Wähle die Angaben und Verweise für das Cover. Beiträge und Spiele führen beim Anklicken direkt zur passenden Heftseite.</p>
      <form id="edCoverSettingsForm"><div class="ed-cover-fields">${field('number','showNumber','Heft-/Ausgabenummer',20)}${field('headline','showHeadline','Überschrift auf dem Cover',180)}${field('namePart1','showNamePart1','Großer Name · Teil 1',40)}${field('namePart2','showNamePart2','Großer Name · Teil 2',40)}<div class="ed-cover-field"><label class="ed-cover-check"><input type="checkbox" name="showDate" ${settings.showDate ? 'checked' : ''}> Erscheinungsdatum</label><span>${dateLabel(selected.publishes_on)}</span><small>Änderbar unter „Planung & Termine“.</small></div></div>
      <details class="ed-cover-selection"><summary>Beiträge auf dem Titelblatt</summary>${choices(other)}</details>
      <details class="ed-cover-selection"><summary>Grußworte auf dem Titelblatt</summary>${choices(greetings)}</details>
      <details class="ed-cover-selection"><summary>Spiele der aktiven Mannschaften</summary><p class="small">Je Mannschaft wird das nächste Spiel aus dem gespeicherten Sportdatenstand angekündigt.</p>${activeTeams.map(team => `<label class="ed-cover-check"><input type="checkbox" data-cover-team="${esc(team.slug)}" ${settings.teamSlugs === null || settings.teamSlugs.includes(team.slug) ? 'checked' : ''}>${esc(team.name)}</label>`).join('')}</details>
      <p id="edCoverSettingsMessage" class="small" role="status"></p><div class="toolbar ed-card-actions"><button type="submit">Titelblatt speichern</button></div></form>
      <details class="ed-cover-settings" data-plan-group="edCoverImage" ${expandedPlanGroups.has(`${selected.id}:edCoverImage`) ? 'open' : ''}><summary>Titelbild & Bildnachweis</summary><form id="edCoverForm" class="fields">${selected.cover_url ? `<img class="ed-cover-thumb" src="${esc(selected.cover_url)}" alt="${esc(selected.cover_alt || 'Aktuelles Titelbild')}">` : ''}<label class="wide">Titelbild (JPG, PNG, WebP · bis 5 MB)<input id="edCoverFile" type="file" accept="image/jpeg,image/png,image/webp" ${selected.cover_path || selected.cover_url ? '' : 'required'}></label><label>Bildbeschreibung<input name="alt" maxlength="300" value="${esc(selected.cover_alt || selected.title)}" required></label><label>Bildnachweis<input name="credit" maxlength="300" value="${esc(selected.cover_credit || '')}" placeholder="Foto: …"></label><p class="wide small" id="edCoverMessage" role="status"></p><div class="wide toolbar ed-card-actions"><button type="submit" id="edSaveCoverImage">${selected.cover_path || selected.cover_url ? 'Bildangaben speichern' : 'Titelbild speichern'}</button></div></form></details></details>`;
  }
  function canLeaveCover() {
    if (!coverDirty) return true;
    $('#edCoverCard').open = true;
    $('#edCoverSettingsMessage').textContent = 'Bitte zuerst die Änderungen am Titelblatt speichern.';
    $('#edCoverSettingsForm button[type=submit]').focus();
    return false;
  }
  function wireCoverSettings() {
    const form = $('#edCoverSettingsForm');
    if (!form) return;
    const syncFields = () => {
      for (const [name,flag] of [['number','showNumber'],['headline','showHeadline'],['namePart1','showNamePart1'],['namePart2','showNamePart2']]) form.elements[name].disabled = !form.elements[flag].checked;
      for (const checkbox of form.querySelectorAll('[data-cover-article]')) form.querySelector(`[data-cover-alias="${CSS.escape(checkbox.dataset.coverArticle)}"]`).disabled = !checkbox.checked;
    };
    form.oninput = () => { coverDirty = true; syncFields(); $('#edCoverSettingsMessage').textContent = 'Ungespeicherte Änderungen am Titelblatt.'; };
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      const settings = {};
      for (const name of ['number','headline','namePart1','namePart2']) settings[name] = form.elements[name].value;
      for (const name of ['showNumber','showHeadline','showNamePart1','showNamePart2','showDate']) settings[name] = form.elements[name].checked;
      settings.articles = [...form.querySelectorAll('[data-cover-article]:checked')].map(checkbox => ({id:checkbox.dataset.coverArticle,alias:form.querySelector(`[data-cover-alias="${CSS.escape(checkbox.dataset.coverArticle)}"]`).value}));
      settings.teamSlugs = [...form.querySelectorAll('[data-cover-team]:checked')].map(checkbox => checkbox.dataset.coverTeam);
      lock(form,true);
      try {
        await call('save_cover_settings',{issueId:selected.id,version:selected.version,settings});
        coverDirty = false;
        await refresh();
        $('#edCoverSettingsMessage').textContent = 'Titelblatt gespeichert. Bitte die aktualisierte Heftvorschau prüfen.';
      } catch (error) { $('#edCoverSettingsMessage').textContent = error.message; }
      finally { lock(form,false); syncFields(); }
    };
  }

  function detail() {
    if (!selected) return;
    const release = editorialReleaseState(selected, articles);
    const manual = articles.filter(article => !article.automatic_sports);
    const automatic = articles.filter(article => article.automatic_sports);
    const ready = manual.filter(
      (article) => article.status === "ready",
    ).length;
    const waived = manual.filter(article => article.kind === "coach" && article.status === "waived").length;
    $("#edDetail").innerHTML =
      `<div class="list-heading"><div><span class="editorial-eyebrow">${kindLabel(selected.kind)}</span><h3>${esc(selected.title)}</h3></div></div>
      <section class="ed-context-card" id="edPublicationCard"><h4>Vorschau & Veröffentlichung</h4><div class="ed-progress"><progress max="${Math.max(1, manual.length)}" value="${ready + waived}" aria-label="Erledigte Beiträge"></progress><span>${ready + waived} von ${manual.length} redaktionellen Beiträgen erledigt · ${ready} freigegeben${waived ? ` · ${waived} Verzicht` : ''}</span></div><div class="ed-release" role="status"><strong>${release.currentPublication ? 'Veröffentlicht' : selected.published_at ? 'Neue Fassung in Bearbeitung' : release.ready ? 'Bereit für Veröffentlichung' : 'In Bearbeitung'}</strong><p>${release.pending ? release.pending + ' Beiträge warten auf Freigabe. ' : ''}${release.automaticPending ? release.automaticPending + ' Sportübersichten benötigen einen Datenabruf. ' : ''}${release.missingCover ? 'Ein Titelbild fehlt noch. ' : ''}${!release.reviewed ? 'Bitte vor Veröffentlichung die aktuelle Vorschau prüfen.' : ''}</p><p class="small">Termine steuern die Planung. Veröffentlicht wird nur über den Button.</p></div>
      ${selected.kind === 'stadium' ? `<p class="small" id="edAdvertisingStatus">${selected.advertising ? `${selected.advertising.ads.length} Sponsorenanzeigen übernommen. ` : 'Die Sponsorenanzeigen werden beim Öffnen der Vorschau übernommen. '}Freigegebene Anzeigen mit gültiger Laufzeit werden im Heft verteilt.</p>` : ''}
      ${selected.published_at ? `<p><a target="_blank" rel="noopener" href="/stadionheft/${encodeURIComponent(selected.id)}">Veröffentlichte Ausgabe öffnen</a></p>` : ''}<div class="toolbar ed-publication-actions ed-card-actions"><button class="ghost" id="edExport">Texte exportieren</button><button id="edPreviewIssue" class="secondary">${selected.kind === 'stadium' ? 'Heft' : 'Ausgabe'} vorab ansehen</button>${selected.kind === 'stadium' ? `<button id="edPublishIssue" class="primary-action" ${release.canPublish ? '' : 'disabled'}>${selected.published_at ? 'Neue Fassung veröffentlichen' : 'Heft veröffentlichen'}</button>` : ''}</div></section>
      ${selected.kind === 'stadium' ? coverCard() : ''}
      <details class="ed-context-card ed-plan-group" id="edPlanningCard" data-plan-group="edPlanningCard" ${expandedPlanGroups.has(`${selected.id}:edPlanningCard`) ? 'open' : ''}><summary><strong>Planung & Termine</strong></summary><div class="ed-timeline"><span><small>Start</small>${dateLabel(selected.starts_on)}</span><span><small>Schluss</small>${dateLabel(selected.closes_on)}</span><span><small>Erscheinung</small>${dateLabel(selected.publishes_on)}</span></div><div class="toolbar ed-card-actions"><button class="ghost" id="edEditIssue">Termine bearbeiten</button></div></details>
      ${articlePlan(manual, automatic)}`;
    wireCoverSettings();
    $("#edDetail").querySelectorAll('[data-plan-group]').forEach(group => {
      const key = `${selected.id}:${group.dataset.planGroup}`;
      group.ontoggle = () => group.open ? expandedPlanGroups.add(key) : expandedPlanGroups.delete(key);
    });
    wirePublicationActions();
    $("#edEditIssue").onclick = () => openIssue(selected);
    $("#edAddArticle").onclick = () => openArticle(null);
    $("#edDetail")
      .querySelectorAll("[data-article]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            openArticle(articles.find((a) => a.id === button.dataset.article))),
      );
    if ($("#edSports")) $("#edSports").onclick = refreshSports;
    $("#edExport").onclick = () => {
      const content = [
        selected.title,
        `${kindLabel(selected.kind)} · ${dateLabel(selected.publishes_on)}`,
        ...articles.map(
          (a) =>
            `\n${a.title}\n${a.author ? a.author + "\n" : ""}[${statusLabel[a.status]}]\n\n${a.body}`,
        ),
      ].join("\n");
      const url = URL.createObjectURL(
        new Blob([content], { type: "text/plain;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selected.kind}-${selected.publishes_on}.txt`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }
  async function selectIssue(id, force = false) {
    if (!force && (busy || !canLeaveCover())) return;
    const request = ++selectionRequest;
    const next = issues.find((issue) => issue.id === id);
    if (!next) return;
    $("#edDetail").innerHTML =
      '<p class="empty" role="status">Beiträge werden geladen …</p>';
    try {
      const result = await call("articles", { issueId: id });
      if (request !== selectionRequest) return;
      selected = next;
      articles = result.articles;
      issueList();
      detail();
    } catch (error) {
      if (request === selectionRequest)
        $("#edDetail").textContent = error.message;
    }
  }
  async function refresh() {
    const data = await call("list");
    issues = data.issues;
    departments = data.departments;
    teams = data.teams || [];
    people = data.people || [];
    rewriteAvailable = data.rewriteAvailable;
    loaded = true;
    calendar();
    issueList();
    if (selected && issues.some((i) => i.id === selected.id))
      await selectIssue(selected.id, true);
    else if (issues.length) await selectIssue(issues[0].id, true);
  }
  function openIssue(issue = null) {
    if (busy || !canLeaveCover()) return;
    editingIssue = issue;
    const form = $("#edIssueForm");
    form.reset();
    $("#edIssueMessage").textContent = "";
    $("#edIssueHeading").textContent = issue
      ? "Ausgabe bearbeiten"
      : "Ausgabe anlegen";
    form.elements.kind.disabled = Boolean(issue);
    if (issue)
      for (const key of [
        "kind",
        "title",
        "starts_on",
        "closes_on",
        "publishes_on",
      ])
        form.elements[key].value = issue[key];
    else {
      const today = new Date().toLocaleDateString("sv-SE", {
        timeZone: "Europe/Berlin",
      });
      form.elements.starts_on.value = today;
    }
    dirty = false;
    $("#edIssueDialog").showModal();
  }
  function hydrateArticle(article) {
    editing = article;
    $("#edDeleteArticle").classList.toggle("hidden", !article?.id || !editorialCanDeleteArticle(article, teams.find(team => team.id === article.team_id)));
    const form = $("#edArticleForm");
    const automatic = Boolean(article?.automatic_sports);
    $("#edArticleHeading").textContent = automatic ? 'Sportdaten ansehen' : article?.kind === 'coach' ? coachLabel(article) : 'Beitrag bearbeiten';
    for (const key of ['title', 'author', 'body']) form.elements[key].readOnly = automatic;
    form.elements.department_id.disabled = automatic;
    $("#edSaveArticle").classList.toggle('hidden', automatic);
    $("#edApproveArticle").classList.toggle('hidden', automatic);
    for (const key of ["title", "author", "body", "status", "department_id"])
      form.elements[key].value =
        article?.[key] ?? (key === "status" ? "draft" : "");
    $("#edApprovalStatus").textContent =
      automatic ? (article.status === 'ready' ? 'Automatisch freigegeben' : 'Datenabruf erforderlich') : statusLabel[article?.status || 'draft'];
    $("#edHistory").disabled = !article?.id;
    $("#edRetryRewrite").classList.toggle(
      "hidden",
      !article?.id || article.kind === "sports",
    );
    $("#edSource").textContent = article?.source_snapshot
      ? `Datenabruf: ${new Date(article.source_snapshot.fetchedAt).toLocaleString("de-DE")}. Tabelle, letzte Partie und nächste Spiele. Jugend kompakt. ${article.source_snapshot.warning || ""}`
      : "";
    $("#edSaveArticle").textContent =
      article?.kind === "sports"
        ? "Beitrag speichern"
        : "Speichern & überarbeiten";
    $("#edRewriteHint").textContent =
      article?.status === "waived" ? "Verzicht: Für diesen Trainerbeitrag wird kein weiterer Text erwartet. Er erscheint nicht im Heft. Ein vorhandener Entwurf bleibt erhalten. Zum Bearbeiten den Verzicht aufheben." : automatic ? "Diese Sportübersicht wird automatisch erzeugt und freigegeben. Änderungen erfolgen über „Sportdaten aktualisieren“." : article?.kind === "sports"
        ? "Sportdaten bleiben unverändert durch KI. Der Abruf ersetzt den Beitrag mit einem neuen Quellenstand. Die nächsten Spiele der Aktiven erscheinen auch auf dem Titelblatt."
        : rewriteAvailable
          ? "Beim Speichern werden Rechtschreibung und Lesefluss automatisch verbessert. Das Original bleibt im Verlauf. Überarbeitete Texte stehen anschließend auf „In Prüfung“."
          : "Die KI-Überarbeitung ist noch nicht eingerichtet. Deine Texte werden trotzdem gespeichert; Original und Verlauf bleiben erhalten.";
    const candidates = editorialPersonCandidates(article, people);
    const chosen = article?.people_snapshot || [];
    form.elements.author.readOnly = automatic || chosen.length > 0;
    $('#edPersonSelection').hidden = !['board', 'youth', 'coach'].includes(article?.kind);
    const options = [...candidates];
    for (const person of chosen) if (!options.some(candidate => candidate.id === person.person_id)) options.push({ id: person.person_id, display_name: person.name, role: person.role + ' · Zuordnung nicht mehr verfügbar', unavailable: true });
    $('#edPersonCandidates').innerHTML = options.map(person => `<label class="ed-person-option"><input type="checkbox" name="person_ids" value="${esc(person.id)}" ${chosen.some(saved => saved.person_id === person.id) ? 'checked' : ''}><span><strong>${esc(person.display_name)}</strong><small>${esc(person.role)}${person.photo_url ? '' : ' · Kein Bild hinterlegt'}</small></span></label>`).join('') || '<p class="small">Für diese Funktion ist noch keine Person im Katalog zugeordnet.</p>';
    editingGalleries = structuredClone(article?.gallery_groups || []);
    $("#edGalleryEditor").hidden = Boolean(article && article.kind !== "free");
    renderGalleryEditor();
    dirty = false;
    updateApprovalButton();
    wordCount();
  }
  function renderGalleryEditor() {
    $('#edGalleryGroups').innerHTML = editingGalleries.map((group,index)=>`<section class="ed-gallery-group" data-group="${esc(group.id)}"><div class="toolbar"><label>Gruppentitel<input data-group-title maxlength="180" value="${esc(group.title)}" placeholder="Zum Beispiel: Sommerfest – Spiele"></label><button type="button" class="ghost" data-remove-group>Gruppe entfernen</button></div><div class="ed-gallery-images">${group.images.map(image=>`<div class="ed-gallery-image" data-image="${esc(image.id)}"><img src="${esc(image.dataUrl || image.photo_url || '')}" alt="${esc(image.alt)}"><label><input type="radio" name="gallery-cover-${index}" value="${esc(image.id)}" data-gallery-cover ${group.cover_id===image.id?'checked':''}> Titelbild</label><label>Bildbeschreibung<input data-image-alt maxlength="300" value="${esc(image.alt)}"></label><button type="button" class="ghost" data-remove-image>Bild entfernen</button></div>`).join('')}</div></section>`).join('');
    $('#edGalleryFiles').value='';
  }
  $('#edGalleryGroups').addEventListener('input',event=>{
    const group=editingGalleries.find(g=>g.id===event.target.closest('[data-group]')?.dataset.group);
    if(!group)return;
    if(event.target.matches('[data-group-title]'))group.title=event.target.value;
    if(event.target.matches('[data-gallery-cover]'))group.cover_id=event.target.value;
    if(event.target.matches('[data-image-alt]'))group.images.find(image=>image.id===event.target.closest('[data-image]').dataset.image).alt=event.target.value;
  });
  $('#edGalleryGroups').addEventListener('click',event=>{
    const button=event.target.closest('[data-remove-group],[data-remove-image]');
    if(!button || busy)return;
    const group=editingGalleries.find(g=>g.id===button.closest('[data-group]').dataset.group);
    if(button.hasAttribute('data-remove-group'))editingGalleries=editingGalleries.filter(g=>g!==group);
    else {
      group.images=group.images.filter(image=>image.id!==button.closest('[data-image]').dataset.image);
      if(!group.images.length)editingGalleries=editingGalleries.filter(g=>g!==group);
      else if(!group.images.some(image=>image.id===group.cover_id))group.cover_id=group.images[0].id;
    }
    dirty=true;renderGalleryEditor();updateApprovalButton();
  });
  $('#edGalleryFiles').addEventListener('change',async event=>{
    const files=[...event.target.files];
    if(!files.length)return;
    const form=$('#edArticleForm');lock(form,true);
    $('#edArticleMessage').textContent='Bilder werden vorbereitet …';
    try {
      if(editingGalleries.length>=6 || files.length>20)throw new Error('Bis zu sechs Gruppen mit jeweils höchstens 20 Bildern möglich.');
      const images=[];
      for(const file of files){
        if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>5*1024*1024)throw new Error('Bitte JPG, PNG oder WebP bis 5 MB je Bild auswählen.');
        const bitmap=await createImageBitmap(file),scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
        images.push({id:crypto.randomUUID(),alt:file.name.replace(/\.[^.]+$/,''),dataUrl:canvas.toDataURL('image/jpeg',0.86)});
      }
      editingGalleries.push({id:crypto.randomUUID(),title:'',cover_id:images[0].id,images});
      dirty=true;renderGalleryEditor();$('#edArticleMessage').textContent='Bildgruppe vorbereitet. Titelbild auswählen und Beitrag speichern.';
    } catch(error){$('#edArticleMessage').textContent=error.message;}
    finally{lock(form,false);updateApprovalButton();event.target.value='';}
  });
  function openArticle(article) {
    if (busy || !canLeaveCover()) return;
    dictation.reset();
    $("#edArticleForm").reset();
    $("#edArticleMessage").textContent = "";
    $("#edRevisionList").innerHTML = "";
    $("#edArticleForm").elements.department_id.innerHTML =
      '<option value="">Vereinsweit / ohne Abteilung</option>' +
      departments
        .map((d) => `<option value="${esc(d.id)}">${esc(d.label)}</option>`)
        .join("");
    hydrateArticle(article);
    $("#edArticleDialog").showModal();
  }
  function wordCount() {
    const text = $("#edArticleForm").elements.body.value.trim();
    $("#edWordCount").textContent =
      `${text ? text.split(/\s+/).length : 0} Wörter · ${text.length} Zeichen`;
  }
  function canLeave() {
    if (!canLeaveCover()) return false;
    if (dictation.active) { dictation.stop(); show("Diktat wird beendet. Bitte danach den Text speichern oder den Editor schließen."); return false; }
    if (busy) {
      show("Bitte den laufenden Speichervorgang abwarten.");
      return false;
    }
    if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?"))
      return false;
    dirty = false;
    $("#edArticleDialog").close();
    $("#edIssueDialog").close();
    $("#edEventDialog").close();
    return true;
  }
  function lock(form, value) {
    busy = value;
    form
      .querySelectorAll("input,textarea,select,button")
      .forEach((node) => (node.disabled = value));
  }
  $("#edIssueForm").oninput = () => (dirty = true);
  $("#edArticleForm").oninput = () => {
    dirty = true;
    updateApprovalButton();
    wordCount();
  };
  $('#edPersonCandidates').onchange = () => {
    const ids = [...$('#edPersonCandidates').querySelectorAll('input:checked')].map(input => input.value);
    const names = ids.map(id => people.find(person => person.id === id)?.display_name).filter(Boolean);
    $('#edArticleForm').elements.author.value = names.join(' & ');
    $('#edArticleForm').elements.author.readOnly = ids.length > 0;
  };
  $("#edArticleClose").onclick = canLeave;
  $("#edIssueClose").onclick = canLeave;
  for (const dialog of [$("#edArticleDialog"), $("#edIssueDialog")])
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      canLeave();
    });
  window.addEventListener("beforeunload", (event) => {
    if (dirty || busy) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  $("#edIssueForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form));
    payload.kind = editingIssue?.kind || payload.kind;
    if (
      payload.starts_on > payload.closes_on ||
      payload.closes_on > payload.publishes_on
    ) {
      $("#edIssueMessage").textContent =
        "Bitte Start, Schluss und Erscheinung in dieser Reihenfolge angeben.";
      return;
    }
    lock(form, true);
    $("#edIssueMessage").textContent = "Ausgabe wird gespeichert …";
    try {
      const result = await call("save_issue", {
        ...payload,
        id: editingIssue?.id,
        version: editingIssue?.version,
      });
      dirty = false;
      selected = result.issue;
      month = selected.publishes_on.slice(0, 7);
      $("#edIssueDialog").close();
      lock(form, false);
      await refresh();
      show("Ausgabe gespeichert.");
    } catch (error) {
      $("#edIssueMessage").textContent = error.message;
    } finally {
      lock(form, false);
      form.elements.kind.disabled = Boolean(editingIssue);
    }
  };
  $("#edArticleForm").onsubmit = async (event) => {
    event.preventDefault();
    if (editing?.automatic_sports || editing?.status === "waived") return;
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form));
    if (!editing || editing.kind === "free") payload.gallery_groups = editingGalleries;
    payload.person_ids = new FormData(form).getAll('person_ids');
    payload.rewrite = event.submitter?.dataset.rewrite === "true";
    if (dirty || payload.rewrite) payload.status = "review";
    lock(form, true);
    $("#edArticleMessage").textContent =
      "Text wird gespeichert und gegebenenfalls überarbeitet …";
    try {
      const result = await call("save_article", {
        ...payload,
        id: editing?.id,
        version: editing?.version,
        issueId: selected.id,
      });
      hydrateArticle(result.article);
      articles = articles
        .filter((a) => a.id !== result.article.id)
        .concat(result.article)
        .sort((a, b) => a.position - b.position);
      await refresh();
      $("#edArticleMessage").textContent =
        result.warning ||
        (result.rewritten
          ? "Gespeichert und sprachlich überarbeitet. Das Original ist im Verlauf erhalten."
          : "Beitrag gespeichert.");
    } catch (error) {
      $("#edArticleMessage").textContent = error.message;
    } finally {
      lock(form, false);
      $("#edHistory").disabled = !editing?.id;
      updateApprovalButton();
    }
  };
  $("#edHistory").onclick = async () => {
    try {
      const { revisions } = await call("revisions", { id: editing.id });
      $("#edRevisionList").innerHTML =
        `<details open><summary>Original der aktuellen Fassung</summary><pre>${esc(editing.original_body)}</pre></details>` +
        revisions
          .map(
            (r) =>
              `<details><summary>Version ${r.version} · ${new Date(r.created_at).toLocaleString("de-DE")}</summary><pre>${esc(r.snapshot.body)}</pre></details>`,
          )
          .join("");
    } catch (error) {
      $("#edArticleMessage").textContent = error.message;
    }
  };
  async function refreshSports() {
    if (busy || !canLeaveCover()) return;
    let sports = articles.filter((a) => a.kind === "sports");
    if (
      sports.some((a) => a.body) &&
      !window.confirm(
        "Sportdaten für die Aktiven und A–D-Jugend mit aktuellen Tabellen, letzter Partie und nächsten Spielen neu erzeugen? Bisherige Texte bleiben im Verlauf. Alle Sportdaten werden bei erfolgreichem Abruf automatisch freigegeben.",
      )
    )
      return;
    busy = true;
    root
      .querySelectorAll("button")
      .forEach((button) => (button.disabled = true));
    $("#edCoverSettingsForm")?.querySelectorAll("input,button").forEach(node => node.disabled = true);
    const warnings = [];
    try {
      const prepared = await call("prepare_sports", { issueId: selected.id });
      sports = prepared.articles;
      for (let index = 0; index < sports.length; index++) {
        const article = sports[index];
        $("#edSportsMessage").textContent =
          `Sportdaten ${index + 1}/${sports.length}: ${article.title}`;
        try {
          const result = await call("sports", {
            id: article.id,
            version: article.version,
          });
          articles = articles.map((a) =>
            a.id === article.id ? result.article : a,
          );
          if (result.warning)
            warnings.push(`${article.title}: ${result.warning}`);
        } catch (error) {
          warnings.push(`${article.title}: ${error.message}`);
        }
      }
    } catch (error) {
      warnings.push(error.message);
    } finally {
      busy = false;
      root
        .querySelectorAll("button")
        .forEach((button) => (button.disabled = false));
      await refresh();
      $("#edSportsMessage").textContent = warnings.length
        ? `Abruf beendet. ${warnings.join(" · ")}`
        : "Tabellen, letzte Partien und nächste Spiele aktualisiert und automatisch freigegeben.";
    }
  }
  function updateApprovalButton() {
    const waived = editing?.status === 'waived';
    $('#edHistory').disabled = busy || !editing?.id;
    $('#edDictation').hidden = Boolean(editing?.automatic_sports || waived);
    dictation.setEnabled(!editing?.automatic_sports && !waived && (!busy || dictation.active));
    $('#edWaiveArticle').classList.toggle('hidden', editing?.kind !== 'coach');
    $('#edWaiveArticle').textContent = waived ? 'Verzicht aufheben' : 'Verzicht';
    $('#edWaiveArticle').disabled = busy || dirty || !editing?.id;
    $('#edWaiveArticle').title = dirty ? 'Bitte Änderungen zuerst speichern.' : 'Für dieses Grußwort wird kein weiterer Text erwartet; es erscheint nicht im Heft.';
    if (editing?.kind === 'coach') {
      for (const key of ['title', 'body']) $('#edArticleForm').elements[key].readOnly = waived;
      $('#edArticleForm').elements.author.readOnly = waived || Boolean(editing.people_snapshot?.length);
      $('#edArticleForm').elements.department_id.disabled = busy || waived;
      $('#edPersonSelection').disabled = busy || waived;
      for (const selector of ['#edSaveArticle','#edRetryRewrite','#edApproveArticle']) $(selector).classList.toggle('hidden', waived);
    } else $('#edPersonSelection').disabled = false;

    $("#edApproveArticle").disabled =
      busy ||
      editing?.automatic_sports ||
      dirty ||
      !editing?.id ||
      !editing.body.trim() ||
      editing.status === "ready" ||
      waived;
    $("#edApproveArticle").textContent =
      editing?.status === "ready" && !dirty
        ? "✓ Freigegeben"
        : "Beitrag freigeben";
    $("#edApproveArticle").title = dirty
      ? "Bitte Änderungen zuerst speichern und die Fassung prüfen."
      : "";
  }
  $('#edWaiveArticle').onclick = async () => {
    if (busy || dirty || editing?.kind !== 'coach') return;
    const form = $('#edArticleForm');
    lock(form, true);
    try {
      const result = await call('waive_article', {id: editing.id, version: editing.version, waived: editing.status !== 'waived'});
      hydrateArticle(result.article);
      await refresh();
      $('#edArticleMessage').textContent = result.article.status === 'waived'
        ? 'Verzicht gespeichert. Der Beitrag ist erledigt und erscheint nicht im Heft.'
        : 'Verzicht aufgehoben. Der Beitrag wartet wieder auf Bearbeitung und Freigabe.';
    } catch (error) { $('#edArticleMessage').textContent = error.message; }
    finally { lock(form, false); updateApprovalButton(); }
  };
  $("#edApproveArticle").onclick = async () => {
    if (dirty || !editing || editing.automatic_sports || editing.status === "waived") return;
    const form = $("#edArticleForm");
    lock(form, true);
    try {
      const result = await call("approve_article", {
        id: editing.id,
        version: editing.version,
      });
      hydrateArticle(result.article);
      await refresh();
      $("#edArticleMessage").textContent =
        "Diese Fassung ist freigegeben. Weitere Änderungen erfordern eine neue Freigabe.";
    } catch (error) {
      $("#edArticleMessage").textContent = error.message;
    } finally {
      lock(form, false);
      updateApprovalButton();
    }
  };
  $("#edDeleteArticle").onclick = async () => {
    if (
      busy || !editing?.id || !editorialCanDeleteArticle(editing, teams.find(team => team.id === editing.team_id)) ||
      !window.confirm(
        `„${editing.title}“ aus dem Entwurf löschen? Der Beitrag und sein Verlauf werden entfernt${editing.kind === "event" ? ", ebenso die Ankündigung auf dem Cover" : ""}. Eine bereits veröffentlichte Ausgabe bleibt unverändert.`,
      )
    )
      return;
    const form = $("#edArticleForm");
    lock(form, true);
    try {
      await call("delete_article", { id: editing.id, version: editing.version });
      dictation.reset();
      editing = null;
      editingGalleries = [];
      dirty = false;
      $("#edArticleDialog").close();
      await refresh();
    } catch (error) {
      $("#edArticleMessage").textContent = error.message;
    } finally {
      lock(form, false);
      updateApprovalButton();
    }
  };
  let eventChoices = [],
    previewUrl = null;
  $("#edEventForm").oninput = () => (dirty = true);
  $("#edEventClose").onclick = canLeave;
  $("#edEventDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    canLeave();
  });
  $("#edEventSource").onchange = (event) => {
    const selectedEvent = eventChoices.find(
      (item) => item.source_id === event.target.value,
    );
    const form = $("#edEventForm");
    for (const name of ["title", "date", "time", "location", "description"])
      form.elements[name].value = selectedEvent?.[name] || "";
    dirty = true;
  };
  $("#edEventForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = {
      ...Object.fromEntries(new FormData(form)),
      source_id: $("#edEventSource").value || null,
    };
    lock(form, true);
    try {
      await call("add_event", { issueId: selected.id, event: values });
      dirty = false;
      $("#edEventDialog").close();
      await refresh();
      show(
        "Veranstaltung aufgenommen. Bitte den zugehörigen Beitrag prüfen und freigeben.",
      );
    } catch (error) {
      $("#edEventMessage").textContent = error.message;
    } finally {
      lock(form, false);
    }
  };
  function closePreview() {
    $("#edPreviewDialog").close();
    $("#edMagazineFrame").removeAttribute("src");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  }
  $("#edPreviewClose").onclick = closePreview;
  $("#edPreviewDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closePreview();
  });
  function wirePublicationActions() {
    $("#edAddEvent").onclick = async () => {
      if (busy || !canLeaveCover()) return;
      const form = $("#edEventForm");
      form.reset();
      $("#edEventMessage").textContent = "";
      dirty = false;
      $("#edEventDialog").showModal();
      try {
        const result = await call("events");
        eventChoices = result.events;
        $("#edEventSource").innerHTML =
          '<option value="">Eigene Veranstaltung</option>' +
          eventChoices
            .map(
              (item) =>
                `<option value="${esc(item.source_id)}">${esc(item.title)} · ${dateLabel(item.date)}${item.recurring ? " · wiederkehrend" : ""}</option>`,
            )
            .join("");
      } catch (error) {
        $("#edEventMessage").textContent =
          "Vorhandene Termine konnten nicht geladen werden. Eigene Veranstaltungen können weiterhin angelegt werden.";
      }
    };
    if ($('#edCoverFile')) $('#edCoverFile').onchange = () => {
      $('#edSaveCoverImage').textContent = $('#edCoverFile').files.length ? 'Titelbild & Bildangaben speichern' : selected.cover_path || selected.cover_url ? 'Bildangaben speichern' : 'Titelbild speichern';
    };
    if ($("#edCoverForm"))
      $("#edCoverForm").onsubmit = async (event) => {
        event.preventDefault();
        if (busy || !canLeaveCover()) return;
        const form = event.currentTarget,
          file = $("#edCoverFile").files[0];
        if (file && (
          !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
          file.size > 5 * 1024 * 1024
        )) {
          $("#edCoverMessage").textContent =
            "Bitte JPG, PNG oder WebP bis 5 MB auswählen.";
          return;
        }
        const fields = Object.fromEntries(new FormData(form));
        lock(form, true);
        try {
          const dataUrl = file ? await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () =>
              reject(new Error("Bild konnte nicht gelesen werden."));
            reader.readAsDataURL(file);
          }) : undefined;
          await call("cover", {
            issueId: selected.id,
            version: selected.version,
            dataUrl,
            alt: fields.alt,
            credit: fields.credit,
          });
          await refresh();
          $("#edCoverMessage").textContent = file ? "Titelbild und Bildangaben gespeichert." : "Bildbeschreibung und Bildnachweis gespeichert.";
          show($("#edCoverMessage").textContent);
        } catch (error) {
          $("#edCoverMessage").textContent = error.message;
        } finally {
          lock(form, false);
        }
      };
    $("#edPreviewIssue").onclick = async () => {
      if (busy || !canLeaveCover()) return;
      busy = true;
      $("#edPreviewIssue").disabled = true;
      try {
        const result = await call("preview_issue", {
          issueId: selected.id,
          version: selected.version,
        });
        const html = renderEditorialMagazine(result.snapshot, true);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(
          new Blob([html], { type: "text/html" }),
        );
        $("#edMagazineFrame").src = previewUrl;
        $("#edPreviewDialog").showModal();
        await refresh();
      } catch (error) {
        show(error.message, true);
      } finally {
        busy = false;
        if ($("#edPreviewIssue")) $("#edPreviewIssue").disabled = false;
      }
    };
    if ($("#edPublishIssue"))
      $("#edPublishIssue").onclick = async () => {
        if (busy || !canLeaveCover()) return;
        if (
          !window.confirm(
            "Diese geprüfte Heftfassung jetzt veröffentlichen? Die Ausgabe ist anschließend über ihren Leselink erreichbar.",
          )
        )
          return;
        busy = true;
        $("#edPublishIssue").disabled = true;
        try {
          const result = await call("publish_issue", {
            issueId: selected.id,
            version: selected.version,
          });
          await refresh();
          show(
            result.demo
              ? "Heft lokal in der Vorschau veröffentlicht."
              : "Heft veröffentlicht. Der Leselink ist jetzt verfügbar.",
          );
        } catch (error) {
          show(error.message, true);
        } finally {
          busy = false;
          detail();
        }
      };
  }

  $("#edNewIssue").onclick = () => openIssue();
  $("#edFilter").onchange = (event) => {
    filter = event.target.value;
    calendar();
    issueList();
  };
  function moveMonth(delta) {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + delta);
    month = date.toISOString().slice(0, 7);
    calendar();
  }
  $("#edPrev").onclick = () => moveMonth(-1);
  $("#edNext").onclick = () => moveMonth(1);
  $("#edToday").onclick = () => {
    month = new Date()
      .toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" })
      .slice(0, 7);
    calendar();
  };
  calendar();
  return {
    canLeave,
    async open() {
      if (busy || !canLeaveCover()) return;
      try {
        await refresh();
      } catch (error) {
        show(`Redaktion konnte nicht geladen werden: ${error.message}`, true);
        if (!loaded)
          $("#edIssues").textContent =
            "Die Redaktion ist noch nicht verfügbar. Bitte wende dich an die Administration.";
      }
    },
  };
}
