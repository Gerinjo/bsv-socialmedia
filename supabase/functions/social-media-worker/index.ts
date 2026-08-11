import { withSupabase } from 'npm:@supabase/server@1.4.1';
import { runtimeConfig } from '../_shared/config.ts';

type JobStatus = 'pending' | 'rendering' | 'preview_ready' | 'published' | 'failed' | 'skipped' | 'needs_input';

type GameJob = {
  id: string;
  attempts: number;
  status: JobStatus;
  story_type: 'announcement' | 'lineup' | 'result';
  game: {
    id: string;
    source_match_id: string | null;
    home_team: string;
    away_team: string;
    competition: string | null;
    venue: string | null;
    kickoff_at: string;
    home_score: number | null;
    away_score: number | null;
    result_label: string | null;
    result_message: string | null;
    lineup: { players?: unknown[]; formation?: string; approvedAt?: string } | null;
    enabled: boolean;
  };
};

type BirthdayJob = {
  id: string;
  attempts: number;
  status: JobStatus;
  birthday: {
    id: string;
    person_name: string;
    birth_date: string;
    message: string;
    photo_path: string | null;
    enabled: boolean;
  };
};

type RenderPayload = { mediaUrl?: string; storagePath?: string; error?: string };

async function render(body: Record<string, unknown>): Promise<RenderPayload> {
  if (!runtimeConfig.renderEndpoint || !runtimeConfig.renderApiKey) {
    throw new Error('Render-Endpunkt oder interner API-Key fehlt.');
  }

  const response = await fetch(runtimeConfig.renderEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: runtimeConfig.renderApiKey,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as RenderPayload;
  if (!response.ok) throw new Error(payload.error || `Renderdienst antwortet mit HTTP ${response.status}.`);
  if (!payload.mediaUrl || !payload.storagePath) throw new Error('Renderdienst liefert keine vollständige Vorschau.');
  return payload;
}

function retryAt(attempt: number): string {
  return new Date(Date.now() + Math.min(attempt, 3) * 5 * 60 * 1000).toISOString();
}

const secretHandler = withSupabase({ auth: 'secret' }, async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });

    const now = new Date().toISOString();
    const summary = {
      claimed: 0,
      previewReady: 0,
      needsInput: 0,
      retrying: 0,
      failed: 0,
      testMode: runtimeConfig.testMode,
    };

    const { data: gameData, error: gameError } = await context.supabaseAdmin
      .from('social_story_jobs')
      .select(`
        id, attempts, status, story_type,
        game:social_games!inner(
          id, source_match_id, home_team, away_team, competition, venue,
          kickoff_at, home_score, away_score, result_label, result_message,
          lineup, enabled
        )
      `)
      .eq('status', 'pending')
      .lte('due_at', now)
      .order('due_at', { ascending: true })
      .limit(10);
    if (gameError) return Response.json({ error: gameError.message }, { status: 500 });

    for (const candidate of (gameData ?? []) as unknown as GameJob[]) {
      if (!candidate.game.enabled) continue;
      const attempt = candidate.attempts + 1;
      const { data: claimed } = await context.supabaseAdmin
        .from('social_story_jobs')
        .update({ status: 'rendering', claimed_at: now, attempts: attempt })
        .eq('id', candidate.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (!claimed) continue;
      summary.claimed += 1;

      if (candidate.story_type === 'lineup' && !candidate.game.lineup?.approvedAt) {
        await context.supabaseAdmin
          .from('social_story_jobs')
          .update({ status: 'needs_input', last_error: 'Aufstellung ist noch nicht freigegeben.' })
          .eq('id', candidate.id);
        summary.needsInput += 1;
        continue;
      }

      try {
        const preview = await render({
          type: candidate.story_type,
          jobId: candidate.id,
          game: candidate.game,
        });
        if (!runtimeConfig.testMode) {
          throw new Error('Produktiv-Publisher ist absichtlich noch nicht aktiviert.');
        }
        await context.supabaseAdmin
          .from('social_story_jobs')
          .update({
            status: 'preview_ready',
            media_url: preview.mediaUrl,
            storage_path: preview.storagePath,
            last_error: null,
          })
          .eq('id', candidate.id);
        summary.previewReady += 1;
      } catch (workerError) {
        const message = workerError instanceof Error ? workerError.message : 'Unbekannter Workerfehler';
        const retry = attempt < 3;
        await context.supabaseAdmin
          .from('social_story_jobs')
          .update({
            status: retry ? 'pending' : 'failed',
            due_at: retry ? retryAt(attempt) : undefined,
            last_error: message,
          })
          .eq('id', candidate.id);
        if (retry) summary.retrying += 1;
        else summary.failed += 1;
      }
    }

    const { data: birthdayData, error: birthdayError } = await context.supabaseAdmin
      .from('social_birthday_jobs')
      .select(`
        id, attempts, status,
        birthday:social_birthdays!inner(id, person_name, birth_date, message, photo_path, enabled)
      `)
      .eq('status', 'pending')
      .lte('due_at', now)
      .order('due_at', { ascending: true })
      .limit(10);
    if (birthdayError) return Response.json({ error: birthdayError.message }, { status: 500 });

    for (const candidate of (birthdayData ?? []) as unknown as BirthdayJob[]) {
      if (!candidate.birthday.enabled) continue;
      const attempt = candidate.attempts + 1;
      const { data: claimed } = await context.supabaseAdmin
        .from('social_birthday_jobs')
        .update({ status: 'rendering', claimed_at: now, attempts: attempt })
        .eq('id', candidate.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (!claimed) continue;
      summary.claimed += 1;

      try {
        const preview = await render({
          type: 'birthday',
          jobId: candidate.id,
          birthday: candidate.birthday,
        });
        if (!runtimeConfig.testMode) {
          throw new Error('Produktiv-Publisher ist absichtlich noch nicht aktiviert.');
        }
        await context.supabaseAdmin
          .from('social_birthday_jobs')
          .update({
            status: 'preview_ready',
            media_url: preview.mediaUrl,
            storage_path: preview.storagePath,
            last_error: null,
          })
          .eq('id', candidate.id);
        summary.previewReady += 1;
      } catch (workerError) {
        const message = workerError instanceof Error ? workerError.message : 'Unbekannter Workerfehler';
        const retry = attempt < 3;
        await context.supabaseAdmin
          .from('social_birthday_jobs')
          .update({
            status: retry ? 'pending' : 'failed',
            due_at: retry ? retryAt(attempt) : undefined,
            last_error: message,
          })
          .eq('id', candidate.id);
        if (retry) summary.retrying += 1;
        else summary.failed += 1;
      }
    }

    return Response.json(summary);
  });

function secretsMatch(candidate: string, expected: string): boolean {
  if (!candidate || candidate.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export default {
  fetch(request: Request): Promise<Response> {
    const cronSecret = request.headers.get('x-bsv-cron-secret') ?? '';
    if (runtimeConfig.workerCronSecret && secretsMatch(cronSecret, runtimeConfig.workerCronSecret)) {
      const headers = new Headers(request.headers);
      headers.set('apikey', runtimeConfig.workerApiKey);
      return secretHandler(new Request(request, { headers }));
    }
    return secretHandler(request);
  },
};
