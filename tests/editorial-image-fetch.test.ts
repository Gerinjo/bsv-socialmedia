import assert from 'node:assert/strict';
import {fetchEditorialImage} from '../supabase/functions/_shared/editorial-image-fetch.ts';
const source = new URL('https://gerinjo.github.io/bsv-website/images/portrait.jpg');
Deno.test('club image redirects resolve relative paths and use one shared timeout', async () => {
 const requested:string[]=[],signals:any[]=[];
 const response=await fetchEditorialImage(source,async(url,options)=>{
  requested.push(String(url));signals.push(options?.signal);assert.equal(options?.redirect,'manual');
  return requested.length===1 ? new Response(null,{status:301,headers:{location:'https://bsvnordstern.de/images/portrait.jpg'}})
   : requested.length===2 ? new Response(null,{status:308,headers:{location:'./new.jpg'}})
   : new Response('image',{headers:{'content-type':'image/jpeg'}});
 });
 assert.equal(await response.text(),'image');assert.equal(requested[2],'https://bsvnordstern.de/images/new.jpg');assert.ok(signals.every(s=>s===signals[0]));
});
Deno.test('image redirects cannot escape the trusted inventory', async () => {
 for(const location of ['https://evil.example/images/photo.jpg','http://bsvnordstern.de/images/photo.jpg','https://bsvnordstern.de/private','https://bsvnordstern.de:8443/images/photo.jpg','https://user:password@bsvnordstern.de/images/photo.jpg','https://127.0.0.1/images/photo.jpg']) {
  let calls=0;
  await assert.rejects(()=>fetchEditorialImage(source,async()=>{calls++;return new Response(null,{status:302,headers:{location}})}),/Vereins-Bildbestand/);
  assert.equal(calls,1);
 }
});
Deno.test('broken redirects and loops fail with a bounded number of requests', async () => {
 await assert.rejects(()=>fetchEditorialImage(source,async()=>new Response(null,{status:301})),/Zieladresse/);
 let calls=0;
 await assert.rejects(()=>fetchEditorialImage(source,async()=>{calls++;return new Response(null,{status:302,headers:{location:source.href}})}),/schleife/);assert.equal(calls,1);
 calls=0;
 await assert.rejects(()=>fetchEditorialImage(source,async()=>{calls++;return new Response(null,{status:307,headers:{location:'https://bsvnordstern.de/images/'+calls+'.jpg'}})}),/zu viele/);assert.equal(calls,4);
});
