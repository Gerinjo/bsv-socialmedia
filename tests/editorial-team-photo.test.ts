import assert from 'node:assert/strict';
import {prepareEditorialTeamPhoto,withEditorialTeamPhotos} from '../supabase/functions/_shared/editorial-team-photo.ts';
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
Deno.test('team images are frozen, reused by content and retained on an unavailable source',async()=>{
 const uploads:string[]=[],removed:string[]=[];
 const db={storage:{from(bucket:string){assert.equal(bucket,'editorial-portraits');return {
 upload:async(path:string)=>{uploads.push(path);return {error:null};},remove:async(paths:string[])=>{removed.push(...paths);return {error:null};},createSignedUrl:async(path:string)=>({data:{signedUrl:'https://example.org/'+path},error:null})};}}};
 const fetchImage=async()=>new Response(png,{headers:{'content-type':'image/png'}});
 const source={source_url:'https://bsvnordstern.de/images/team.png',alt:'Mannschaft'};
 const first=await prepareEditorialTeamPhoto(db,'issue',source,null,fetchImage);
 const same=await prepareEditorialTeamPhoto(db,'issue',source,first.photo,fetchImage);
 assert.equal(uploads.length,1);assert.deepEqual(same.photo,first.photo);
 const failed=await prepareEditorialTeamPhoto(db,'issue',source,first.photo,async()=>new Response(null,{status:503}));
 assert.deepEqual(failed.photo,first.photo);assert.match(failed.warning!,/Bisheriges Bild/);
 assert.equal((await prepareEditorialTeamPhoto(db,'issue',null,first.photo)).photo,null);
 assert.deepEqual((await prepareEditorialTeamPhoto(db,'issue',undefined,first.photo)).photo,first.photo);
 const signed=await withEditorialTeamPhotos(db,{articles:[{team_photo:first.photo},{}]});
 assert.deepEqual(Object.keys(signed.articles[0].team_photo).sort(),['alt','photo_url']);assert.equal(signed.articles[1].team_photo,null);
 let fetched=false;await prepareEditorialTeamPhoto(db,'issue',{source_url:'http://127.0.0.1/private'},null,async()=>{fetched=true;return new Response(png)});assert.equal(fetched,false);
 await first.cleanup();assert.deepEqual(removed,uploads);
});
