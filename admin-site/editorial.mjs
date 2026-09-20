export function createEditorialWorkspace(
  root,
  { api, esc, show, editorialCalendarDays, editorialMilestones },
) {
  let issues = [],
    departments = [],
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
    busy = false,
    selectionRequest = 0,
    rewriteAvailable = false;
  const $ = (selector) => root.querySelector(selector);
  const kindLabel = (kind) =>
    kind === "stadium" ? "Stadionheft" : "Newsletter";
  const statusLabel = { draft: "Offen", review: "In Prüfung", ready: "Fertig" };
  const dateLabel = (date) =>
    new Date(`${date}T12:00:00`).toLocaleDateString("de-DE");
  const call = (action, data = {}) =>
    api("POST", { action: `editorial_${action}`, ...data });
  root.innerHTML = `
    <section class="panel editorial-hero"><div><span class="editorial-eyebrow">VEREINSREDAKTION</span><h2>Redaktion für Heft & Newsletter</h2><p>Stadionhefte und Newsletter gemeinsam planen, schreiben und fertigstellen.</p></div><button id="edNewIssue" class="primary-action">＋ Ausgabe anlegen</button></section>
    <section class="panel"><div class="editorial-calendar-heading"><div><h3>Redaktionskalender</h3><div class="editorial-legend"><span class="ed-start">● Redaktionsstart</span><span class="ed-close">● Redaktionsschluss</span><span class="ed-publish">● Erscheinung</span><span>▰ Redaktionszeitraum</span></div></div><label>Ausgabeart<select id="edFilter"><option value="">Alle Ausgaben</option><option value="stadium">Stadionheft</option><option value="newsletter">Newsletter</option></select></label></div><div class="editorial-month-nav"><button class="ghost" id="edPrev" aria-label="Vorheriger Monat">←</button><h3 id="edMonth" aria-live="polite"></h3><button class="ghost" id="edNext" aria-label="Nächster Monat">→</button><button class="ghost" id="edToday">Heute</button></div><div class="editorial-calendar-scroll"><div id="edCalendar" class="editorial-calendar"></div></div></section>
    <div class="editorial-columns"><section class="panel"><h3>Ausgaben</h3><div id="edIssues" aria-live="polite"></div></section><section class="panel" id="edDetail"><div class="empty">Lege die erste Ausgabe an oder wähle eine Ausgabe aus.</div></section></div>
    <dialog id="edIssueDialog" aria-labelledby="edIssueHeading"><div class="dialog-header"><h2 id="edIssueHeading">Ausgabe anlegen</h2><button type="button" class="ghost" id="edIssueClose" aria-label="Schließen">✕</button></div><form id="edIssueForm" class="fields"><label>Ausgabeart<select name="kind"><option value="stadium">Stadionheft</option><option value="newsletter">Newsletter</option></select></label><label>Titel<input name="title" required maxlength="180" placeholder="Zum Beispiel: Nordstern · Heimspielausgabe 01"></label><label>Redaktionsstart<input name="starts_on" type="date" required></label><label>Redaktionsschluss<input name="closes_on" type="date" required></label><label>Erscheinungsdatum<input name="publishes_on" type="date" required></label><p class="small">Im Stadionheft werden Grußworte, Trainerbegrüßungen und Sportdaten als feste Beiträge angelegt. Newsletter starten mit einem freien Inhaltsplan.</p><div class="wide toolbar"><button type="submit">Ausgabe speichern</button><span id="edIssueMessage" role="status"></span></div></form></dialog>
    <dialog id="edArticleDialog" aria-labelledby="edArticleHeading"><div class="dialog-header"><div><span class="editorial-eyebrow">TEXTREDAKTION</span><h2 id="edArticleHeading">Beitrag bearbeiten</h2></div><button type="button" class="ghost" id="edArticleClose" aria-label="Editor schließen">✕</button></div><form id="edArticleForm"><div class="fields"><label class="wide">Titel<input name="title" required maxlength="180"></label><label>Abteilung<select name="department_id"></select></label><label>Autor / Verantwortlich<input name="author" maxlength="180" placeholder="Name"></label><label>Status<select name="status"><option value="draft">Offen</option><option value="review">In Prüfung</option><option value="ready">Fertig</option></select></label><div class="small" id="edSource"></div><label class="wide">Beitrag<textarea name="body" maxlength="30000" rows="15" spellcheck="true" lang="de" placeholder="Hier ist Platz für euren Beitrag …"></textarea></label></div><p class="small" id="edRewriteHint"></p><div class="toolbar"><button type="submit" id="edSaveArticle">Speichern & überarbeiten</button><button type="submit" class="ghost" id="edRetryRewrite" data-rewrite="true">Erneut überarbeiten</button><button type="button" class="ghost" id="edHistory">Original & Verlauf</button><span class="small" id="edWordCount"></span></div><p id="edArticleMessage" role="status" aria-live="polite"></p><div id="edRevisionList"></div></form></dialog>`;

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
  function detail() {
    if (!selected) return;
    const ready = articles.filter(
      (article) => article.status === "ready",
    ).length;
    $("#edDetail").innerHTML =
      `<div class="list-heading"><div><span class="editorial-eyebrow">${kindLabel(selected.kind)}</span><h3>${esc(selected.title)}</h3></div><button class="ghost" id="edEditIssue">Termine bearbeiten</button></div><div class="ed-timeline"><span><small>Start</small>${dateLabel(selected.starts_on)}</span><span><small>Schluss</small>${dateLabel(selected.closes_on)}</span><span><small>Erscheinung</small>${dateLabel(selected.publishes_on)}</span></div><div class="ed-progress"><progress max="${Math.max(1, articles.length)}" value="${ready}" aria-label="Fertige Beiträge"></progress><span>${ready} von ${articles.length} Beiträgen fertig</span></div><div class="toolbar"><button id="edAddArticle">＋ Freier Beitrag</button>${articles.some((a) => a.kind === "sports") ? '<button class="secondary" id="edSports">Tabellen & Ergebnisse abrufen</button>' : ""}<button class="ghost" id="edExport">Texte exportieren</button></div><p id="edSportsMessage" class="small" role="status"></p><div class="ed-article-list">${articles.map((article) => `<button class="ed-article" data-article="${esc(article.id)}"><span><strong>${esc(article.title)}</strong><small>${article.kind === "free" ? "Freier Beitrag" : "Feste Rubrik"}${article.department_id ? " · " + esc(departments.find((d) => d.id === article.department_id)?.label || "Abteilung") : ""}${article.author ? " · " + esc(article.author) : ""}</small></span><span class="ed-status ed-status-${article.status}">${statusLabel[article.status]}</span></button>`).join("") || '<p class="empty">Der Inhaltsplan ist noch frei. Füge den ersten Beitrag hinzu.</p>'}</div>`;
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
  async function selectIssue(id) {
    if (busy) return;
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
    rewriteAvailable = data.rewriteAvailable;
    loaded = true;
    calendar();
    issueList();
    if (selected && issues.some((i) => i.id === selected.id))
      await selectIssue(selected.id);
    else if (issues.length) await selectIssue(issues[0].id);
  }
  function openIssue(issue = null) {
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
    const form = $("#edArticleForm");
    for (const key of ["title", "author", "body", "status", "department_id"])
      form.elements[key].value =
        article?.[key] ?? (key === "status" ? "draft" : "");
    $("#edHistory").disabled = !article?.id;
    $("#edRetryRewrite").classList.toggle(
      "hidden",
      !article?.id || article.kind === "sports",
    );
    $("#edSource").textContent = article?.source_snapshot
      ? `Datenabruf: ${new Date(article.source_snapshot.fetchedAt).toLocaleString("de-DE")}. Ergebnisse: letzte zehn gespeicherte Spiele. ${article.source_snapshot.warning || ""}`
      : "";
    $("#edSaveArticle").textContent =
      article?.kind === "sports"
        ? "Beitrag speichern"
        : "Speichern & überarbeiten";
    $("#edRewriteHint").textContent =
      article?.kind === "sports"
        ? "Sportdaten bleiben unverändert durch KI. Der Abruf ersetzt den Beitrag mit einem neuen Quellenstand."
        : rewriteAvailable
          ? "Beim Speichern werden Rechtschreibung und Lesefluss automatisch verbessert. Das Original bleibt im Verlauf. Überarbeitete Texte stehen anschließend auf „In Prüfung“."
          : "Die KI-Überarbeitung ist noch nicht eingerichtet. Deine Texte werden trotzdem gespeichert; Original und Verlauf bleiben erhalten.";
    dirty = false;
    wordCount();
  }
  function openArticle(article) {
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
    if (busy) {
      show("Bitte den laufenden Speichervorgang abwarten.");
      return false;
    }
    if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?"))
      return false;
    dirty = false;
    $("#edArticleDialog").close();
    $("#edIssueDialog").close();
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
    wordCount();
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
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form));
    payload.rewrite = event.submitter?.dataset.rewrite === "true";
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
      detail();
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
    const sports = articles.filter((a) => a.kind === "sports");
    if (
      sports.some((a) => a.body) &&
      !window.confirm(
        "Sportbeiträge mit aktuellen Tabellen und Ergebnissen neu erzeugen? Bisherige Texte bleiben im Verlauf.",
      )
    )
      return;
    busy = true;
    root
      .querySelectorAll("button")
      .forEach((button) => (button.disabled = true));
    const warnings = [];
    try {
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
    } finally {
      busy = false;
      root
        .querySelectorAll("button")
        .forEach((button) => (button.disabled = false));
      detail();
      $("#edSportsMessage").textContent = warnings.length
        ? `Abruf beendet. ${warnings.join(" · ")}`
        : "Tabellen und Ergebnisse aktualisiert. Bitte den Quellenstand prüfen.";
    }
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
      if (busy) return;
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
