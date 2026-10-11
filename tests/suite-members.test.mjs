import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichSuiteMembers,suiteMemberPresentation} from '../src/suite-members.mjs';
import {suiteMemberDirectory} from '../supabase/functions/_shared/suite-member-directory.mjs';

const id='11111111-1111-4111-8111-111111111111';
const member={user_id:id,email:`cashbook-${id}@suite.bsvnordstern.invalid`,role:'sm-team',is_active:true,access_areas:['cashbook']};
const account={suiteUserId:id,name:'Michael Jentsch',username:'jentm',role:'trainer',isYouthLeader:false};

test('directory identifies real people by linked suite ID and preserves permissions and emails',()=>{
  const original=structuredClone(member);
  const enriched=enrichSuiteMembers([member],[account])[0];
  assert.equal(enriched.display_name,'Michael Jentsch');assert.equal(enriched.username,'jentm');
  assert.deepEqual(enriched.access_areas,['cashbook']);assert.equal(enriched.role,'sm-team');assert.equal(enriched.email,member.email);
  assert.deepEqual(member,original);
  const unmatched=enrichSuiteMembers([member],[{...account,suiteUserId:'other'}])[0];assert.equal(unmatched.display_name,null);
});
test('technical cashbook addresses are replaced by name, short login and actual cash role in the UI',()=>{
  const enriched=enrichSuiteMembers([member],[account])[0];
  assert.deepEqual(suiteMemberPresentation(enriched),{name:'Michael Jentsch',email:'',login:'jentm',role:'Trainer',confirmation:'jentm'});
  assert.equal(suiteMemberPresentation({...enriched,cashbook_role:'cashier'}).role,'Kasse');
  assert.equal(suiteMemberPresentation({...enriched,is_youth_leader:true}).role,'Jugendleitung');
  assert.equal(suiteMemberPresentation({...enriched,role:'admin'}).role,'Super-Admin');
  assert.equal(suiteMemberPresentation(member).name,'Kassenbuchzugang');
  const real=suiteMemberPresentation({...enriched,email:'trainer@example.org'});assert.equal(real.email,'trainer@example.org');assert.equal(real.confirmation,'jentm');
});
test('ordinary accounts continue to use their real email address as their login and deletion confirmation',()=>{
  const view=suiteMemberPresentation({...member,email:'jugend@example.org',display_name:null});
  assert.equal(view.name,'jugend@example.org');assert.equal(view.login,'jugend@example.org');assert.equal(view.confirmation,'jugend@example.org');
});
test('directory fetch uses the authenticated admin actor and never grants rights from labels',async()=>{
  const db={from:()=>({select:async()=>({data:[]})}),rpc:async(name,args)=>{assert.equal(name,'cashbook_admin_request');assert.deepEqual(args,{actor:id,payload:{action:'cashbook_load'}});return {data:{accounts:[account],entries:[{secret:'must not return'}]}};}};
  const result=await suiteMemberDirectory(db,id,[member]);assert.equal(result[0].username,'jentm');assert.equal(result[0].secret,undefined);assert.deepEqual(result[0].access_areas,['cashbook']);
  for(const denied of [{error:{message:'internal'}},{data:{error:'Nur Admin'}},{data:null}])await assert.rejects(()=>suiteMemberDirectory({rpc:async()=>denied},id,[member]),/nicht geladen/);
});
