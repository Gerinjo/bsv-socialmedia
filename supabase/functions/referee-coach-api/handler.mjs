import { coachExpenses } from './expenses.mjs';
import { validateRefereeInput } from '../../../src/referees.mjs';

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'apikey, authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'cache-control': 'no-store',
};
const reply = (body, status = 200) => Response.json(body, { status, headers });
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function handleRefereeCoach(request, db) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  try {
    if (request.method === 'GET') {
      const { data, error } = await db.from('social_team_people')
        .select('team_id,person_id,role,team:social_teams!inner(id,name,referee_enabled),person:social_people!inner(id,display_name,active)')
        .ilike('role', '%trainer%').eq('team.referee_enabled', true).eq('person.active', true);
      if (error) throw error;
      return reply({ coaches: data ?? [] });
    }
    if (request.method !== 'POST') return reply({ error: 'Diese Methode wird nicht unterstützt.' }, 405);
    const raw = await request.text();
    if (raw.length > 11300000) return reply({ error: 'Die Anfrage ist zu groß.' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return reply({ error: 'Ungültige Anfrage.' }, 400); }
    if (!body || !['list', 'save', 'expense_list', 'expense_submit'].includes(body.action) || !uuid(body.personId) || !uuid(body.teamId)
      || typeof body.birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.birthDate)) {
      return reply({ error: 'Bitte Mannschaft, Namen und vollständiges Geburtsdatum angeben.' }, 400);
    }
    if (body.action?.startsWith('expense_')) {
      if (body.action === 'expense_submit' && !uuid(body.caseId)) return reply({ error: 'Ungültiges Spiel.' }, 400);
      const result = await coachExpenses(db, body);
      if (result.error) throw result.error;
      return reply(result.data, result.data.error ? (result.data.status || 400) : 200);
    }
    if (body.action === 'save') {
      if (!uuid(body.id)) return reply({ error: 'Ungültiges Spiel.' }, 400);
      try { Object.assign(body, validateRefereeInput(body)); }
      catch (error) { return reply({ error: error.message }, 400); }
    }
    // The service-only RPC checks birthday, current team assignment, lock and version atomically.
    const { data, error } = await db.rpc('referee_coach_request', { payload: {
      action: body.action, personId: body.personId, teamId: body.teamId, birthDate: body.birthDate,
      id: body.id, refereeName: body.refereeName, fieldSize: body.fieldSize, version: body.version,
    } });
    if (error) throw error;
    return reply(data, data.error ? (data.status || 400) : 200);
  } catch {
    // Never echo credentials or database errors to the public portal.
    return reply({ error: 'Die Schiriverwaltung ist vorübergehend nicht verfügbar.' }, 503);
  }
}
