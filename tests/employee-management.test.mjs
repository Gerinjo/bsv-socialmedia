import test from 'node:test';import assert from 'node:assert/strict';
import {EMPLOYEE_GROUPS,validateEmployeeAssignment,validateEmployeePhoto,validateEmployeeContact} from '../src/employee-management.mjs';
import {handleEmployeeManagement,employeePhotoUrl} from '../supabase/functions/_shared/employee-management.mjs';
const id='00000000-0000-4000-8000-000000000001',roleKey='role-'+id;
test('employee contact edits validate shared identity, revision, mail and phone while preserving privacy',async()=>{
 const body={personId:id,version:0,contactSource:'employee',email:' Current@Example.test ',phone:'+49 (123) 456',publicPhone:true};
 const v=validateEmployeeContact(body);assert.equal(v.email,'current@example.test');assert.equal(v.publicPhone,true);
 for(const invalid of [{personId:'bad'},{version:-1},{contactSource:'other'},{email:'bad'},{phone:'<script>'},{mobile:'abc'}])assert.throws(()=>validateEmployeeContact({...body,...invalid}));
 let sent;const db={rpc:async(name,args)=>{sent=args;return {data:{ok:true,contactVersion:1}};}};
 await handleEmployeeManagement(db,'authorized-actor',{action:'employee_save_contact',...body,active:true,role:'trainer'});
 assert.equal(sent.actor,'authorized-actor');assert.deepEqual(sent.payload,{action:'save_contact',...v});assert.equal(sent.payload.active,undefined);
});
test('employees offer the six requested circles and reject invalid assignments',()=>{
 assert.deepEqual(EMPLOYEE_GROUPS.map(g=>g.key),['executive','board','trainers','teams','youth','supporters']);
 assert.throws(()=>validateEmployeeAssignment({groupKey:'teams',version:0,roleLabel:'Trainer'}));
 assert.throws(()=>validateEmployeeAssignment({groupKey:'youth',version:0,roleLabel:'Jugendleiter',personId:'invalid'}));
 assert.throws(()=>validateEmployeeAssignment({groupKey:'board',version:0,roleLabel:'Role',firstName:'Anna'}));
 assert.equal(validateEmployeeAssignment({groupKey:'board',version:0,roleLabel:'Role',personId:id}).personId,id);
 assert.throws(()=>validateEmployeePhoto({personId:id,roleKey,version:0}));
});
test('role uploads check live membership rights and revisions before touching storage',async()=>{
 let touched=false;const db={rpc:async()=>({data:{error:'Kein Zugriff',status:403}}),storage:{from(){touched=true;throw new Error('unexpected');}}};
 await assert.rejects(()=>handleEmployeeManagement(db,'actor',{action:'employee_upload_photo',personId:id,roleKey,version:1,photo:'invalid'}),e=>e.status===403);assert.equal(touched,false);
});
test('role upload validates bytes, uses private storage and preserves the target role',async()=>{
 const calls=[];let stored;
 const db={rpc:async(name,{payload})=>{calls.push(payload);return {data:{ok:true,version:2}};},storage:{from(bucket){assert.equal(bucket,'employee-portraits');return {upload:async(path,bytes,options)=>{stored=path;assert.equal(options.upsert,false);return {error:null};}};}}};
 const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII=';
 await handleEmployeeManagement(db,'actor',{action:'employee_upload_photo',personId:id,roleKey,version:1,photo});
 assert.equal(calls[0].action,'authorize_photo');assert.equal(calls[1].roleKey,roleKey);assert.equal(calls[1].photoPath,stored);assert.match(stored,new RegExp('^'+id+'/[a-f0-9]{64}\\.png$'));
 await assert.rejects(()=>handleEmployeeManagement(db,'actor',{action:'employee_upload_photo',personId:id,roleKey,version:1,photo:'data:image/png;base64,JVBERi0xLjc='}));
});
test('employee list hides internal image sources and identifies inherited pictures',async()=>{
 const db={rpc:async()=>({data:{people:[],assignments:[{name:'Anna',photoSource:{bucket:'trainer-portraits',path:'private.png',inherited:true}}]}}),storage:{from(){return {createSignedUrl:async()=>({data:{signedUrl:'https://example.org/photo'},error:null})};}}};
 const result=await handleEmployeeManagement(db,'actor',{action:'employee_list'});assert.equal(result.assignments[0].photoInherited,true);assert.equal(result.assignments[0].hasOwnPhoto,false);assert.equal(result.assignments[0].photoSource,undefined);
 await assert.rejects(()=>employeePhotoUrl(db,{bucket:'unknown',path:'image'}));
});
