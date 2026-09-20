// Loaded only by the local preview server; never included in the production build.
import { editorialSeeds, normalizeEditorialIssue, ARTICLE_STATUSES } from '/editorial-model.mjs';
const storageKey = 'bsv-editorial-local-preview-v1';
const teams = [
  { id: 'demo-herren-1', name: 'Herren I', active: true },
  { id: 'demo-frauen', name: 'Frauen', active: true },
  { id: 'demo-jugend', name: 'A-Junioren', active: true },
];
const departments = [
  { id: 'demo-fussball', label: 'Fußballabteilung' },
  { id: 'demo-jugend', label: 'Jugendabteilung' },
  { id: 'demo-turnen', label: 'Turnen' },
];
function day(offset) {
  const now = new Date(); now.setDate(now.getDate() + offset);
  return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}
function article(seed, issueId) {
  return { ...seed, id: crypto.randomUUID(), issue_id: issueId, author: '', department_id: null, body: '', original_body: '', status: 'draft', version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}
function initialData() {
  const issue = { id: 'demo-stadium', title: 'Nordstern · Heimspielausgabe (Beispiel)', kind: 'stadium', starts_on: day(-3), closes_on: day(3), publishes_on: day(7), version: 1 };
  const newsletter = { id: 'demo-newsletter', title: 'Neues aus dem Verein (Beispiel)', kind: 'newsletter', starts_on: day(1), closes_on: day(8), publishes_on: day(10), version: 1 };
  const articles = editorialSeeds('stadium', teams).map(seed => article(seed, issue.id));
  articles[0] = { ...articles[0], author: 'Vorstandschaft (Beispiel)', status: 'review', body: 'Liebe Mitglieder, liebe Gäste,\n\nherzlich willkommen beim BSV Nordstern! Dieses Grußwort ist ein Beispiel für unsere neue Redaktionsoberfläche. Hier können wir gemeinsam Beiträge vorbereiten und die nächste Ausgabe planen.\n\nWir wünschen euch viel Freude beim Lesen.', original_body: 'Herzlich willkommen! Dieses Grußwort ist ein Beispiel.' };
  articles.push({ ...article({title: 'Ein Blick ins Vereinsleben', kind:'free',position:0},newsletter.id), department_id:'demo-jugend', body:'Hier finden Neuigkeiten aus der Jugendabteilung ihren Platz.' });
  return { issues: [issue, newsletter], articles, revisions: articles.map(a => ({article_id:a.id,version:a.version,created_at:a.updated_at,snapshot:structuredClone(a)})) };
}
function load() {
  const stored = localStorage.getItem(storageKey);
  return stored ? JSON.parse(stored) : initialData();
}
function revision(state, saved) {
  saved.updated_at = new Date().toISOString();
  state.revisions.push({article_id:saved.id,version:saved.version,created_at:saved.updated_at,snapshot:structuredClone(saved)});
}
function findArticle(state, id, version) {
  const saved = state.articles.find(a => a.id === id);
  if (!saved) throw new Error('Beitrag nicht gefunden.');
  if (version !== undefined && saved.version !== version) throw new Error('Der Beitrag wurde zwischenzeitlich geändert. Bitte neu öffnen.');
  return saved;
}
export async function editorialPreviewApi(method = 'GET', body = {}) {
  if (method === 'GET') return { user: { userId:'local-preview', email:'Lokale Vorschau', role:'sm-team', accessAreas:['editorial'] }, testMode:true };
  const state = load();
  let result;
  switch (body.action) {
    case 'editorial_list':
      result = { issues:state.issues,teams,departments,rewriteAvailable:false }; break;
    case 'editorial_articles':
      result = { articles:state.articles.filter(a => a.issue_id === body.issueId).sort((a,b) => a.position-b.position) }; break;
    case 'editorial_save_issue': {
      const values = normalizeEditorialIssue(body);
      let issue = state.issues.find(i => i.id === body.id);
      if (body.id && !issue) throw new Error('Ausgabe nicht gefunden.');
      if (issue) {
        if (issue.version !== body.version) throw new Error('Die Ausgabe wurde zwischenzeitlich geändert.');
        if (issue.kind !== values.kind) throw new Error('Die Ausgabeart kann nicht geändert werden.');
        Object.assign(issue,values,{version:issue.version+1});
      } else {
        issue = {...values,id:crypto.randomUUID(),version:1};state.issues.push(issue);
        for (const seed of editorialSeeds(issue.kind,teams)) {const saved=article(seed,issue.id);state.articles.push(saved);revision(state,saved);}
      }
      result = {issue}; break;
    }
    case 'editorial_save_article': {
      if (!state.issues.some(i => i.id === body.issueId)) throw new Error('Ausgabe nicht gefunden.');
      const title = String(body.title ?? '').trim(), text = String(body.body ?? ''), author = String(body.author ?? '').trim();
      if (!title || title.length > 180 || text.length > 30000 || author.length > 180) throw new Error('Bitte Titel und Textlänge prüfen.');
      if (!ARTICLE_STATUSES.includes(body.status)) throw new Error('Ungültiger Status.');
      if (body.status === 'ready' && !text.trim()) throw new Error('Ein leerer Beitrag kann nicht fertig sein.');
      const existing = body.id ? findArticle(state,body.id,body.version) : null;
      if (existing && existing.issue_id !== body.issueId) throw new Error('Ungültige Ausgabe.');
      const saved = existing || article({title,kind:'free',position:1000},body.issueId);
      const needsRewrite = saved.kind !== 'sports' && Boolean(text.trim()) && (saved.body !== text || body.rewrite);
      if (saved.body !== text) saved.original_body = text;
      Object.assign(saved,{title,body:text,author,department_id:body.department_id || null,status:needsRewrite?'review':body.status,version:existing?saved.version+1:1});
      if (!existing) state.articles.push(saved);
      revision(state,saved);
      result = {article:saved,rewritten:false,warning:needsRewrite?'Lokal gespeichert. In dieser Vorschau ist die KI-Überarbeitung deaktiviert.':''}; break;
    }
    case 'editorial_revisions':
      result = {revisions:state.revisions.filter(r => r.article_id === body.id).sort((a,b) => b.version-a.version).slice(0,30)};break;
    case 'editorial_sports': {
      const saved = findArticle(state,body.id,body.version);
      if (saved.kind !== 'sports') throw new Error('Kein Sportbeitrag.');
      saved.body = 'BEISPIELDATEN · keine echten Spielergebnisse\n\nTABELLE\nPlatz | Mannschaft | Spiele | Tore | Punkte\n1 | Beispielverein A | 4 | 12:3 | 10\n2 | Beispielverein B | 4 | 8:4 | 8\n\nERGEBNISSE\nBeispielverein A – Beispielverein B 1:1';
      saved.original_body=saved.body;saved.status='review';saved.version++;
      saved.source_snapshot={fetchedAt:new Date().toISOString(),warning:'Lokale Beispieldaten; kein Live-Abruf.'};revision(state,saved);
      result={article:saved,warning:'Lokale Beispieldaten; kein Live-Abruf.'};break;
    }
    default: throw new Error('Diese Funktion ist in der lokalen Vorschau nicht verfügbar.');
  }
  localStorage.setItem(storageKey,JSON.stringify(state));
  return structuredClone(result);
}
export function createClient() {
  return {auth:{getSession:async()=>({data:{session:{access_token:'local-preview'}}}),signOut:async()=>({error:null})}};
}
