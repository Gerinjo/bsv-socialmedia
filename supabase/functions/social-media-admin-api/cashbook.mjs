import { cashbookMedia } from '../_shared/cashbook-evidence.mjs';
import { SUITE_INITIAL_PASSWORD } from '../_shared/suite-accounts.mjs';
export async function handleCashbookAdmin(db, actor, body) {
  if (!['cashbook_load', 'cashbook_import', 'cashbook_account', 'cashbook_settings', 'cashbook_team', 'cashbook_media','cashbook_provision'].includes(body.action)) throw new Error('Unbekannte Kassenbuchaktion.');
  if (body.action === 'cashbook_provision') return provisionCashbookAccounts(db, actor, body);
  const { data, error } = await db.rpc('cashbook_admin_request', { actor, payload: body });
  if (error) throw error;
  if (!data || data.error) throw new Error(data?.error || 'Der Beleg wurde nicht gefunden.');
  return body.action === 'cashbook_media' ? cashbookMedia(db, data) : data;
}

async function adminRpc(db, actor, payload) {
  const { data, error } = await db.rpc('cashbook_admin_request', { actor, payload });
  if (error) throw error;
  if (!data || data.error) throw Object.assign(new Error(data?.error || 'Zugang konnte nicht gespeichert werden.'), {status:data?.status||400});
  return data;
}
export async function provisionCashbookAccounts(db, actor, body) {
  const source = await adminRpc(db, actor, { action:'cashbook_provision_data', personId:body.personId });
  const provision = { created:0, skipped:[], errors:[] };
  for (const account of source.accounts) {
    // Stable address permits retry recovery; an existing suite user's password is never reset.
    const email = `cashbook-${account.id}@suite.bsvnordstern.invalid`;
    try {
      const {data, error} = await db.auth.admin.createUser({email,password:SUITE_INITIAL_PASSWORD,email_confirm:true,user_metadata:{display_name:account.name},app_metadata:{role:'sm-team',access_areas:['cashbook']}});
      let user = data?.user;
      if (error) {
        // Recover only this exact generated identity after an interrupted provisioning attempt.
        if (!['email_exists','user_already_exists'].includes(error.code) && !/already.*(registered|exists)/i.test(error.message||'')) throw error;
        let page = 1;
        do {
          const result = await db.auth.admin.listUsers({page,perPage:100});
          if (result.error) throw result.error;
          user = result.data.users.find(candidate => candidate.email === email);
          if (user || result.data.users.length < 100) break;
          page++;
        } while (page <= 100);
        if (!user) throw error;
      }
      await adminRpc(db, actor, {action:'cashbook_bind',personId:account.personId,userId:user.id,email:user.email||email});
      provision.created++;
    } catch (error) { provision.errors.push({name:account.name,error:error.message}); }
  }
  return {...await adminRpc(db,actor,{action:'cashbook_load'}),provision};
}
