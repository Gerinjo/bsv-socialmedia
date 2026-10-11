import assert from 'node:assert/strict';
import test from 'node:test';
import {loadSuiteDashboard} from '../supabase/functions/_shared/suite-dashboard.mjs';

const areas=['social_media','sponsoring','editorial','referees','corporate_identity','club_crests','social_media_admin','user_management','cashbook'];
function fixture(accessAreas=areas){
  const calls=[];
  const rows={social_brand_settings:{color_scheme:{accent:'#cccccc'},theme_key:'football'},social_teams:[{id:'team',active:true}],social_admins:[{user_id:'member'}]};
  const admin={from(table){calls.push(table);const query={select(){return query},eq(){return query},order(){return query},single(){return query},maybeSingle(){return query},then(resolve,reject){return Promise.resolve({data:rows[table]??[],error:null}).then(resolve,reject)}};return query;},storage:{from(){throw Error('Loading must never write or seed storage');}}};
  const helpers={json:(data,status=200)=>Response.json(data,{status}),suiteUsersRpc:async(_db,_actor,{action})=>{calls.push(action);return action==='identity'?{userId:'actor',accessAreas}:{roles:[{key:'admin'}]};},suiteMemberDirectory:async(_db,_actor,records)=>{calls.push('directory');return records}};
  for(const helper of ['freshPreviewUrls','freshPostUrls','freshIndependentStoryUrls','freshSponsorUrls','freshClubUrls'])helpers[helper]=async(_db,records)=>{calls.push(helper);return records;};
  return {calls,rows,helpers,options:{admin,userId:'actor',hasArea:area=>accessAreas.includes(area),suiteAreas:areas,runtimeConfig:{testMode:false},homeVenues:new Set(['Hauptplatz']),helpers},run(query=''){return loadSuiteDashboard({...this.options,request:new Request('https://suite.example/api'+query)})}};
}

test('bootstrap reads identity and branding without fetching area data, roles or images',async()=>{
  const f=fixture();const result=await f.run('?bootstrap=1');assert.equal(result.status,200);
  assert.deepEqual(f.calls.sort(),['identity','social_brand_settings']);
  assert.deepEqual(Object.keys(await result.json()).sort(),['brandSettings','testMode','user']);
});

test('an unauthorized or invalid area is rejected before reading privileged data',async()=>{
  for(const [query,status] of [['?area=user_management',403],['?area=unknown',400]]){
    const f=fixture(['cashbook']);const response=await f.run(query);assert.equal(response.status,status);assert.deepEqual(f.calls,[]);
  }
});

test('independent workspaces do not wait for social media, crest or user data',async()=>{
  for(const area of ['cashbook','editorial','referees']){
    const f=fixture();await f.run('?area='+area);assert.deepEqual(f.calls.sort(),['identity','social_brand_settings']);
  }
});

test('Corporate Identity loads team settings but does not prepare media or fetch users',async()=>{
  const f=fixture();const result=await (await f.run('?area=corporate_identity')).json();
  assert.equal(result.teams[0].id,'team');assert.deepEqual(result.members,[]);
  assert.deepEqual(f.calls.sort(),['identity','social_brand_settings','social_team_color_groups','social_teams']);
});

test('user management fetches roles and the member directory without unrelated tables',async()=>{
  const f=fixture();const result=await (await f.run('?area=user_management')).json();assert.equal(result.members[0].user_id,'member');assert.equal(result.suiteRoles.length,1);
  assert.deepEqual(f.calls.sort(),['directory','identity','roles','social_admins','social_brand_settings']);
});

test('cleanup loads history for counts without signing images',async()=>{
  const f=fixture();const result=await (await f.run('?area=social_media_admin')).json();assert.ok(result.cleanupSummary);
  assert.equal(f.calls.some(call=>call.startsWith('fresh')),false);assert.deepEqual(result.games,[]);
  assert.deepEqual(f.calls.sort(),['identity','social_brand_settings','social_cleanup_settings','social_games','social_independent_stories','social_posts']);
});

test('older unscoped clients receive authorized data without querying other areas',async()=>{
  const f=fixture(['club_crests']);const result=await (await f.run()).json();assert.deepEqual(result.games,[]);
  assert.deepEqual(f.calls.sort(),['freshClubUrls','identity','social_brand_settings','social_clubs']);
  const admin=fixture();const full=await (await admin.run()).json();assert.equal(full.members.length,1);assert.ok(full.cleanupSummary);assert.ok(full.teams.length);
});

test('image URL preparation runs concurrently instead of delaying each following catalog',async()=>{
  const f=fixture();const pending=[];const started=[];
  const names=['freshPreviewUrls','freshPostUrls','freshIndependentStoryUrls','freshSponsorUrls','freshClubUrls'];
  for(const name of names)f.helpers[name]=(_db,records)=>{started.push(name);return new Promise(resolve=>pending.push(()=>resolve(records)));};
  const result=f.run('?area=social_media');await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual([...new Set(started)].sort(),names.sort());assert.equal(pending.length,6);
  pending.forEach(resolve=>resolve());assert.equal((await result).status,200);
});

test('a failed area query reports an error rather than returning a false empty catalog',async()=>{
  const f=fixture();f.options.admin.from=table=>({select(){return this},order(){return this},eq(){return this},single(){return this},then(resolve){resolve(table==='social_brand_settings'?{data:{}}:{error:{message:'database unavailable'}})}});
  const result=await f.run('?area=corporate_identity');assert.equal(result.status,500);assert.equal((await result.json()).error,'database unavailable');
});
