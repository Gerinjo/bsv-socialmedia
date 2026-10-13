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

Deno.test('central team photos override the website and are copied into the issue archive',async()=>{
 const {resolveEditorialTeamPhoto}=await import('../supabase/functions/_shared/editorial-team-photo.ts');
 const path='00000000-0000-4000-8000-000000000001/'+'a'.repeat(64)+'.png';let source:any={photoPath:path};const uploads:string[]=[];
 const db={rpc:async()=>({data:source,error:null}),storage:{from(bucket:string){return {download:async(p:string)=>{assert.equal(bucket,'team-photos');assert.equal(p,path);return {data:new Blob([png],{type:'image/png'}),error:null};},upload:async(p:string)=>{assert.equal(bucket,'editorial-portraits');uploads.push(p);return {error:null};},remove:async()=>({error:null})};}}};
 const team={id:'team',name:'U19'},fallback={source_url:'https://bsvnordstern.de/images/old.png'};
 const selected=await resolveEditorialTeamPhoto(db,team,fallback);
 const result=await prepareEditorialTeamPhoto(db,'issue',selected,null,async()=>{throw new Error('must not fetch website');});
 assert.equal(uploads.length,1);assert.equal(result.photo.photo_path,uploads[0]);assert.equal(result.photo.source_url,'team-photos/'+path);
 source={photoPath:null};assert.equal(await resolveEditorialTeamPhoto(db,team,fallback),null);
 source=null;assert.equal(await resolveEditorialTeamPhoto(db,team,fallback),fallback);
 await assert.rejects(()=>resolveEditorialTeamPhoto({rpc:async()=>({error:true})},team,fallback));
});
