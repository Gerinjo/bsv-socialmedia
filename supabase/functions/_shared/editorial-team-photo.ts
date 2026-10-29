import { decodeEditorialCover } from '../../../src/editorial-publication.mjs';
import { fetchEditorialImage } from './editorial-image-fetch.ts';
import { websiteTeamPhoto } from './website-image-urls.mjs';
const bucket = 'editorial-portraits';
export function editorialTeamPhotoUrl(db: any, path: string) {
  if (!/^[a-f0-9-]{36}\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(path)) throw new Error('Ungültiges Mannschaftsbild.');
  // Use the immutable original: email clients need a permanent public URL.
  return db.storage.from('team-photos').getPublicUrl(path).data.publicUrl;
}
export async function loadEditorialTeamPhotos(db: any) {
  const [teams, feed] = await Promise.all([
    db.from('social_teams').select('id,name,slug,website_path').order('sort_order'),
    db.rpc('website_trainers_feed'),
  ]);
  if (teams.error || feed.error || !feed.data) throw new Error('Die Mannschaftsbilder konnten nicht geladen werden.');
  return teams.data.flatMap((team: any) => {
    const photo = feed.data.teams.find((item: any) => item.path === team.website_path);
    return photo?.teamPhotoPath ? [{team_id:team.id, name:team.name, slug:team.slug,
      photo_url:editorialTeamPhotoUrl(db,photo.teamPhotoPath), preview_url:websiteTeamPhoto(db,photo.teamPhotoPath,900)}] : [];
  });
}
export async function resolveEditorialTeamPhoto(db: any, team: any, fallback: any) {
  const {data,error}=await db.rpc('team_photo_source',{team:team.id});
  if(error)throw new Error('Das zentrale Mannschaftsbild konnte nicht geladen werden. Bitte erneut versuchen.');
  if(!data)return fallback;
  return data.photoPath?{team_photo_path:data.photoPath,alt:`Mannschaftsbild ${team.name}`} : null;
}
export async function prepareEditorialTeamPhoto(db: any, issueId: string, photo: any, previous: any, fetchImpl = fetch) {
  const created: string[] = [];
  const cleanup = async () => { if (created.length) await db.storage.from(bucket).remove(created); };
  // An unavailable team page must not silently remove an existing photo.
  if (photo === undefined) return {photo:previous || null,cleanup};
  if (!photo) return {photo:null,cleanup};
  try {
    let bytes: Uint8Array, mime: string, source: string;
    if(photo.team_photo_path){
      if(!/^[a-f0-9-]{36}\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(photo.team_photo_path))throw new Error('Ungültiges Mannschaftsbild.');
      const {data,error}=await db.storage.from('team-photos').download(photo.team_photo_path);
      if(error||!data)throw new Error('Zentrales Mannschaftsbild nicht verfügbar.');
      bytes=new Uint8Array(await data.arrayBuffer());mime=data.type;source=`team-photos/${photo.team_photo_path}`;
    }else{
      const url = new URL(photo.source_url);
      if (url.protocol !== 'https:' || !['bsvnordstern.de','www.bsvnordstern.de'].includes(url.hostname) || !url.pathname.startsWith('/images/')) throw new Error('Ungültige Mannschaftsbildquelle.');
      const response = await fetchEditorialImage(url, fetchImpl);
      if (!response.ok) throw new Error(`Mannschaftsbild nicht erreichbar (HTTP ${response.status}).`);
      if (Number(response.headers.get('content-length')) > 5242880) throw new Error('Mannschaftsbild ist größer als 5 MB.');
      bytes = new Uint8Array(await response.arrayBuffer());mime=response.headers.get('content-type')?.split(';')[0]||'';source=url.href;
    }
    if (bytes.length > 5242880) throw new Error('Mannschaftsbild ist größer als 5 MB.');
    let binary = '';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const image = decodeEditorialCover(`data:${mime};base64,${btoa(binary)}`);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    let path = previous?.hash === hash ? previous.photo_path : null;
    if(!path){
      path=`${issueId}/team-${crypto.randomUUID()}.${image.extension}`;
      const {error}=await db.storage.from(bucket).upload(path,bytes,{contentType:image.mimeType,upsert:false});
      if(error)throw error;
      created.push(path);
    }
    return {photo:{source_url:source,alt:photo.alt,hash,photo_path:path},cleanup};
  } catch(error) {
    await cleanup();
    return {photo:previous || null,cleanup:async()=>{},warning:`Mannschaftsbild: ${error instanceof Error ? error.message : 'Abruf fehlgeschlagen.'}${previous ? ' Bisheriges Bild bleibt erhalten.' : ''}`};
  }
}
export async function withEditorialTeamPhotos(db: any, snapshot: any) {
  return {...snapshot,articles:await Promise.all(snapshot.articles.map(async(article:any)=>{
    const photo=article.team_photo;
    if(!photo?.photo_path)return {...article,team_photo:null};
    const {data,error}=await db.storage.from(bucket).createSignedUrl(photo.photo_path,3600);
    if(error || !data?.signedUrl)throw new Error('Mannschaftsbild nicht verfügbar.');
    return {...article,team_photo:{alt:photo.alt,photo_url:data.signedUrl}};
  }))};
}
