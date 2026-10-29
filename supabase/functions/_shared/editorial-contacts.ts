import {editorialContactDirectory} from '../../../src/editorial-contacts.mjs';
export async function withEditorialContacts(db: any, snapshot: any) {
  if (snapshot.kind !== 'stadium') return snapshot;
  const [employees,trainers,teams]=await Promise.all([
    db.rpc('website_employee_groups'),
    db.rpc('website_trainers_feed'),
    db.from('social_teams').select('name,slug,website_path').order('sort_order').order('name'),
  ]);
  if (employees.error || trainers.error || teams.error) throw new Error('Die aktuelle Kontaktübersicht konnte nicht geladen werden. Bitte erneut öffnen.');
  const contacts=editorialContactDirectory({assignments:employees.data?.assignments,trainerTeams:trainers.data?.teams,teams:teams.data});
  return {...snapshot,contacts};
}
