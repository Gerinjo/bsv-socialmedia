import test from 'node:test';
import assert from 'node:assert/strict';
import {portraitUrlResolver} from '../supabase/functions/_shared/portrait-url-cache.mjs';
import {handleEmployeeManagement} from '../supabase/functions/_shared/employee-management.mjs';
const source={bucket:'trainer-portraits',path:'person/portrait.jpg'};
const urlFor=s=>'https://example.supabase.co/storage/v1/object/sign/'+s.bucket+'/'+s.path+'?token=test';
function setup(){
 let clock=Date.parse('2026-11-04T10:00:00Z'),signs=0;
 const entries=new Map(),calls=[];
 const db={rpc:async(name,{payload})=>{
  assert.equal(name,'portrait_url_cache_request');calls.push(payload.action);
  if(payload.action==='get')return {data:{entries:payload.items.map(s=>entries.get(payload.variant+'/'+s.bucket+'/'+s.path)).filter(Boolean)},error:null};
  for(const item of payload.items)entries.set(payload.variant+'/'+item.bucket+'/'+item.path,{...item,variant:payload.variant,expires_at:item.expiresAt});
  return {data:{ok:true},error:null};
 }};
 return {db,calls,entries,now:()=>clock,advance:ms=>{clock+=ms;},sign:async s=>{signs++;return urlFor(s);},get signs(){return signs;}};
}
test('fresh server instances reuse persisted image URLs and duplicate roles sign only once',async()=>{
 const s=setup(),sources=Array.from({length:57},(_,i)=>({...source,path:'person-'+i+'/portrait.jpg'}));
 const first=await portraitUrlResolver(s.db,[...sources,...sources],{variant:'original',sign:s.sign,now:s.now});
 await Promise.all([...sources,...sources].map(first.url));await first.save();
 assert.equal(s.signs,57);assert.deepEqual(s.calls,['get','put']);
 const cold=await portraitUrlResolver(s.db,sources,{variant:'original',sign:s.sign,now:s.now});
 await Promise.all(sources.map(cold.url));await cold.save();
 assert.equal(s.signs,57);assert.deepEqual(s.calls,['get','put','get']);
});
test('expired capabilities, replacement assets and transformation variants obtain their own URLs',async()=>{
 const s=setup();
 async function get(src,variant='original'){const r=await portraitUrlResolver(s.db,[src],{variant,sign:s.sign,now:s.now});const url=await r.url(src);await r.save();return url;}
 await get(source);await get(source);assert.equal(s.signs,1);
 await get(source,'website-900-q95');assert.equal(s.signs,2);
 await get({...source,path:'person/replacement.jpg'});assert.equal(s.signs,3);
 s.advance(46*60000);await get(source);assert.equal(s.signs,4);
});
test('cache failure preserves image availability while a signing failure is retried',async()=>{
 let attempts=0;
 const db={rpc:async()=>{throw new Error('cache unavailable');}};
 const r=await portraitUrlResolver(db,[source],{variant:'original',sign:async s=>{if(++attempts===1)throw new Error('sign failed');return urlFor(s);}});
 await assert.rejects(()=>r.url(source),/sign failed/);assert.equal(await r.url(source),urlFor(source));await r.save();assert.equal(attempts,2);
});
test('external image URLs bypass the cache and private non-portrait buckets are rejected',async()=>{
 const db={rpc:()=>{throw new Error('must not query');}};
 const r=await portraitUrlResolver(db,[{url:'https://suite.bsvnordstern.de/portraits/approved.png'}],{variant:'original',sign:()=>{throw new Error('must not sign');}});
 assert.equal(await r.url({url:'https://suite.bsvnordstern.de/portraits/approved.png'}),'https://suite.bsvnordstern.de/portraits/approved.png');
 assert.equal(await r.url(null),null);await r.save();
 await assert.rejects(()=>portraitUrlResolver(db,[{bucket:'cashbook-evidence',path:'private'}],{variant:'original',sign:()=>{}}),/Bildbestand/);
});
test('a cached image never bypasses a fresh membership authorization failure',async()=>{
 const s=setup();let allowed=true,reads=0;
 const db={rpc:async(name,args)=>{
  if(name==='employee_management_request'){if(!allowed)return {data:{error:'Keine Berechtigung',status:403}};return {data:{assignments:[{name:'Example',photoSource:source},{name:'Example',photoSource:{...source,inherited:true}}]}};}
  reads++;return s.db.rpc(name,args);
 },storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:await s.sign(source)}})})}};
 const first=await handleEmployeeManagement(db,'actor',{action:'employee_list'});
 assert.equal(first.assignments[0].photo_url,first.assignments[1].photo_url);assert.equal(s.signs,1);
 allowed=false;const before=reads;
 await assert.rejects(()=>handleEmployeeManagement(db,'actor',{action:'employee_list'}),e=>e.status===403);
 assert.equal(reads,before);assert.equal(s.signs,1);
});
test('cache entries for another asset are ignored rather than displayed for the requested person',async()=>{
 let signs=0;
 const db={rpc:async()=>({data:{entries:[{...source,variant:'original',url:urlFor({...source,path:'other/private.jpg'}),expires_at:new Date(Date.now()+3600000).toISOString()}]}})};
 const r=await portraitUrlResolver(db,[source],{variant:'original',sign:async s=>{signs++;return urlFor(s);}});
 assert.equal(await r.url(source),urlFor(source));assert.equal(signs,1);
});
