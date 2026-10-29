import { selectEditorialPeople } from '../../../src/editorial-people.mjs';
import { decodeEditorialCover } from '../../../src/editorial-publication.mjs';
import { fetchEditorialImage } from './editorial-image-fetch.ts';
const bucket = 'editorial-portraits';
const mailBucket = 'editorial-public-images';
export async function loadEditorialPeople(db: any) {
  const {data,error} = await db.rpc('editorial_people_catalog');
  if (error || !Array.isArray(data)) throw new Error('Die Personenbilder konnten nicht aus der Mitarbeiterverwaltung geladen werden.');
  return data.map((person: any) => ({...person,photo_url:person.photo_source?.url || person.source_photo_url || null}));
}
export async function publicEditorialPeople(db: any, people: any[]) {
  return people.map(person => ({
    id:person.id,display_name:person.display_name,active:person.active,roles:person.roles || [],
    role_photos:(person.role_photos || []).map(({role,group,photo_source}: any) => ({role,group,has_photo:Boolean(photo_source?.path || photo_source?.url)})),
    teams:(person.teams || []).map(({team_id,role}: any) => ({team_id,role})),
    has_photo:Boolean(person.photo_source?.path || person.photo_source?.url || person.photo_url),
    photo_url:person.photo_source?.path ? null : person.photo_source?.url || person.photo_url,
  }));
}

export async function prepareEditorialPeople(db: any, issueId: string, article: any, ids: unknown, fetchImpl = fetch, catalog?: any[]) {
  const selected = selectEditorialPeople(article, catalog || await loadEditorialPeople(db), ids);
  const created: string[] = [], people: any[] = [];
  const cleanup = async () => { if (created.length) await db.storage.from(bucket).remove(created); };
  try {
    for (const person of selected) {
      const source = person.photo_source;
      const reference = source?.path ? `${source.bucket}/${source.path}` : source?.url || person.photo_url || null;
      const previous = article.people_snapshot?.find((p: any) => p.person_id === person.id && p.source_photo_url === reference);
      let photo_path = previous?.photo_path || null;
      if (reference && !previous) {
        let data: Uint8Array, type: string;
        if (source?.path) {
          if (!['employee-portraits','trainer-portraits'].includes(source.bucket) || !/^[a-f0-9-]{36}\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(source.path)) throw new Error('Ungültiger Personenbildbestand.');
          const {data:photo,error} = await db.storage.from(source.bucket).download(source.path);
          if (error || !photo) throw new Error(`Das aktuelle Bild von ${person.display_name} konnte nicht geladen werden.`);
          data = new Uint8Array(await photo.arrayBuffer()); type = photo.type;
        } else {
          const url = new URL(reference);
          if (url.protocol !== 'https:' || !(url.hostname === 'gerinjo.github.io' && url.pathname.startsWith('/bsv-website/images/') || ['bsvnordstern.de', 'www.bsvnordstern.de'].includes(url.hostname) && url.pathname.startsWith('/images/'))) throw new Error('Das Personenbild muss aus dem Vereins-Bildbestand stammen.');
          const response = await fetchEditorialImage(url, fetchImpl);
          if (!response.ok) throw new Error(`Das Bild von ${person.display_name} konnte nicht geladen werden.`);
          if (Number(response.headers.get('content-length')) > 5 * 1024 * 1024) throw new Error('Personenbild ist zu groß.');
          data = new Uint8Array(await response.arrayBuffer()); type = response.headers.get('content-type')?.split(';')[0] || '';
        }
        if (data.length > 5 * 1024 * 1024) throw new Error('Personenbild ist zu groß.');
        let binary = '';
        for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
        const image = decodeEditorialCover(`data:${type};base64,${btoa(binary)}`);
        photo_path = `${issueId}/${crypto.randomUUID()}.${image.extension}`;
        const { error } = await db.storage.from(bucket).upload(photo_path, image.bytes, { contentType: image.mimeType, upsert: false });
        if (error) throw error;
        created.push(photo_path);
      }
      people.push({ person_id: person.id, name: person.display_name, role: person.role, source_photo_url:reference, photo_path });
    }
    return { people, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

// Refresh working copies only. Publication snapshots retain their archived image.
// Each successful article update increments its issue version exactly once.
export async function refreshEditorialPeople(db: any, issue: any, actor: string) {
  const {data:articles,error} = await db.from('editorial_articles').select('*').eq('issue_id',issue.id);
  if (error) throw error;
  const selected = articles.filter((article: any) => article.status !== 'waived' && article.people_snapshot?.some((person: any) => person.person_id));
  if (!selected.length) return issue.version;
  const catalog = await loadEditorialPeople(db);
  let version = issue.version;
  for (const article of selected) {
    const prepared = await prepareEditorialPeople(db,issue.id,article,article.people_snapshot.map((person: any) => person.person_id),fetch,catalog);
    if (JSON.stringify(prepared.people) === JSON.stringify(article.people_snapshot)) continue;
    try {
      const {data,error} = await db.from('editorial_articles').update({people_snapshot:prepared.people,updated_by:actor})
        .eq('id',article.id).eq('version',article.version).select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Der Beitrag wurde während der Bildaktualisierung geändert. Bitte neu laden.');
      version++;
    } catch (error) { await prepared.cleanup(); throw error; }
  }
  return version;
}

export async function withEditorialPeople(db: any, snapshot: any, {permanent = false} = {}) {
  return { ...snapshot, articles: await Promise.all(snapshot.articles.map(async (article: any) => ({ ...article,
    people: await Promise.all((article.people || []).map(async ({ photo_path, ...person }: any) => {
      if (!photo_path) return { ...person, photo_url: null };
      if (permanent) {
        const {error} = await db.storage.from(bucket).copy(photo_path,photo_path,{destinationBucket:mailBucket});
        if (error && String(error.statusCode) !== '409' && !/already exists|duplicate/i.test(error.message || '')) throw new Error(`Personenbild für den Newsletter nicht verfügbar: ${person.name}`);
        return {...person,photo_url:db.storage.from(mailBucket).getPublicUrl(photo_path).data.publicUrl};
      }
      const { data, error } = await db.storage.from(bucket).createSignedUrl(photo_path, 3600);
      if (error || !data?.signedUrl) throw new Error(`Personenbild nicht verfügbar: ${person.name}`);
      return { ...person, photo_url: data.signedUrl };
    })) })) ) };
}
