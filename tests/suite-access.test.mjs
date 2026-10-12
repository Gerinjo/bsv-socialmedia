import test from 'node:test';
import assert from 'node:assert/strict';
import {SUITE_ROLE_SEEDS,suiteMemberRights,validateSuitePerson} from '../src/suite-access.mjs';
import {suiteBrandColors,suiteBrandVariables,SUITE_BRAND_DEFAULT} from '../src/suite-brand.mjs';
import {handleSuiteUsers} from '../supabase/functions/_shared/suite-users.mjs';
test('inherited permissions cannot be cancelled by personal grants',()=>{
 const member={suite_role_key:'trainer',extra_access_areas:['cashbook','editorial','user_management','unknown']};
 assert.deepEqual(suiteMemberRights(member,SUITE_ROLE_SEEDS),{inherited:['cashbook'],extra:['editorial'],effective:['cashbook','editorial']});
 const changed=SUITE_ROLE_SEEDS.map(r=>r.key==='trainer'?{...r,access_areas:['club_crests']}:r);
 assert.deepEqual(suiteMemberRights(member,changed).effective,['club_crests','cashbook','editorial']);
});
test('new people require full names, existing shared accounts can keep missing names',()=>{
 assert.throws(()=>validateSuitePerson({username:'admin'}));
 assert.equal(validateSuitePerson({username:'ADMIN'},{allowShared:true}).username,'admin');
 assert.throws(()=>validateSuitePerson({firstName:'Anna',username:'admin'},{allowShared:true}));
 assert.deepEqual(validateSuitePerson({firstName:' Anna ',lastName:' Test ',username:' TESTA '}),{firstName:'Anna',lastName:'Test',username:'testa'});
});
test('brand validation rejects CSS injection and maps validated colors to UI variables',()=>{
 assert.throws(()=>suiteBrandColors({...SUITE_BRAND_DEFAULT,panel:'red;display:none'}));
 assert.equal(suiteBrandVariables({...SUITE_BRAND_DEFAULT,panel:'#ffffff'})['--accent-contrast'],'#10251a');
 assert.equal(suiteBrandVariables(SUITE_BRAND_DEFAULT)['--accent-contrast'],'#ffffff');
});
test('bulk deletion revokes the whole checked selection before deleting Auth accounts; partial failures remain blocked',async()=>{
 const calls=[];
 const db={rpc:async(name,args)=>{calls.push(['rpc',name,args]);return {data:{ok:true,userIds:['a','b']}}},auth:{admin:{deleteUser:async id=>{calls.push(['auth',id]);return id==='b'?{error:{message:'failed'}}:{}}}},from:()=>({delete:()=>({eq:async(key,id)=>{calls.push(['membership',id]);return {}}})})};
 const result=await handleSuiteUsers(db,'actor',{action:'bulk_suite_users',operation:'delete',userIds:['a','b']});
 assert.equal(calls[0][2].payload.action,'prepare_delete');assert.deepEqual(calls.map(c=>c[0]),['rpc','auth','rpc','auth']);assert.equal(calls[2][2].payload.action,'finish_delete');assert.equal(calls[2][2].payload.userId,'a');
 assert.equal(result.ok,false);assert.deepEqual(result.results,[{userId:'a',ok:true,error:undefined},{userId:'b',ok:false,error:'failed'}]);
});
test('denied preflight makes no Auth mutations',async()=>{
 let mutations=0;const db={rpc:async()=>({data:{error:'forbidden',status:403}}),auth:{admin:{deleteUser:async()=>mutations++,createUser:async()=>mutations++}}};
 await assert.rejects(()=>handleSuiteUsers(db,'actor',{action:'bulk_suite_users',operation:'delete',userIds:['a']}),/forbidden/);
 await assert.rejects(()=>handleSuiteUsers(db,'actor',{action:'create_team_member',firstName:'Anna',lastName:'Test',username:'testa',roleKey:'trainer'}),/forbidden/);
 assert.equal(mutations,0);
});
test('account creation rolls back an Auth identity when membership creation fails',async()=>{
 const actions=[];const db={rpc:async(name,{payload})=>payload.action==='roles'?{data:{roles:SUITE_ROLE_SEEDS}}:{data:{error:'duplicate login',status:400}},auth:{admin:{createUser:async body=>{assert.equal(body.password,'bsv1956');actions.push('create');return {data:{user:{id:'new'}}}},deleteUser:async id=>{assert.equal(id,'new');actions.push('cleanup');return {}}}}};
 await assert.rejects(()=>handleSuiteUsers(db,'actor',{action:'create_team_member',firstName:'Anna',lastName:'Test',username:'testa',roleKey:'trainer',extraAreas:[]}),/duplicate login/);
 assert.deepEqual(actions,['create','cleanup']);
});
