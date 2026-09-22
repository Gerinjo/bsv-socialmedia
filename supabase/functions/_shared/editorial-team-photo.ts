import { decodeEditorialCover } from '../../../src/editorial-publication.mjs';
import { fetchEditorialImage } from './editorial-image-fetch.ts';
const bucket = 'editorial-portraits';
export async function prepareEditorialTeamPhoto(db: any, issueId: string, photo: any, previous: any, fetchImpl = fetch) {
  const created: string[] = [];
  const cleanup = async () => { if (created.length) await db.storage.from(bucket).remove(created); };
  // An unavailable team page must not silently remove an existing photo.
  if (photo === undefined) return {photo:previous || null,cleanup};
  if (!photo) return {photo:null,cleanup};
  try {
    const url = new URL(photo.source_url);
    if (url.protocol !== 'https:' || !['bsvnordstern.de','www.bsvnordstern.de'].includes(url.hostname) || !url.pathname.startsWith('/images/')) throw new Error('Ungültige Mannschaftsbildquelle.');
    const response = await fetchEditorialImage(url, fetchImpl);
    if (!response.ok) throw new Error(`Mannschaftsbild nicht erreichbar (HTTP ${response.status}).`);
    if (Number(response.headers.get('content-length')) > 5242880) throw new Error('Mannschaftsbild ist größer als 5 MB.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 5242880) throw new Error('Mannschaftsbild ist größer als 5 MB.');
    let binary = '';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const image = decodeEditorialCover(`data:${response.headers.get('content-type')?.split(';')[0]};base64,${btoa(binary)}`);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    let path = previous?.hash === hash ? previous.photo_path : null;
    if(!path){
      path=`${issueId}/team-${crypto.randomUUID()}.${image.extension}`;
      const {error}=await db.storage.from(bucket).upload(path,bytes,{contentType:image.mimeType,upsert:false});
      if(error)throw error;
      created.push(path);
    }
    return {photo:{source_url:url.href,alt:photo.alt,hash,photo_path:path},cleanup};
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
