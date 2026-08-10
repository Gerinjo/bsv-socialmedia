import { withSupabase } from 'npm:@supabase/server@1.4.1';
import { runtimeConfig } from '../_shared/config.ts';

type StoryJob = {
  id: string;
  attempts: number;
  story_type: 'announcement' | 'lineup' | 'result';
  game_id: string;
  game: {
    id: string;
    source_match_id: string;
    home_team: string;
    away_team: string;
    competition: string | null;
    venue: string | null;
    kickoff_at: string;
    home_score: number | null;
    away_score: number | null;
    lineup: { players?: unknown[]; approvedAt?: string } | null;
    enabled: boolean;
  };
};

async function render(job: StoryJob): Promise<string> {
  if (!runtimeConfig.renderEndpoint || !runtimeConfig.renderSecret) {
    throw new Error('STORY_RENDER_ENDPOINT oder STORY_RENDER_SECRET fehlt.');
  }

  const response = await fetch(runtimeConfig.renderEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-render-secret': runtimeConfig.renderSecret,
    },
    body: JSON.stringify({ type: job.story_type, game: job.game }),
  });

  if (!response.ok) throw new Error(`Renderdienst antwortet mit HTTP ${response.status}.`);
  const payload = await response.json() as { mediaUrl?: string };
  if (!payload.mediaUrl) throw new Error('Renderdienst liefert keine mediaUrl.');
  return payload.mediaUrl;
}

export default {
  fetch: withSupabase({ auth: 'secret' }, async (request, context) => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const now = new Date().toISOString();
    const { data, error } = await context.supabaseAdmin
      .from('social_story_jobs')
      .select(`
        id,
        attempts,
        story_type,
        game_id,
        game:social_games!inner(
          id, source_match_id, home_team, away_team, competition, venue,
          kickoff_at, home_score, away_score, lineup, enabled
        )
      `)
      .eq('status', 'pending')
      .lte('due_at', now)
      .order('due_at', { ascending: true })
      .limit(10);

    if (error) return Response.json({ error: error.message }, { status: 500 });

    const summary = { claimed: 0, previewReady: 0, needsInput: 0, failed: 0, testMode: runtimeConfig.testMode };

    for (const candidate of (data ?? []) as unknown as StoryJob[]) {
      if (!candidate.game.enabled) continue;

      const { data: claimed } = await context.supabaseAdmin
        .from('social_story_jobs')
        .update({ status: 'rendering', claimed_at: now, attempts: candidate.attempts + 1 })
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
        const mediaUrl = await render(candidate);

        if (!runtimeConfig.testMode) {
          throw new Error('Produktiv-Publisher ist in Version 0.1 absichtlich noch nicht aktiviert.');
        }

        await context.supabaseAdmin
          .from('social_story_jobs')
          .update({ status: 'preview_ready', media_url: mediaUrl, last_error: null })
          .eq('id', candidate.id);
        summary.previewReady += 1;
      } catch (workerError) {
        const message = workerError instanceof Error ? workerError.message : 'Unbekannter Workerfehler';
        await context.supabaseAdmin
          .from('social_story_jobs')
          .update({ status: 'failed', last_error: message })
          .eq('id', candidate.id);
        summary.failed += 1;
      }
    }

    return Response.json(summary);
  }),
};
