import { normalizeEditorialGalleries, decodeEditorialCover } from '../../../src/editorial-publication.mjs';
import { editorialTeamPhotoUrl, resolveEditorialTeamPhoto } from './editorial-team-photo.ts';
const bucket = 'editorial-galleries';
export async function prepareEditorialGalleries(db: any, issueId: string, article: any, input: unknown) {
  const groups = normalizeEditorialGalleries(input);
  if (article.kind !== 'free' && groups.length) throw new Error('Bildgruppen sind für freie Beiträge vorgesehen.');
  const previous = new Map((article.gallery_groups || []).flatMap((g: any) => g.images).map((image: any) => [image.id, image]));
  const created: string[] = [];
  const cleanup = async () => { if (created.length) await db.storage.from(bucket).remove(created); };
  let total = 0;
  try {
    const galleries = [];
    for (const group of groups) {
      const images = [];
      for (const image of group.images) {
        if (image.team_id) {
          const photo = await resolveEditorialTeamPhoto(db, {id:image.team_id}, null);
          if (!photo?.team_photo_path) throw new Error('Für diese Mannschaft ist kein Bild mehr hinterlegt. Bitte die Bildauswahl neu öffnen.');
          editorialTeamPhotoUrl(db, photo.team_photo_path);
          images.push({id:image.id,alt:image.alt,team_photo_path:photo.team_photo_path});
          continue;
        }
        let path;
        if (image.dataUrl) {
          const decoded = decodeEditorialCover(image.dataUrl);
          total += decoded.bytes.length;
          if (total > 30 * 1024 * 1024) throw new Error('Bitte höchstens 30 MB Bilder auf einmal speichern.');
          path = `${issueId}/${crypto.randomUUID()}.${decoded.extension}`;
          const { error } = await db.storage.from(bucket).upload(path, decoded.bytes, {contentType:decoded.mimeType,upsert:false});
          if (error) throw error;
          created.push(path);
        } else {
          const saved: any = previous.get(image.id);
          if (saved?.team_photo_path) {
            images.push({id:image.id,alt:image.alt,team_photo_path:saved.team_photo_path});
            continue;
          }
          if (!saved?.photo_path) throw new Error('Bild gehört nicht zu diesem Beitrag. Bitte erneut hochladen.');
          path = saved.photo_path;
        }
        images.push({id:image.id,alt:image.alt,photo_path:path});
      }
      galleries.push({...group,images});
    }
    return { galleries, cleanup };
  } catch(error) { await cleanup(); throw error; }
}
export async function withArticleGalleries(db: any, article: any, field = 'gallery_groups') {
  return {...article,[field]:await Promise.all((article[field] || []).map(async (group: any) => ({...group,images:await Promise.all(group.images.map(async (image: any) => {
    const {photo_path,team_photo_path,...publicImage}=image;
    if (team_photo_path) return {...publicImage,photo_url:editorialTeamPhotoUrl(db,team_photo_path)};
    const {data,error}=await db.storage.from(bucket).createSignedUrl(photo_path,3600);
    if(error || !data?.signedUrl) throw new Error('Galeriebild konnte nicht geladen werden.');
    return {...publicImage,photo_url:data.signedUrl};
  }))})))};
}
export async function withEditorialGalleries(db: any, snapshot: any) {
  return {...snapshot,articles:await Promise.all(snapshot.articles.map((article: any)=>withArticleGalleries(db,article,'galleries')))};
}
// Newsletter excerpts carry only permanent team images. Private gallery images
// need no signed preview URL here and cannot block a text import during an outage.
export function withNewsletterGalleryImages(db: any, snapshot: any) {
  return {...snapshot,articles:snapshot.articles.map((article: any) => ({...article,
    galleries:(article.galleries || []).map((group: any) => ({...group,
      images:group.images.filter((image: any) => image.team_photo_path).map((image: any) => ({
        alt:image.alt,photo_url:editorialTeamPhotoUrl(db,image.team_photo_path),
      })),
    })),
  }))};
}
