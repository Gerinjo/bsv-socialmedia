import { previewTeamPhotos } from '/preview-team-photos.mjs';
import { previewPeople } from '/preview-people.mjs';
import { selectEditorialPeople } from '/editorial-people.mjs';
import {
  editorialReleaseState,
  editorialPublicSnapshot,
  normalizeEditorialEvent,
  decodeEditorialCover,
  normalizeEditorialGalleries,
  normalizeEditorialCoverSettings,
  editorialCoverTemplate,
  applyEditorialCoverTemplate,
} from "/editorial-publication.mjs";
import { previewSports } from '/preview-sports.mjs';
import { editorialSportsBody } from '/editorial-sports-format.mjs';
import { previewAdvertising } from '/preview-sponsors.mjs';
function withPreviewAdvertisements(snapshot) {
  if (!snapshot.advertising) return snapshot;
  return { ...snapshot, advertising: { ...snapshot.advertising, ads: snapshot.advertising.ads.map(ad => ({ ...ad, asset: new URL(ad.asset, location.origin).href })) } };
}
// Loaded only by the local preview server; never included in the production build.
import {
  editorialSeeds,
  editorialTeamProfile,
  normalizeEditorialIssue,
  ARTICLE_STATUSES,
  editorialCanDeleteArticle,
} from "/editorial-model.mjs";
const storageKey = "bsv-editorial-local-preview-v1";
const teams = previewSports.map(item => item.team);
const people = previewPeople.map(person => ({ ...person, photo_url: person.photo_url ? new URL(person.photo_url, location.origin).href : null, teams: person.teams.map(team => ({ ...team, team_id: teams.find(t => t.slug === team.team_slug)?.id })) }));
const departments = [
  { id: "demo-fussball", label: "Fußballabteilung" },
  { id: "demo-jugend", label: "Jugendabteilung" },
  { id: "demo-turnen", label: "Turnen" },
];
function day(offset) {
  const now = new Date();
  now.setDate(now.getDate() + offset);
  return now.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}
function article(seed, issueId) {
  return {
    ...seed,
    id: crypto.randomUUID(),
    issue_id: issueId,
    author: "",
    department_id: null,
    body: "",
    original_body: "",
    status: "draft",
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
function initialData() {
  const issue = {
    id: "demo-stadium",
    title: "Nordstern · Heimspielausgabe (Beispiel)",
    kind: "stadium",
    starts_on: day(-3),
    closes_on: day(3),
    publishes_on: day(7),
    version: 1,
  };
  const newsletter = {
    id: "demo-newsletter",
    title: "Neues aus dem Verein (Beispiel)",
    kind: "newsletter",
    starts_on: day(1),
    closes_on: day(8),
    publishes_on: day(10),
    version: 1,
  };
  const articles = editorialSeeds("stadium", teams).map((seed) =>
    article(seed, issue.id),
  );
  articles[0] = {
    ...articles[0],
    author: "Vorstandschaft (Beispiel)",
    status: "review",
    body: "Liebe Mitglieder, liebe Gäste,\n\nherzlich willkommen beim BSV Nordstern! Dieses Grußwort ist ein Beispiel für unsere neue Redaktionsoberfläche. Hier können wir gemeinsam Beiträge vorbereiten und die nächste Ausgabe planen.\n\nWir wünschen euch viel Freude beim Lesen.",
    original_body: "Herzlich willkommen! Dieses Grußwort ist ein Beispiel.",
  };
  articles.push({
    ...article(
      { title: "Ein Blick ins Vereinsleben", kind: "free", position: 0 },
      newsletter.id,
    ),
    department_id: "demo-jugend",
    body: "Hier finden Neuigkeiten aus der Jugendabteilung ihren Platz.",
  });
  return {
    issues: [issue, newsletter],
    articles,
    revisions: articles.map((a) => ({
      article_id: a.id,
      version: a.version,
      created_at: a.updated_at,
      snapshot: structuredClone(a),
    })),
  };
}
function load() {
  const stored = localStorage.getItem(storageKey);
  const state = stored ? JSON.parse(stored) : initialData();
  state.publications ||= [];
  let upgraded = false;
  for (const issue of state.issues.filter(issue => issue.kind === 'stadium')) {
    const missing = editorialSeeds('stadium', teams).filter(seed => seed.kind === 'coach' && /^(herren|frauen)-[12]$/.test(teams.find(team => team.id === seed.team_id)?.slug || '') && !state.articles.some(saved => saved.issue_id === issue.id && (saved.template_key === seed.template_key || saved.kind === 'coach' && saved.team_id === seed.team_id)));
    for (const seed of missing) {
      const saved = article(seed, issue.id);
      state.articles.push(saved);
      revision(state, saved);
      upgraded = true;
    }
  }
  for (const saved of state.articles) {
    const team = teams.find(team => team.id === saved.team_id);
    if (saved.kind !== 'sports' || !team || !editorialTeamProfile(team).automaticSports || saved.automatic_sports) continue;
    saved.automatic_sports = true;
    const snapshot = saved.source_snapshot;
    if (snapshot?.lastMatches && saved.body === editorialSportsBody(team, snapshot)) {
      snapshot.compact = editorialTeamProfile(team).compact;
      saved.body = editorialSportsBody(team, snapshot);
      saved.original_body = saved.body;
      snapshot.generatedBody = saved.body;
      snapshot.autoApprovalEligible = Boolean(snapshot.matchesUrl) && (Boolean(snapshot.table) || (snapshot.warning || '').includes('keine Verbandstabelle hinterlegt'));
      saved.status = snapshot.autoApprovalEligible ? 'ready' : 'draft';
    } else saved.status = 'draft';
    saved.approved_by = null;
    saved.approved_at = saved.status === 'ready' ? new Date().toISOString() : null;
    saved.version++;
    revision(state, saved);
    upgraded = true;
  }
  for (const saved of state.articles.filter(a=>a.kind==='sports' && a.source_snapshot && a.source_snapshot.teamPhoto === undefined)) {
    const team=teams.find(team=>team.id===saved.team_id), photo=previewTeamPhotos[team?.slug];
    saved.source_snapshot.teamPhoto=photo ? {...photo,photo_url:new URL(photo.photo_url,location.origin).href} : null;
    if(photo){if(!saved.automatic_sports){saved.status='review';saved.approved_by=null;saved.approved_at=null;}saved.version++;revision(state,saved);}
    upgraded=true;
  }
  const obsolete = state.articles.filter(saved => saved.kind === 'coach' && editorialTeamProfile(teams.find(team=>team.id===saved.team_id) || {}).group === 'A');
  for (const saved of obsolete) {
    const hasText = saved.body.trim() || saved.original_body.trim() || state.revisions.some(revision=>revision.article_id===saved.id && (revision.snapshot.body?.trim() || revision.snapshot.original_body?.trim()));
    if(hasText){saved.kind='free';saved.template_key=null;saved.position=1000;saved.version++;revision(state,saved);}
    else {state.articles=state.articles.filter(a=>a.id!==saved.id);state.revisions=state.revisions.filter(r=>r.article_id!==saved.id);touch(state,saved.issue_id);}
    upgraded=true;
  }
  if (upgraded) localStorage.setItem(storageKey, JSON.stringify(state));
  return state;
}
function touch(state, issueId) {
  const issue = state.issues.find((i) => i.id === issueId);
  issue.version++;
}
function revision(state, saved) {
  touch(state, saved.issue_id);
  saved.updated_at = new Date().toISOString();
  state.revisions.push({
    article_id: saved.id,
    version: saved.version,
    created_at: saved.updated_at,
    snapshot: structuredClone(saved),
  });
}
function findArticle(state, id, version) {
  const saved = state.articles.find((a) => a.id === id);
  if (!saved) throw new Error("Beitrag nicht gefunden.");
  if (version !== undefined && saved.version !== version)
    throw new Error(
      "Der Beitrag wurde zwischenzeitlich geändert. Bitte neu öffnen.",
    );
  return saved;
}
export async function editorialPreviewApi(method = "GET", body = {}) {
  if (method === "GET")
    return {
      user: {
        userId: "local-preview",
        email: "Lokale Vorschau",
        role: "sm-team",
        accessAreas: ["editorial"],
      },
      testMode: true,
    };
  const state = load();
  let result;
  switch (body.action) {
    case "editorial_list":
      result = {
        issues: state.issues,
        teams,
        departments,
        people,
        rewriteAvailable: false,
      };
      break;
    case "editorial_articles":
      result = {
        articles: state.articles
          .filter((a) => a.issue_id === body.issueId)
          .sort((a, b) => a.position - b.position),
      };
      break;
    case "editorial_save_issue": {
      const values = normalizeEditorialIssue(body);
      let issue = state.issues.find((i) => i.id === body.id);
      if (body.id && !issue) throw new Error("Ausgabe nicht gefunden.");
      if (issue) {
        if (issue.version !== body.version)
          throw new Error("Die Ausgabe wurde zwischenzeitlich geändert.");
        if (issue.kind !== values.kind)
          throw new Error("Die Ausgabeart kann nicht geändert werden.");
        Object.assign(issue, values, { version: issue.version + 1 });
      } else {
        issue = { ...values, id: crypto.randomUUID(), version: 1 };
        state.issues.push(issue);
        for (const seed of editorialSeeds(issue.kind, teams)) {
          const saved = article(seed, issue.id);
          state.articles.push(saved);
          revision(state, saved);
        }
        if (issue.kind === "stadium" && state.coverDefaults) issue.cover_settings = applyEditorialCoverTemplate(state.coverDefaults, state.articles.filter(a => a.issue_id === issue.id), teams);
      }
      result = { issue };
      break;
    }
    case 'editorial_save_cover_settings':
    case 'editorial_save_cover_defaults': {
      const issue = state.issues.find(issue => issue.id === body.issueId);
      if (!issue || issue.kind !== 'stadium' || issue.version !== body.version) throw new Error('Die Ausgabe wurde geändert. Bitte neu laden.');
      const settings = normalizeEditorialCoverSettings(body.settings);
      if (settings.articles.some(item => !state.articles.some(article => article.id === item.id && article.issue_id === issue.id && article.kind !== 'sports')) || settings.teamSlugs.some(slug => !teams.some(team => team.slug === slug && team.active !== false))) throw new Error('Die Auswahl enthält nicht verfügbare Beiträge oder Mannschaften.');
      issue.cover_settings = settings;
      if (body.action === 'editorial_save_cover_defaults') state.coverDefaults = editorialCoverTemplate(settings, state.articles.filter(a => a.issue_id === issue.id));
      touch(state, issue.id);
      result = {issue};
      break;
    }
    case "editorial_save_article": {
      if (!state.issues.some((i) => i.id === body.issueId))
        throw new Error("Ausgabe nicht gefunden.");
      const title = String(body.title ?? "").trim(),
        text = String(body.body ?? ""),
        author = String(body.author ?? "").trim();
      if (
        !title ||
        title.length > 180 ||
        text.length > 30000 ||
        author.length > 180
      )
        throw new Error("Bitte Titel und Textlänge prüfen.");
      if (!ARTICLE_STATUSES.includes(body.status))
        throw new Error("Ungültiger Status.");
      if (body.status === "ready" && !text.trim())
        throw new Error("Ein leerer Beitrag kann nicht fertig sein.");
      const existing = body.id
        ? findArticle(state, body.id, body.version)
        : null;
      if (existing?.status === 'waived') throw new Error('Bitte zuerst den Verzicht aufheben, um den Beitrag zu bearbeiten.');
      if (body.status === 'waived') throw new Error('Bitte den Verzicht-Button verwenden.');
      if (existing?.automatic_sports) throw new Error('Sportdaten werden automatisch erzeugt. Bitte den Sportdatenabruf verwenden.');
      if (existing && existing.issue_id !== body.issueId)
        throw new Error("Ungültige Ausgabe.");
      const saved =
        existing ||
        article({ title, kind: "free", position: 1000 }, body.issueId);
      const galleryGroups = body.gallery_groups === undefined ? saved.gallery_groups || [] : await prepareLocalGalleries(saved, body.gallery_groups);
      const peopleSnapshot = body.person_ids === undefined ? saved.people_snapshot || [] : selectEditorialPeople(saved, people, body.person_ids).map(person => ({ person_id: person.id, name: person.display_name, role: person.role, photo_url: person.photo_url }));
      const selectedAuthor = peopleSnapshot.length ? peopleSnapshot.map(person => person.name).join(' & ') : author;
      const changed =
        JSON.stringify(galleryGroups) !== JSON.stringify(saved.gallery_groups || []) ||
        JSON.stringify(peopleSnapshot) !== JSON.stringify(saved.people_snapshot || []) ||
        saved.body !== text ||
        saved.title !== title ||
        saved.author !== selectedAuthor ||
        (saved.department_id || null) !== (body.department_id || null);
      if (body.status === "ready" && (saved.status !== "ready" || changed))
        throw new Error(
          "Bitte speichern und dann den Freigabe-Button verwenden.",
        );
      const needsRewrite =
        saved.kind !== "sports" &&
        Boolean(text.trim()) &&
        (saved.body !== text || body.rewrite);
      if (saved.body !== text) saved.original_body = text;
      Object.assign(saved, {
        title,
        body: text,
        author: selectedAuthor,
        people_snapshot: peopleSnapshot,
        gallery_groups: galleryGroups,
        department_id: body.department_id || null,
        status: needsRewrite || changed ? "review" : body.status,
        version: existing ? saved.version + 1 : 1,
      });
      if (!existing) state.articles.push(saved);
      revision(state, saved);
      result = {
        article: saved,
        rewritten: false,
        warning: needsRewrite
          ? "Lokal gespeichert. In dieser Vorschau ist die KI-Überarbeitung deaktiviert."
          : "",
      };
      break;
    }
    case 'editorial_waive_article': {
      const saved = findArticle(state, body.id, body.version);
      if (saved.kind !== 'coach' || saved.automatic_sports) throw new Error('Verzicht ist nur für Trainergrußworte möglich.');
      if (typeof body.waived !== 'boolean') throw new Error('Bitte Verzicht auswählen oder aufheben.');
      if ((saved.status === 'waived') !== body.waived) {
        saved.status = body.waived ? 'waived' : saved.body.trim() ? 'review' : 'draft';
        saved.approved_at = null;
        saved.approved_by = null;
        saved.version++;
        revision(state, saved);
      }
      result = {article: saved};
      break;
    }
    case "editorial_approve_article": {
      const saved = findArticle(state, body.id, body.version);
      if (saved.automatic_sports) throw new Error('Sportdaten werden automatisch freigegeben.');
      if (saved.status === 'waived') throw new Error('Bitte zuerst den Verzicht aufheben und den Beitrag prüfen.');
      if (!saved.body.trim())
        throw new Error("Ein leerer Beitrag kann nicht freigegeben werden.");
      saved.status = "ready";
      saved.version++;
      saved.approved_at = new Date().toISOString();
      revision(state, saved);
      result = { article: saved };
      break;
    }
    case "editorial_cover": {
      const issue = state.issues.find((i) => i.id === body.issueId);
      if (!issue || issue.version !== body.version)
        throw new Error("Die Ausgabe wurde geändert. Bitte neu laden.");
      const alt = String(body.alt || issue.title).trim(), credit = String(body.credit || '').trim();
      if (alt.length > 300 || credit.length > 300) throw new Error('Bildbeschreibung und Bildnachweis dürfen höchstens 300 Zeichen enthalten.');
      if (body.dataUrl == null) {
        if (!issue.cover_path && !issue.cover_url) throw new Error('Bitte zuerst ein Titelbild auswählen.');
      } else {
        decodeEditorialCover(body.dataUrl);
        issue.cover_url = body.dataUrl;
        issue.cover_path = "local-demo";
      }
      issue.cover_alt = alt;
      issue.cover_credit = credit;
      issue.version++;
      result = { issue };
      break;
    }
    case "editorial_events":
      result = {
        events: [
          {
            source_id: "demo-story",
            title: "Vereinsfest (Beispiel)",
            date: day(14),
            time: "14:00",
            location: "Vereinsgelände",
            description:
              "Ein gemeinsamer Nachmittag für Mitglieder, Familien und Freunde des Vereins. Beispieltermin der lokalen Vorschau.",
          },
          {
            source_id: "demo-story-2",
            title: "Jugendturnier (Beispiel)",
            date: day(20),
            time: "10:00",
            location: "Sportplatz",
            description:
              "Unser Nachwuchs lädt zu einem Turniertag ein. Dieser Termin ist ein Beispiel.",
          },
        ],
      };
      break;
    case "editorial_add_event": {
      if (!state.issues.some((i) => i.id === body.issueId))
        throw new Error("Ausgabe nicht gefunden.");
      const event = normalizeEditorialEvent(body.event);
      if (
        event.source_id &&
        state.articles.some(
          (a) =>
            a.issue_id === body.issueId &&
            a.event_snapshot?.source_id === event.source_id &&
            a.event_snapshot?.date === event.date,
        )
      )
        throw new Error("Dieser Termin ist bereits ausgewählt.");
      const saved = article(
        { title: event.title, kind: "event", position: 2000 },
        body.issueId,
      );
      Object.assign(saved, {
        body: event.description,
        original_body: event.description,
        event_snapshot: event,
        status: "review",
      });
      state.articles.push(saved);
      revision(state, saved);
      result = { article: saved };
      break;
    }
    case "editorial_delete_article":
    case "editorial_remove_event": {
      const saved = findArticle(state, body.id, body.version);
      if (body.action === 'editorial_remove_event' ? saved.kind !== 'event' : !editorialCanDeleteArticle(saved, teams.find(team => team.id === saved.team_id)))
        throw new Error('Nur weitere Beiträge können gelöscht werden.');
      state.articles = state.articles.filter((a) => a.id !== saved.id);
      state.revisions = state.revisions.filter(revision => revision.article_id !== saved.id);
      touch(state, saved.issue_id);
      result = { removed: true };
      break;
    }
    case "editorial_preview_issue": {
      const issue = state.issues.find((i) => i.id === body.issueId);
      if (!issue || issue.version !== body.version)
        throw new Error("Die Ausgabe wurde geändert. Bitte neu laden.");
      if (issue.kind === 'stadium' && JSON.stringify(issue.advertising) !== JSON.stringify(previewAdvertising)) {
        issue.advertising = structuredClone(previewAdvertising);
        touch(state, issue.id);
      }
      issue.previewed_version = issue.version;
      result = {
        snapshot: withPreviewAdvertisements({
          ...editorialPublicSnapshot(
            issue,
            state.articles.filter((a) => a.issue_id === issue.id),
            teams,
          ),
          demo: true,
        }),
      };
      break;
    }
    case "editorial_publish_issue": {
      const issue = state.issues.find((i) => i.id === body.issueId);
      if (!issue || issue.version !== body.version)
        throw new Error("Die Ausgabe wurde geändert. Bitte neu laden.");
      const articles = state.articles.filter((a) => a.issue_id === issue.id);
      if (!editorialReleaseState(issue, articles).canPublish)
        throw new Error(
          "Bitte alle Beiträge freigeben, ein Titelbild hochladen und die aktuelle Vorschau prüfen.",
        );
      issue.published_version = issue.version;
      issue.published_at = new Date().toISOString();
      state.publications.push({
        ...editorialPublicSnapshot(issue, articles, teams),
        published_at: issue.published_at,
        demo: true,
      });
      result = { issue, url: "/stadionheft/" + issue.id, demo: true };
      break;
    }
    case "editorial_revisions":
      result = {
        revisions: state.revisions
          .filter((r) => r.article_id === body.id)
          .sort((a, b) => b.version - a.version)
          .slice(0, 30),
      };
      break;
    case 'editorial_prepare_sports': {
      const issue = state.issues.find(i => i.id === body.issueId);
      if (!issue || issue.kind !== 'stadium') throw new Error('Kein Stadionheft.');
      for (const seed of editorialSeeds('stadium', teams).filter(seed => seed.kind === 'sports')) {
        if (!state.articles.some(a => a.issue_id === issue.id && a.team_id === seed.team_id && a.kind === 'sports')) {
          const saved = article(seed, issue.id);
          state.articles.push(saved);
          revision(state, saved);
        }
      }
      result = { articles: state.articles.filter(a => a.issue_id === issue.id && a.kind === 'sports') };
      break;
    }
    case "editorial_sports": {
      const saved = findArticle(state, body.id, body.version);
      if (saved.kind !== "sports") throw new Error("Kein Sportbeitrag.");
      const team = teams.find(team => team.id === saved.team_id);
      const source = previewSports.find(item => item.team.id === saved.team_id);
      if (!source) throw new Error('Für diese Mannschaft fehlen lokale Sportdaten.');
      const issue = state.issues.find(i => i.id === saved.issue_id);
      const snapshot = structuredClone(source.snapshot);
      snapshot.teamPhoto = previewTeamPhotos[team.slug] ? {...previewTeamPhotos[team.slug],photo_url:new URL(previewTeamPhotos[team.slug].photo_url,location.origin).href} : null;
      snapshot.compact = editorialTeamProfile(team).compact;
      snapshot.upcoming = snapshot.upcoming.filter(match => match.date >= issue.publishes_on);
      snapshot.lastMatches = snapshot.lastMatches.filter(match => match.date <= issue.publishes_on);
      snapshot.referenceDate = issue.publishes_on;
      snapshot.cutoff = issue.publishes_on;
      snapshot.warning = 'Lokaler Quellenstand vom 20.09.2026; kein Live-Abruf. ' + (snapshot.warning || '');
      saved.body = editorialSportsBody(team, snapshot);
      snapshot.generatedBody = saved.body;
      snapshot.autoApprovalEligible = Boolean(snapshot.matchesUrl) && (Boolean(snapshot.table) || (snapshot.warning || '').includes('keine Verbandstabelle hinterlegt'));
      saved.original_body = saved.body;
      saved.automatic_sports = editorialTeamProfile(team).automaticSports;
      saved.status = saved.automatic_sports ? (snapshot.autoApprovalEligible ? 'ready' : 'draft') : 'review';
      saved.approved_by = null;
      saved.approved_at = saved.status === 'ready' ? new Date().toISOString() : null;
      saved.version++;
      saved.source_snapshot = snapshot;
      revision(state, saved);
      result = {
        article: saved,
        warning: saved.source_snapshot.warning,
      };
      break;
    }
    default:
      throw new Error(
        "Diese Funktion ist in der lokalen Vorschau nicht verfügbar.",
      );
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    throw new Error(
      "Der lokale Demo-Speicher ist voll. Bitte ein kleineres Titelbild verwenden.",
    );
  }
  const output=structuredClone(result);
  if(output.article) output.article=await localArticleGalleries(output.article);
  if(output.articles) output.articles=await Promise.all(output.articles.map(article=>localArticleGalleries(article)));
  if(output.snapshot) output.snapshot=await localSnapshotGalleries(output.snapshot);
  return output;
}
export function createClient() {
  return {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "local-preview" } },
      }),
      signOut: async () => ({ error: null }),
    },
  };
}

export async function editorialPreviewPublication(id) {
  const snapshot = load()
    .publications.filter((p) => p.id === id)
    .at(-1);
  if (!snapshot)
    throw new Error("Diese Ausgabe ist noch nicht veröffentlicht.");
  return localSnapshotGalleries(withPreviewAdvertisements(structuredClone(snapshot)));
}

// Large photo data live outside localStorage; article revisions keep immutable IDs only.
async function localImageStore(mode, callback) {
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('bsv-editorial-images',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('images');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  try {return await new Promise((resolve,reject)=>{
    const tx=db.transaction('images',mode),request=callback(tx.objectStore('images'));
    tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });} finally{db.close();}
}
async function prepareLocalGalleries(article,input){
  const groups=normalizeEditorialGalleries(input);
  if(article.kind!=='free' && groups.length)throw new Error('Bildgruppen sind für freie Beiträge vorgesehen.');
  const existing=new Map((article.gallery_groups || []).flatMap(group=>group.images).map(image=>[image.id,image]));
  let total=0;
  for(const group of groups) for(const image of group.images){
    if(image.dataUrl){
      total+=decodeEditorialCover(image.dataUrl).bytes.length;
      if(total>30*1024*1024)throw new Error('Bitte höchstens 30 MB Bilder auf einmal speichern.');
      image.photo_path=crypto.randomUUID();
      await localImageStore('readwrite',store=>store.put(image.dataUrl,image.photo_path));
      delete image.dataUrl;
    }else{
      if(!existing.get(image.id)?.photo_path)throw new Error('Bild gehört nicht zu diesem Beitrag.');
      image.photo_path=existing.get(image.id).photo_path;
    }
  }
  return groups;
}
async function localArticleGalleries(article,field='gallery_groups'){
  return {...article,[field]:await Promise.all((article[field] || []).map(async group=>({...group,images:await Promise.all(group.images.map(async image=>({...image,photo_url:await localImageStore('readonly',store=>store.get(image.photo_path))})))})))};
}
async function localSnapshotGalleries(snapshot){return {...snapshot,articles:await Promise.all(snapshot.articles.map(article=>localArticleGalleries(article,'galleries')))};}
