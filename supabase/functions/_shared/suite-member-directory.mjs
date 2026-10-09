import {enrichSuiteMembers} from '../../../src/suite-members.mjs';

export async function suiteMemberDirectory(db, actor, members) {
  // The existing service-only admin RPC checks the requesting administrator afresh.
  const {data,error} = await db.rpc('cashbook_admin_request', {actor,payload:{action:'cashbook_load'}});
  if (error || !data || data.error) throw new Error('Die Namen und Login-Kürzel der Benutzer konnten nicht geladen werden.');
  return enrichSuiteMembers(members,data.accounts || []);
}
