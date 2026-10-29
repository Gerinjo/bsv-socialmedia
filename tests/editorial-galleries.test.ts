import assert from 'node:assert/strict';
import { prepareEditorialGalleries,withEditorialGalleries,withNewsletterGalleryImages } from '../supabase/functions/_shared/editorial-galleries.ts';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII=';
Deno.test('galleries freeze private images, reuse only own references, strip paths from public response and clean partial uploads',async()=>{
 const uploaded:string[]=[],removed:string[]=[];
 const db={storage:{from(bucket:string){assert.equal(bucket,'editorial-galleries');return {
  upload:async(path:string)=>{uploaded.push(path);return {error:null};},
  remove:async(paths:string[])=>{removed.push(...paths);return {error:null};},
  createSignedUrl:async(path:string)=>({data:{signedUrl:'https://example.org/'+path},error:null}),
 };}}};
 const input=[{id:'group',title:'Fest',cover_id:'image',images:[{id:'image',alt:'Bild',dataUrl:png}]}];
 const prepared=await prepareEditorialGalleries(db,'issue',{kind:'free'},input);
 assert.equal(uploaded.length,1);assert.ok(!JSON.stringify(prepared.galleries).includes('dataUrl'));
 const reused=await prepareEditorialGalleries(db,'issue',{kind:'free',gallery_groups:prepared.galleries},prepared.galleries);
 assert.equal(uploaded.length,1);assert.deepEqual(reused.galleries,prepared.galleries);
 const signed=await withEditorialGalleries(db,{articles:[{galleries:prepared.galleries}]});
 assert.ok(signed.articles[0].galleries[0].images[0].photo_url);assert.equal(signed.articles[0].galleries[0].images[0].photo_path,undefined);
 await assert.rejects(prepareEditorialGalleries(db,'other',{kind:'free'},prepared.galleries),/gehört nicht/);
 await assert.rejects(prepareEditorialGalleries(db,'issue',{kind:'board'},input),/freie Beiträge/);
 await assert.rejects(prepareEditorialGalleries(db,'issue',{kind:'free'},[{...input[0],images:[input[0].images[0],{id:'bad',alt:'',dataUrl:'data:image/png;base64,aGVsbG8='}]}]),/gültiges Format/);
 assert.equal(uploaded.length,2);assert.deepEqual(removed,[uploaded[1]]);
});

Deno.test('central team images keep immutable public links in both magazine and newsletter galleries',async()=>{
 const teamId='00000000-0000-4000-8000-000000000001';
 const oldPath=teamId+'/'+'a'.repeat(64)+'.jpg',newPath=teamId+'/'+'b'.repeat(64)+'.jpg';
 let current:string|null=oldPath;
 const db={rpc:async(name:string,args:any)=>{assert.equal(name,'team_photo_source');assert.equal(args.team,teamId);return {data:{photoPath:current},error:null};},storage:{from(bucket:string){assert.equal(bucket,'team-photos');return {getPublicUrl:(path:string)=>({data:{publicUrl:'https://example.org/storage/v1/object/public/team-photos/'+path}})};}}};
 const input=[{id:'group',title:'Erste',cover_id:'image',images:[{id:'image',alt:'Mannschaftsbild',team_id:teamId,photo_url:'https://evil.example/ignored.jpg',team_photo_path:'forged'}]}];
 const prepared=await prepareEditorialGalleries(db,'issue',{kind:'free'},input);
 assert.equal(prepared.galleries[0].images[0].team_photo_path,oldPath);
 const article={kind:'free',gallery_groups:prepared.galleries};
 const snapshot=await withEditorialGalleries(db,{articles:[{galleries:prepared.galleries}]});
 const image=snapshot.articles[0].galleries[0].images[0];
 assert.equal(image.team_photo_path,undefined);assert.equal(image.photo_path,undefined);
 assert.ok(image.photo_url.endsWith(oldPath));assert.ok(!image.photo_url.includes('token='));
 const newsletter=withNewsletterGalleryImages(db,{articles:[{galleries:[{images:[{team_photo_path:oldPath,alt:'Erste'},{photo_path:'private/unavailable.jpg'}]}]}]});
 assert.deepEqual(newsletter.articles[0].galleries[0].images,[{alt:'Erste',photo_url:image.photo_url}]);
 current=newPath;
 const reused=await prepareEditorialGalleries(db,'issue',article,[{...input[0],images:[{id:'image',alt:'Geändert'}]}]);
 assert.equal(reused.galleries[0].images[0].team_photo_path,oldPath);
 const fresh=await prepareEditorialGalleries(db,'issue',{kind:'free'},input);
 assert.equal(fresh.galleries[0].images[0].team_photo_path,newPath);
 current=null;
 await assert.rejects(()=>prepareEditorialGalleries(db,'issue',{kind:'free'},input),/kein Bild mehr/);
 await assert.rejects(()=>prepareEditorialGalleries(db,'issue',{kind:'free'},[{...input[0],images:[{id:'image',alt:'',team_photo_path:oldPath}]}]),/gehört nicht/);
});
