import test from 'node:test';
import assert from 'node:assert/strict';
import {SUITE_AREAS,suiteNavigationAreas,suiteStartArea,suitePermissionArea} from '../src/suite-access.mjs';

test('one sidebar function opens directly, multiple functions start at the welcome page',()=>{
 for(const area of SUITE_AREAS)assert.equal(suiteStartArea([area]),['editorial','trainer_management','trainer_compensation','trainer_contracts'].includes(area)?'welcome':area);
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

 test('football workflow entries reuse grants without granting private contract access',()=>{
 assert.deepEqual(suiteNavigationAreas(['trainer_management']),['trainer_management','football_management','football_trainers']);
 assert.deepEqual(suiteNavigationAreas(['trainer_compensation']),['trainer_compensation','trainer_assignments','trainer_finances']);
 assert.deepEqual(suiteNavigationAreas(['trainer_contracts']),['trainer_assignments','trainer_finances']);
 assert.equal(suitePermissionArea('football_management'),'trainer_management');
 assert.equal(suitePermissionArea('football_trainers'),'trainer_management');
 assert.equal(suiteStartArea(['trainer_management'],'football_trainers'),'football_trainers');
 assert.equal(suiteNavigationAreas([...SUITE_AREAS,'my_contract'])[0],'my_contract');
 assert.equal(suiteStartArea(['trainer_management'],'football_management'),'football_management');
 assert.equal(suiteStartArea(['trainer_compensation'],'trainer_contracts'),'welcome');
 for(const a of ['trainer_assignments','trainer_finances'])assert.equal(suiteStartArea(['trainer_contracts'],a),a);
 });
