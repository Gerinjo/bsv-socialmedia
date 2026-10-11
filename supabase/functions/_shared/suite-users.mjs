import {validateSuitePerson} from '../../../src/suite-access.mjs';
import {SUITE_INITIAL_PASSWORD} from './suite-accounts.mjs';
export async function suiteUsersRpc(db,actor,payload){
 const {data,error}=await db.rpc('suite_users_request',{actor,payload});
 if(error)throw new Error(error.code==='23505'?'Dieses Login ist bereits vergeben.':error.message);
 if(!data||data.error)throw Object.assign(new Error(data?.error||'Benutzeraktion fehlgeschlagen.'),{status:data?.status||400});
 return data;
}
export async function handleSuiteUsers(db,actor,body){
 if(body.action==='save_suite_role')return suiteUsersRpc(db,actor,{action:'save_role',key:body.key,accessAreas:body.accessAreas});
 if(body.action==='save_suite_member')return suiteUsersRpc(db,actor,{...validateSuitePerson(body,{allowShared:true}),action:'save_member'});
 if(body.action==='bulk_suite_users'){
  if(body.operation==='delete'){
   const prepared=await suiteUsersRpc(db,actor,{action:'prepare_delete',userIds:body.userIds});
   const results=[];
   for(const id of prepared.userIds){
    const {error}=await db.auth.admin.deleteUser(id);
    if(error){results.push({userId:id,ok:false,error:error.message});continue;}
    const {error:deleteError}=await db.from('social_admins').delete().eq('user_id',id);
    results.push({userId:id,ok:!deleteError,error:deleteError?.message});
   }
   return {ok:results.every(r=>r.ok),results};
  }
  const result=await suiteUsersRpc(db,actor,{action:'bulk_state',operation:body.operation,userIds:body.userIds});
  // Clear any ban left by the former member editor when reactivating a login.
  if(['activate','unblock'].includes(body.operation)){
   const results=[];
   for(const id of result.userIds){const {error}=await db.auth.admin.updateUserById(id,{ban_duration:'none'});results.push({userId:id,ok:!error,error:error?.message});}
   return {...result,ok:results.every(r=>r.ok),results};
  }
  return result;
 }
 if(body.action==='create_team_member'){
  const person=validateSuitePerson(body);
  const source=await suiteUsersRpc(db,actor,{action:'roles'});
  if(!source.roles.some(r=>r.key===person.roleKey))throw new Error('Bitte eine gültige Rolle auswählen.');
  const email=String(body.email||'').trim().toLowerCase()||`cashbook-${crypto.randomUUID()}@suite.bsvnordstern.invalid`;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Bitte eine gültige E-Mail-Adresse eingeben oder das Feld leer lassen.');
  const {data,error}=await db.auth.admin.createUser({email,password:SUITE_INITIAL_PASSWORD,email_confirm:true});
  if(error)throw error;
  try {await suiteUsersRpc(db,actor,{...person,action:'create_member',userId:data.user.id,email,isActive:body.isActive!==false});}
  catch(error){await db.auth.admin.deleteUser(data.user.id);throw error;}
  return {ok:true,userId:data.user.id};
 }
 throw new Error('Die Benutzerverwaltung wurde aktualisiert. Bitte die Seite neu laden.');
}
