import test from 'node:test';
import assert from 'node:assert/strict';
import {SUITE_AREAS,suiteNavigationAreas,suiteStartArea,suitePermissionArea} from '../src/suite-access.mjs';

test('one sidebar function opens directly, multiple functions start at the welcome page',()=>{
 for(const area of SUITE_AREAS)assert.equal(suiteStartArea([area]),area==='editorial'?'welcome':area);
 assert.equal(suiteStartArea(['cashbook','trainer_management']),'welcome');
 assert.equal(suiteStartArea(['social_media','cashbook']),'welcome');
 assert.equal(suiteStartArea(SUITE_AREAS),'welcome');
 assert.equal(suiteStartArea(['cashbook','cashbook','unknown']),'cashbook');
 assert.equal(suiteStartArea([]),'');
 assert.equal(suiteStartArea(['unknown']),'');
});

test('stadium and newsletter are separate entries using the existing editorial grant',()=>{
 assert.deepEqual(suiteNavigationAreas(['editorial']),['stadium','newsletter']);
 assert.equal(suitePermissionArea('stadium'),'editorial');assert.equal(suitePermissionArea('newsletter'),'editorial');
 for(const area of ['stadium','newsletter'])assert.equal(suiteStartArea(['editorial'],area),area);
 assert.equal(suiteStartArea(['editorial'],'editorial'),'stadium');
 assert.equal(suiteStartArea(['cashbook'],'newsletter'),'cashbook');
 assert.deepEqual(suiteNavigationAreas(['newsletter','stadium']),[]);
 assert.equal(SUITE_AREAS.includes('newsletter'),false);assert.equal(SUITE_AREAS.includes('stadium'),false);
});

test('Social Media and its administration are counted as one sidebar function',()=>{
 assert.deepEqual(suiteNavigationAreas(['social_media_admin','social_media']),['social_media']);
 assert.equal(suiteStartArea(['social_media_admin','social_media']),'social_media');
 assert.equal(suiteStartArea(['social_media_admin']),'social_media_admin');
 assert.equal(suiteStartArea(['social_media_admin','cashbook']),'welcome');
 assert.deepEqual(suiteNavigationAreas(['cashbook','social_media_admin','corporate_identity']),['corporate_identity','social_media_admin','cashbook']);
});

test('explicit permitted links work, unavailable and unknown links use the safe start page',()=>{
 assert.equal(suiteStartArea(['social_media','cashbook'],'cashbook'),'cashbook');
 assert.equal(suiteStartArea(['cashbook'],'social_media'),'cashbook');
 assert.equal(suiteStartArea(['cashbook','trainer_management'],'social_media'),'welcome');
 assert.equal(suiteStartArea(['social_media_admin'],'social_media'),'social_media_admin');
 assert.equal(suiteStartArea(SUITE_AREAS,'unknown'),'welcome');
 assert.equal(suiteStartArea([],'cashbook'),'');
});
