import { withSupabase } from 'npm:@supabase/server@1.4.1';
import { runtimeConfig } from '../_shared/config.ts';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const bucket = 'social-story-previews';
const homeVenues = new Set(['Hauptplatz', 'Nebenplatz', 'Kunstrasenplatz 1', 'Kunstrasenplatz 2']);

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: corsHeaders });
}

function required(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} fehlt.`);
  return normalized;
}

async function runWorker(): Promise<Record<string, unknown>> {
  if (!runtimeConfig.supabaseUrl || !runtimeConfig.workerApiKey) {
    throw new Error('Die automatische Vorschau ist nicht konfiguriert.');
  }
  const response = await fetch(`${runtimeConfig.supabaseUrl}/functions/v1/social-media-worker`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: runtimeConfig.workerApiKey,
    },
    body: JSON.stringify({ trigger: 'admin-save', requested_at: new Date().toISOString() }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? `Vorschau-Worker antwortet mit HTTP ${response.status}.`));
  return payload;
}

async function renderGameJobNow(admin: any, gameId: string, storyType: 'announcement' | 'lineup' | 'result') {
  const { error } = await admin
    .from('social_story_jobs')
    .update({
      status: 'pending',
      due_at: new Date().toISOString(),
      attempts: 0,
      claimed_at: null,
      last_error: null,
    })
    .eq('game_id', gameId)
    .eq('story_type', storyType)
    .in('status', ['pending', 'preview_ready', 'failed', 'needs_input', 'skipped']);
  if (error) throw error;
  return runWorker();
}

async function freshPreviewUrls(admin: any, rows: any[]): Promise<any[]> {
  return await Promise.all(rows.map(async (row) => {
    const jobs = await Promise.all((row.jobs ?? []).map(async (job: any) => {
      if (!job.storage_path) return job;
      const { data } = await admin.storage.from(bucket).createSignedUrl(job.storage_path, 60 * 60 * 24 * 7);
      return { ...job, media_url: data?.signedUrl ?? job.media_url };
    }));
    return { ...row, jobs };
  }));
}

const securedHandler = withSupabase({ auth: 'user' }, async (request, context) => {
  const claims = context.userClaims as Record<string, unknown> | undefined;
  const userId = String(claims?.sub ?? claims?.id ?? '');
  const email = String(claims?.email ?? '');
  if (!userId) return json({ error: 'identity_missing' }, 401);

  const { data: membership, error: membershipError } = await context.supabaseAdmin
    .from('social_admins')
    .select('user_id, email')
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) return json({ error: membershipError.message }, 500);
  if (!membership) {
    return json({ error: 'not_authorized', userId, email }, 403);
  }

  if (request.method === 'GET') {
    const [
      { data: games, error: gamesError },
      { data: birthdays, error: birthdaysError },
      { data: teams, error: teamsError },
      { data: people, error: peopleError },
    ] = await Promise.all([
      context.supabaseAdmin
        .from('social_games')
        .select('*, jobs:social_story_jobs(*)')
        .order('kickoff_at', { ascending: true }),
      context.supabaseAdmin
        .from('social_birthdays')
        .select('*, person:social_people(id, display_name, source_photo_url, cutout_path, birth_date), jobs:social_birthday_jobs(*)')
        .order('birth_date', { ascending: true }),
      context.supabaseAdmin
        .from('social_teams')
        .select('id, slug, name, competition, website_path, fussball_de_url, sort_order')
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      context.supabaseAdmin
        .from('social_people')
        .select('id, slug, display_name, roles, source_photo_url, cutout_path, birth_date')
        .eq('active', true)
        .order('display_name', { ascending: true }),
    ]);
    const readError = gamesError ?? birthdaysError ?? teamsError ?? peopleError;
    if (readError) return json({ error: readError.message }, 500);
    return json({
      user: { userId, email },
      testMode: true,
      venues: [...homeVenues],
      teams: teams ?? [],
      people: people ?? [],
      games: await freshPreviewUrls(context.supabaseAdmin, games ?? []),
      birthdays: await freshPreviewUrls(context.supabaseAdmin, birthdays ?? []),
    });
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await request.json() as Record<string, any>;
    const action = required(body.action, 'Aktion');

    if (action === 'save_game') {
      const kickoff = new Date(required(body.kickoffAt, 'Anstoß'));
      if (Number.isNaN(kickoff.getTime())) throw new Error('Anstoß ist ungültig.');
      const teamId = required(body.teamId, 'BSV-Mannschaft');
      const { data: team, error: teamError } = await context.supabaseAdmin
        .from('social_teams')
        .select('id, name, competition')
        .eq('id', teamId)
        .eq('active', true)
        .maybeSingle();
      if (teamError) throw teamError;
      if (!team) throw new Error('Die ausgewählte BSV-Mannschaft ist nicht aktiv.');
      const opponent = required(body.opponent, 'Gegner');
      const isHome = body.matchType === 'home';
      if (!isHome && body.matchType !== 'away') throw new Error('Bitte Heim- oder Auswärtsspiel auswählen.');
      const venue = isHome ? required(body.venue, 'Sportplatz') : null;
      if (venue && !homeVenues.has(venue)) throw new Error('Der ausgewählte Sportplatz ist ungültig.');
      const payload: Record<string, unknown> = {
        source: body.source === 'fussball.de' ? 'fussball.de' : 'manual',
        source_match_id: String(body.sourceMatchId ?? '').trim() || null,
        source_url: String(body.sourceUrl ?? '').trim() || null,
        team_id: team.id,
        is_home: isHome,
        home_team: isHome ? team.name : opponent,
        away_team: isHome ? opponent : team.name,
        competition: team.competition,
        venue,
        kickoff_at: kickoff.toISOString(),
        enabled: body.enabled !== false,
      };
      if (body.id) payload.id = body.id;
      const { data, error } = await context.supabaseAdmin.from('social_games').upsert(payload).select().single();
      if (error) throw error;
      const automation = await renderGameJobNow(context.supabaseAdmin, data.id, 'announcement');
      return json({ ok: true, game: data, automation });
    }

    if (action === 'save_lineup') {
      const players = Array.isArray(body.players) ? body.players.slice(0, 11).map((player: any) => ({
        number: required(player.number, 'Rückennummer'),
        name: required(player.name, 'Spielername'),
      })) : [];
      const lineup = {
        formation: String(body.formation ?? '').trim() || 'FORMATION FOLGT',
        players,
        approvedAt: body.approved ? new Date().toISOString() : null,
      };
      const { error } = await context.supabaseAdmin
        .from('social_games')
        .update({ lineup })
        .eq('id', required(body.gameId, 'Spiel-ID'));
      if (error) throw error;
      if (body.approved) {
        const automation = await renderGameJobNow(context.supabaseAdmin, body.gameId, 'lineup');
        return json({ ok: true, automation });
      }
      return json({ ok: true });
    }

    if (action === 'save_result') {
      const homeScore = Number(body.homeScore);
      const awayScore = Number(body.awayScore);
      if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
        throw new Error('Das Ergebnis muss aus zwei nicht-negativen ganzen Zahlen bestehen.');
      }
      const gameId = required(body.gameId, 'Spiel-ID');
      const { error } = await context.supabaseAdmin
        .from('social_games')
        .update({
          home_score: homeScore,
          away_score: awayScore,
          result_label: String(body.resultLabel ?? '').trim() || null,
          result_message: String(body.resultMessage ?? '').trim() || null,
          status: 'finished',
        })
        .eq('id', gameId);
      if (error) throw error;
      const automation = await renderGameJobNow(context.supabaseAdmin, gameId, 'result');
      return json({ ok: true, automation });
    }

    if (action === 'save_birthday') {
      const personId = required(body.personId, 'Person');
      const birthDate = required(body.birthDate, 'Geburtsdatum');
      const { data: person, error: personError } = await context.supabaseAdmin
        .from('social_people')
        .select('id, display_name, source_photo_url, cutout_path')
        .eq('id', personId)
        .eq('active', true)
        .maybeSingle();
      if (personError) throw personError;
      if (!person) throw new Error('Die ausgewählte Person ist nicht aktiv.');
      const payload: Record<string, unknown> = {
        person_id: person.id,
        person_name: person.display_name,
        birth_date: birthDate,
        message: String(body.message ?? '').trim() || 'Wir wünschen dir einen großartigen Geburtstag!',
        publish_time: String(body.publishTime ?? '').trim() || '09:00',
        photo_path: person.cutout_path || person.source_photo_url || null,
        enabled: body.enabled !== false,
      };
      const { error: dateError } = await context.supabaseAdmin
        .from('social_people')
        .update({ birth_date: birthDate })
        .eq('id', person.id);
      if (dateError) throw dateError;
      const { data: existing, error: existingError } = await context.supabaseAdmin
        .from('social_birthdays')
        .select('id')
        .eq('person_id', person.id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing?.id) payload.id = existing.id;
      const { data, error } = await context.supabaseAdmin
        .from('social_birthdays')
        .upsert(payload)
        .select()
        .single();
      if (error) throw error;
      const { data: nextJob, error: nextJobError } = await context.supabaseAdmin
        .from('social_birthday_jobs')
        .select('id')
        .eq('birthday_id', data.id)
        .in('status', ['pending', 'preview_ready', 'failed', 'needs_input', 'skipped'])
        .order('due_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (nextJobError) throw nextJobError;
      let automation: Record<string, unknown> | null = null;
      if (nextJob) {
        const { error: queueError } = await context.supabaseAdmin
          .from('social_birthday_jobs')
          .update({
            status: 'pending',
            due_at: new Date().toISOString(),
            attempts: 0,
            claimed_at: null,
            last_error: null,
          })
          .eq('id', nextJob.id);
        if (queueError) throw queueError;
        automation = await runWorker();
      }
      return json({ ok: true, birthday: data, automation });
    }

    if (action === 'retry_job') {
      const table = body.kind === 'birthday' ? 'social_birthday_jobs' : 'social_story_jobs';
      const { error } = await context.supabaseAdmin
        .from(table)
        .update({ status: 'pending', due_at: new Date().toISOString(), attempts: 0, last_error: null })
        .eq('id', required(body.jobId, 'Job-ID'));
      if (error) throw error;
      const automation = await runWorker();
      return json({ ok: true, automation });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
    return json({ error: message }, 400);
  }
});

export default {
  fetch(request: Request): Promise<Response> | Response {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    return securedHandler(request);
  },
};
