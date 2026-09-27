import { handleRefereeExpenses } from './referee-expenses.ts';
import { loadRefereePortalPeople } from '../_shared/referee-portal.mjs';
export async function handleReferees(db: any, actor: string, body: Record<string, any>) {
  if (['referee_sync_fees','referee_receipt_url','referee_import_account','referee_expense_load','referee_approve_expense','referee_reject_expense'].includes(body.action)) return handleRefereeExpenses(db, actor, body);
  if (body.action === 'referee_load') {
    const [assignments, games, coaches] = await Promise.all([
      db.from('referee_assignments').select('*,game:social_games(id,team_id,home_team,away_team,kickoff_at,status,venue,team:social_teams(name))').order('created_at', { ascending: false }),
      db.from('social_games').select('id,team_id,home_team,away_team,kickoff_at,status').not('team_id', 'is', null).in('status', ['scheduled', 'live', 'finished']).order('kickoff_at', { ascending: false }),
      loadRefereePortalPeople(db, true),
    ]);
    if (assignments.error || games.error) throw assignments.error || games.error;
    return { assignments: assignments.data, games: games.data, coaches: coaches.map((row: any) => ({ personId: row.person_id, name: row.person.display_name + (row.is_club_role ? ' · ' + row.role : ''), team: row.team.name, birthdayReady: row.birthdayReady })) };
  }
  if (!['referee_register', 'referee_pay', 'referee_birthdate'].includes(body.action)) throw new Error('Unbekannte Schiri-Aktion.');
  const { data, error } = await db.rpc('referee_admin_request', { actor, payload: body });
  if (error) throw error;
  if (data.error) throw new Error(data.error);
  return data;
}
