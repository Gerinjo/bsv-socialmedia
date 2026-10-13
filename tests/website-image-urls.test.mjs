import test from 'node:test';import assert from 'node:assert/strict';
import {websitePortraitUrl,websiteTeamPhoto} from '../supabase/functions/_shared/website-image-urls.mjs';
test('public portraits keep original proportions and reuse signed transforms across role duplicates',async()=>{
 let signs=0;const db={storage:{from(bucket){assert.equal(bucket,'employee-portraits');return {createSignedUrl:async(path,ttl,options)=>{signs++;assert.equal(ttl,3600);assert.deepEqual(options.transform,{width:900,quality:95,resize:'contain'});return {data:{signedUrl:'https://example.org/'+path+'?generation='+signs},error:null};}};}}};
 const source={bucket:'employee-portraits',path:'image-cache-test/photo.jpg'};
 const [a,b]=await Promise.all([websitePortraitUrl(db,source,{now:100}),websitePortraitUrl(db,source,{now:100})]);assert.equal(a,b);assert.equal(signs,1);
 assert.equal(await websitePortraitUrl(db,source,{now:299999}),a);assert.equal(signs,1);
 assert.notEqual(await websitePortraitUrl(db,source,{now:300101}),a);assert.equal(signs,2);
 assert.equal(await websitePortraitUrl(db,{url:'/images/legacy.jpg'}),'/images/legacy.jpg');
});
test('failed signing is retried and unpublished private buckets are rejected',async()=>{
 let attempts=0;const db={storage:{from(){return {createSignedUrl:async()=>{attempts++;return {error:true};}};}}};
 const source={bucket:'trainer-portraits',path:'retry-photo-test.png'};
 await assert.rejects(()=>websitePortraitUrl(db,source));await assert.rejects(()=>websitePortraitUrl(db,source));assert.equal(attempts,2);
 await assert.rejects(()=>websitePortraitUrl(db,{bucket:'cashbook-receipts',path:'private'}));
});
test('team hero and menu preview have different sharp display sizes without cropping',()=>{
 const calls=[],db={storage:{from(bucket){assert.equal(bucket,'team-photos');return {getPublicUrl(path,options){calls.push(options.transform);return {data:{publicUrl:'image'}};}};}}};
 websiteTeamPhoto(db,'team.jpg');websiteTeamPhoto(db,'team.jpg',900);assert.deepEqual(calls,[{width:1800,quality:95,resize:'contain'},{width:900,quality:95,resize:'contain'}]);
});
