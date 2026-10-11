import {enrichSuiteMembers} from '../../../src/suite-members.mjs';

export async function suiteMemberDirectory(db, actor, members) {
  // The existing service-only admin RPC checks the requesting administrator afresh.
  const {data,error} = await db.rpc('cashbook_admin_request', {actor,payload:{action:'cashbook_load'}});
  if (error || !data || data.error) throw new Error('Die Namen und Login-Kürzel der Benutzer konnten nicht geladen werden.');
  const {data:roles,error:roleError}=await db.from('social_suite_roles').select('key,label');
  if(roleError)throw roleError;
  return enrichSuiteMembers(members,data.accounts || []).map(member=>({...member,role_label:roles.find(role=>role.key===member.suite_role_key)?.label}));
}
