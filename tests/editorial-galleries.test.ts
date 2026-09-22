import assert from 'node:assert/strict';
import { prepareEditorialGalleries,withEditorialGalleries } from '../supabase/functions/_shared/editorial-galleries.ts';
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
