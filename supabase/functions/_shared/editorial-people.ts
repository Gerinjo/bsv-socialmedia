import { selectEditorialPeople } from '../../../src/editorial-people.mjs';
import { decodeEditorialCover } from '../../../src/editorial-publication.mjs';
const bucket = 'editorial-portraits';
export async function loadEditorialPeople(db: any) {
  const [people, memberships] = await Promise.all([
    db.from('social_people').select('id,display_name,roles,source_photo_url,cutout_path').eq('active', true).order('display_name'),
    db.from('social_team_people').select('person_id,team_id,role'),
  ]);
  if (people.error) throw people.error;
  if (memberships.error) throw memberships.error;
  return people.data.map((person: any) => ({ ...person, photo_url: person.source_photo_url || person.cutout_path || null,
    teams: memberships.data.filter((entry: any) => entry.person_id === person.id).map(({ team_id, role }: any) => ({ team_id, role })) }));
}

export async function prepareEditorialPeople(db: any, issueId: string, article: any, ids: unknown) {
  const selected = selectEditorialPeople(article, await loadEditorialPeople(db), ids);
  const created: string[] = [], people: any[] = [];
  const cleanup = async () => { if (created.length) await db.storage.from(bucket).remove(created); };
  try {
    for (const person of selected) {
      const previous = article.people_snapshot?.find((p: any) => p.person_id === person.id && p.source_photo_url === person.photo_url);
      let photo_path = previous?.photo_path || null;
      if (person.photo_url && !previous) {
        const url = new URL(person.photo_url);
        if (url.protocol !== 'https:' || !(url.hostname === 'gerinjo.github.io' && url.pathname.startsWith('/bsv-website/images/') || ['bsvnordstern.de', 'www.bsvnordstern.de'].includes(url.hostname) && url.pathname.startsWith('/images/'))) throw new Error('Das Personenbild muss aus dem Vereins-Bildbestand stammen.');
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Das Bild von ${person.display_name} konnte nicht geladen werden.`);
        if (Number(response.headers.get('content-length')) > 5 * 1024 * 1024) throw new Error('Personenbild ist zu groß.');
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.length > 5 * 1024 * 1024) throw new Error('Personenbild ist zu groß.');
        const type = response.headers.get('content-type')?.split(';')[0];
        let binary = '';
        for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
        const image = decodeEditorialCover(`data:${type};base64,${btoa(binary)}`);
        photo_path = `${issueId}/${crypto.randomUUID()}.${image.extension}`;
        const { error } = await db.storage.from(bucket).upload(photo_path, image.bytes, { contentType: image.mimeType, upsert: false });
        if (error) throw error;
        created.push(photo_path);
      }
      people.push({ person_id: person.id, name: person.display_name, role: person.role, source_photo_url: person.photo_url, photo_path });
    }
    return { people, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

export async function withEditorialPeople(db: any, snapshot: any) {
  return { ...snapshot, articles: await Promise.all(snapshot.articles.map(async (article: any) => ({ ...article,
    people: await Promise.all((article.people || []).map(async ({ photo_path, ...person }: any) => {
      if (!photo_path) return { ...person, photo_url: null };
      const { data, error } = await db.storage.from(bucket).createSignedUrl(photo_path, 3600);
      if (error || !data?.signedUrl) throw new Error(`Personenbild nicht verfügbar: ${person.name}`);
      return { ...person, photo_url: data.signedUrl };
    })) })) ) };
}
