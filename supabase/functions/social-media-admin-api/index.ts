import { withSupabase } from 'npm:@supabase/server@1.4.1';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const bucket = 'social-story-previews';

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: corsHeaders });
}

function required(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} fehlt.`);
  return normalized;
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
    const [{ data: games, error: gamesError }, { data: birthdays, error: birthdaysError }] = await Promise.all([
      context.supabaseAdmin
        .from('social_games')
        .select('*, jobs:social_story_jobs(*)')
        .order('kickoff_at', { ascending: true }),
      context.supabaseAdmin
        .from('social_birthdays')
        .select('*, jobs:social_birthday_jobs(*)')
        .order('birth_date', { ascending: true }),
    ]);
    if (gamesError || birthdaysError) return json({ error: gamesError?.message ?? birthdaysError?.message }, 500);
    return json({
      user: { userId, email },
      testMode: true,
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
      const payload: Record<string, unknown> = {
        source: body.source === 'fussball.de' ? 'fussball.de' : 'manual',
        source_match_id: String(body.sourceMatchId ?? '').trim() || null,
        source_url: String(body.sourceUrl ?? '').trim() || null,
        home_team: required(body.homeTeam, 'Heimteam'),
        away_team: required(body.awayTeam, 'Auswärtsteam'),
        competition: String(body.competition ?? '').trim() || null,
        venue: String(body.venue ?? '').trim() || null,
        kickoff_at: kickoff.toISOString(),
        enabled: body.enabled !== false,
      };
      if (body.id) payload.id = body.id;
      const { data, error } = await context.supabaseAdmin.from('social_games').upsert(payload).select().single();
      if (error) throw error;
      return json({ ok: true, game: data });
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
        await context.supabaseAdmin
          .from('social_story_jobs')
          .update({ status: 'pending', due_at: new Date().toISOString(), last_error: null })
          .eq('game_id', body.gameId)
          .eq('story_type', 'lineup')
          .in('status', ['needs_input', 'failed']);
      }
      return json({ ok: true });
    }

    if (action === 'save_result') {
      const homeScore = Number(body.homeScore);
      const awayScore = Number(body.awayScore);
      if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
        throw new Error('Das Ergebnis muss aus zwei nicht-negativen ganzen Zahlen bestehen.');
      }
      const { error } = await context.supabaseAdmin
        .from('social_games')
        .update({
          home_score: homeScore,
          away_score: awayScore,
          result_label: String(body.resultLabel ?? '').trim() || null,
          result_message: String(body.resultMessage ?? '').trim() || null,
          status: 'finished',
        })
        .eq('id', required(body.gameId, 'Spiel-ID'));
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === 'save_birthday') {
      const payload: Record<string, unknown> = {
        person_name: required(body.personName, 'Name'),
        birth_date: required(body.birthDate, 'Geburtsdatum'),
        message: String(body.message ?? '').trim() || 'Wir wünschen dir einen großartigen Geburtstag!',
        publish_time: String(body.publishTime ?? '').trim() || '09:00',
        photo_path: String(body.photoPath ?? '').trim() || null,
        enabled: body.enabled !== false,
      };
      if (body.id) payload.id = body.id;
      const { data, error } = await context.supabaseAdmin.from('social_birthdays').upsert(payload).select().single();
      if (error) throw error;
      return json({ ok: true, birthday: data });
    }

    if (action === 'retry_job') {
      const table = body.kind === 'birthday' ? 'social_birthday_jobs' : 'social_story_jobs';
      const { error } = await context.supabaseAdmin
        .from(table)
        .update({ status: 'pending', due_at: new Date().toISOString(), attempts: 0, last_error: null })
        .eq('id', required(body.jobId, 'Job-ID'));
      if (error) throw error;
      return json({ ok: true });
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
