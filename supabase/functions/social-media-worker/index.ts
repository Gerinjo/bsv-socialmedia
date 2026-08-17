import { withSupabase } from 'npm:@supabase/server@1.4.1';
import { runtimeConfig } from '../_shared/config.ts';
import { publishInstagramCarousel, publishInstagramImage } from '../../../src/instagram-publisher.mjs';
import { selectAssignedSponsors, sponsorMentionLine } from '../../../src/sponsor-assignments.mjs';
import { teamAllowsAutomaticPublishing, teamContentEnabled } from '../../../src/team-settings.mjs';

type JobStatus = 'pending' | 'rendering' | 'preview_ready' | 'published' | 'failed' | 'skipped' | 'needs_input';

type GameJob = {
  id: string;
  attempts: number;
  status: JobStatus;
  story_type: 'announcement' | 'lineup' | 'result' | 'report';
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
    report_scorers: string | null;
    action_image_path: string | null;
    report_image_paths: string[] | null;
    status: 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled' | 'aborted';
    lineup: { players?: unknown[]; formation?: string; approvedAt?: string } | null;
    team: {
      slug: string;
      active: boolean;
      content_enabled: boolean;
      publishing_mode: 'manual' | 'automatic';
      color_scheme: Record<string, string> | null;
    } | null;
    home_club: {
      crest_status: 'missing' | 'needs_review' | 'approved' | 'rejected';
      crest_transparent_path: string | null;
    } | null;
    away_club: {
      crest_status: 'missing' | 'needs_review' | 'approved' | 'rejected';
      crest_transparent_path: string | null;
    } | null;
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
    person: {
      roles: string[] | null;
    } | null;
  };
};

type PostJob = {
  id: string;
  attempts: number;
  status: JobStatus;
  post: {
    id: string;
    title: string;
    body: string;
    image_paths: string[];
    enabled: boolean;
    audience: {
      id: string;
      slug: string;
      label: string;
      audience_group: string;
      team: {
        active: boolean;
        content_enabled: boolean;
        publishing_mode: 'manual' | 'automatic';
        color_scheme: Record<string, string> | null;
      } | null;
    } | null;
  };
};

type RenderPayload = {
  mediaUrl?: string;
  storagePath?: string;
  mediaUrls?: string[];
  storagePaths?: string[];
  error?: string;
};

const gameJobSelect = `
  id, attempts, status, story_type,
  game:social_games!inner(
    id, source_match_id, home_team, away_team, competition, venue,
    kickoff_at, home_score, away_score, result_label, result_message, report_scorers,
    action_image_path, report_image_paths, status,
    lineup, enabled,
    team:social_teams(slug, active, content_enabled, publishing_mode, color_scheme),
    home_club:social_clubs!social_games_home_club_id_fkey(
      crest_status, crest_transparent_path
    ),
    away_club:social_clubs!social_games_away_club_id_fkey(
      crest_status, crest_transparent_path
    )
  )
`;

const postJobSelect = `
  id, attempts, status,
  post:social_posts!inner(
    id, title, body, image_paths, enabled,
    audience:social_post_audiences(
      id, slug, label, audience_group,
      team:social_teams(active, content_enabled, publishing_mode, color_scheme)
    )
  )
`;

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
  payload.mediaUrls = Array.isArray(payload.mediaUrls) && payload.mediaUrls.length ? payload.mediaUrls : [payload.mediaUrl];
  payload.storagePaths = Array.isArray(payload.storagePaths) && payload.storagePaths.length ? payload.storagePaths : [payload.storagePath];
  if (payload.mediaUrls.length !== payload.storagePaths.length || payload.mediaUrls.length > 10) {
    throw new Error('Renderdienst liefert eine ungültige Seitenliste.');
  }
  return payload;
}

type SponsorConfig = { sponsors: any[]; assignments: any[]; audiences: any[] };

async function sponsorConfig(admin: any): Promise<SponsorConfig> {
  const [{ data: sponsors, error: sponsorError }, { data: assignments, error: assignmentError }, { data: audiences, error: audienceError }] = await Promise.all([
    admin.from('social_sponsors').select('*').eq('active', true),
    admin.from('social_sponsor_assignments').select('sponsor_id, audience_id, context, slot'),
    admin.from('social_post_audiences').select('id, slug, audience_group').eq('active', true),
  ]);
  const error = sponsorError ?? assignmentError ?? audienceError;
  if (error) throw new Error(`Werbepartner konnten nicht geladen werden: ${error.message}`);
  return { sponsors: sponsors ?? [], assignments: assignments ?? [], audiences: audiences ?? [] };
}

function assignedSponsors(config: SponsorConfig, audience: any, context: string) {
  return selectAssignedSponsors({ ...config, audience, context });
}

async function renderGamePreview(candidate: GameJob, sponsors: any[]): Promise<RenderPayload> {
  if (candidate.story_type !== 'report') {
    return render({
      type: candidate.story_type,
      jobId: candidate.id,
      game: candidate.game,
      sponsors,
      colorScheme: candidate.game.team?.color_scheme,
    });
  }

  const storedPaths = Array.isArray(candidate.game.report_image_paths)
    ? candidate.game.report_image_paths.filter((path) => String(path ?? '').trim()).slice(0, 10)
    : [];
  const pageCount = Math.max(storedPaths.length || (candidate.game.action_image_path ? 1 : 0), 1);
  const pages: RenderPayload[] = [];
  for (let reportPageIndex = 0; reportPageIndex < pageCount; reportPageIndex += 1) {
    pages.push(await render({
      type: candidate.story_type,
      jobId: candidate.id,
      game: candidate.game,
      sponsors,
      reportPageIndex,
      reportPageCount: pageCount,
      colorScheme: candidate.game.team?.color_scheme,
    }));
  }
  return {
    mediaUrl: pages[0].mediaUrl,
    storagePath: pages[0].storagePath,
    mediaUrls: pages.map((page) => page.mediaUrl as string),
    storagePaths: pages.map((page) => page.storagePath as string),
  };
}

async function renderPostPreview(candidate: PostJob, sponsors: any[]): Promise<RenderPayload> {
  const paths = Array.isArray(candidate.post.image_paths)
    ? candidate.post.image_paths.filter((path) => String(path ?? '').trim()).slice(0, 10)
    : [];
  if (!paths.length) throw new Error('Bitte mindestens ein Beitragsbild hochladen.');
  const pages: RenderPayload[] = [];
  for (let postPageIndex = 0; postPageIndex < paths.length; postPageIndex += 1) {
    pages.push(await render({
      type: 'post',
      jobId: candidate.id,
      post: candidate.post,
      sponsors,
      postPageIndex,
      postPageCount: paths.length,
      colorScheme: candidate.post.audience?.team?.color_scheme,
    }));
  }
  return {
    mediaUrl: pages[0].mediaUrl,
    storagePath: pages[0].storagePath,
    mediaUrls: pages.map((page) => page.mediaUrl as string),
    storagePaths: pages.map((page) => page.storagePath as string),
  };
}

function retryAt(attempt: number): string {
  return new Date(Date.now() + Math.min(attempt, 3) * 5 * 60 * 1000).toISOString();
}

const secretHandler = withSupabase({ auth: 'secret' }, async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const previewOnly = body.previewOnly === true;
    const targetJobIds = Array.isArray(body.targetJobIds)
      ? [...new Set(body.targetJobIds
        .map((value) => String(value))
        .filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))]
        .slice(0, 10)
      : [];
    const targetPostJobIds = Array.isArray(body.targetPostJobIds)
      ? [...new Set(body.targetPostJobIds
        .map((value) => String(value))
        .filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))]
        .slice(0, 10)
      : [];
    const previewJobIds = Array.isArray(body.previewJobIds)
      ? [...new Set(body.previewJobIds
        .map((value) => String(value))
        .filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))]
        .slice(0, 40)
      : [];

    const now = new Date().toISOString();
    const summary = {
      claimed: 0,
      previewReady: 0,
      needsInput: 0,
      retrying: 0,
      failed: 0,
      previewGenerated: 0,
      previewFailed: 0,
      testMode: runtimeConfig.testMode,
    };
    const sponsorData = await sponsorConfig(context.supabaseAdmin);

    if (previewOnly) {
      if (!previewJobIds.length) {
        return Response.json({ ...summary, error: 'preview_job_ids_missing' }, { status: 400 });
      }
      const { data: previewData, error: previewError } = await context.supabaseAdmin
        .from('social_story_jobs')
        .select(gameJobSelect)
        .in('id', previewJobIds)
        .eq('story_type', 'announcement');
      if (previewError) return Response.json({ error: previewError.message }, { status: 500 });

      for (const candidate of (previewData ?? []) as unknown as GameJob[]) {
        if (!candidate.game.enabled || !teamContentEnabled(candidate.game.team)) continue;
        try {
          const sponsors = assignedSponsors(sponsorData, candidate.game.team, candidate.story_type);
          const preview = await render({
            type: candidate.story_type,
            jobId: candidate.id,
            game: candidate.game,
            sponsors,
            colorScheme: candidate.game.team?.color_scheme,
          });
          await context.supabaseAdmin
            .from('social_story_jobs')
            .update({
              media_url: preview.mediaUrl,
              storage_path: preview.storagePath,
              media_urls: preview.mediaUrls,
              storage_paths: preview.storagePaths,
              last_error: null,
            })
            .eq('id', candidate.id);
          summary.previewGenerated += 1;
        } catch (workerError) {
          const message = workerError instanceof Error ? workerError.message : 'Unbekannter Vorschaufehler';
          await context.supabaseAdmin
            .from('social_story_jobs')
            .update({ last_error: message })
            .eq('id', candidate.id);
          summary.previewFailed += 1;
        }
      }
      return Response.json(summary, { status: summary.previewFailed ? 207 : 200 });
    }

    let gameData: unknown[] = [];
    if (!targetPostJobIds.length || targetJobIds.length) {
      let gameQuery = context.supabaseAdmin
        .from('social_story_jobs')
        .select(gameJobSelect)
        .eq('status', 'pending')
        .lte('due_at', now);
      if (targetJobIds.length) gameQuery = gameQuery.in('id', targetJobIds);
      const gameResult = await gameQuery.order('due_at', { ascending: true }).limit(10);
      if (gameResult.error) return Response.json({ error: gameResult.error.message }, { status: 500 });
      gameData = gameResult.data ?? [];
    }

    for (const candidate of gameData as unknown as GameJob[]) {
      if (!candidate.game.enabled || !teamContentEnabled(candidate.game.team)) {
        await context.supabaseAdmin
          .from('social_story_jobs')
          .update({ status: 'skipped', last_error: 'Die Inhaltserzeugung ist in den Team-Stammdaten deaktiviert.' })
          .eq('id', candidate.id)
          .eq('status', 'pending');
        continue;
      }
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

      const kickoffHasPassed = new Date(candidate.game.kickoff_at).getTime() <= Date.now();
      const stoppedGame = candidate.game.status === 'cancelled' || candidate.game.status === 'aborted';
      if (stoppedGame && candidate.story_type !== 'announcement') {
        await context.supabaseAdmin
          .from('social_story_jobs')
          .update({
            status: 'skipped',
            last_error: `Das Spiel wurde ${candidate.game.status === 'cancelled' ? 'abgesagt' : 'abgebrochen'}.`,
          })
          .eq('id', candidate.id);
        continue;
      }
      if (kickoffHasPassed && candidate.story_type !== 'result' && candidate.story_type !== 'report' && !stoppedGame) {
        await context.supabaseAdmin
          .from('social_story_jobs')
          .update({ status: 'skipped', last_error: 'Das Spiel hat bereits begonnen.' })
          .eq('id', candidate.id);
        continue;
      }

      if ((candidate.story_type === 'result' || candidate.story_type === 'report')
        && (candidate.game.home_score === null || candidate.game.away_score === null)) {
        await context.supabaseAdmin
          .from('social_story_jobs')
          .update({ status: 'needs_input', last_error: 'Bitte zuerst das Ergebnis eintragen.' })
          .eq('id', candidate.id);
        summary.needsInput += 1;
        continue;
      }

      if (candidate.story_type === 'lineup' && !candidate.game.lineup?.approvedAt) {
        await context.supabaseAdmin
          .from('social_story_jobs')
          .update({ status: 'needs_input', last_error: 'Aufstellung ist noch nicht freigegeben.' })
          .eq('id', candidate.id);
        summary.needsInput += 1;
        continue;
      }

      try {
        const sponsors = assignedSponsors(sponsorData, candidate.game.team, candidate.story_type);
        const preview = await renderGamePreview(candidate, sponsors);

        if (teamAllowsAutomaticPublishing(candidate.game.team, runtimeConfig.testMode)) {
          const caption = candidate.story_type === 'report'
            ? [
              candidate.game.result_message,
              `${candidate.game.home_team} ${candidate.game.home_score}:${candidate.game.away_score} ${candidate.game.away_team}`,
              sponsorMentionLine(sponsors),
              '#aufgehtsgrün',
            ].filter(Boolean).join('\n\n').slice(0, 2200)
            : [
              `${candidate.game.home_team} vs ${candidate.game.away_team} · ${candidate.game.competition || 'BSV Nordstern'} • ${new Date(candidate.game.kickoff_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`,
              sponsorMentionLine(sponsors),
            ].filter(Boolean).join('\n\n');
          const result = candidate.story_type === 'report' && (preview.mediaUrls?.length ?? 0) > 1
            ? await publishInstagramCarousel({
              accountId: runtimeConfig.instagramAccountId,
              accessToken: runtimeConfig.instagramAccessToken,
              imageUrls: preview.mediaUrls,
              caption,
              testMode: runtimeConfig.testMode,
            })
            : await publishInstagramImage({
              accountId: runtimeConfig.instagramAccountId,
              accessToken: runtimeConfig.instagramAccessToken,
              imageUrl: preview.mediaUrl,
              caption,
              testMode: runtimeConfig.testMode,
            });
          await context.supabaseAdmin
            .from('social_story_jobs')
            .update({
              status: 'published',
              media_url: preview.mediaUrl,
              storage_path: preview.storagePath,
              media_urls: preview.mediaUrls,
              storage_paths: preview.storagePaths,
              external_post_id: result.id,
              published_at: new Date().toISOString(),
              last_error: null,
            })
            .eq('id', candidate.id);
          summary.previewReady += 1;
          continue;
        }

        await context.supabaseAdmin
          .from('social_story_jobs')
          .update({
            status: 'preview_ready',
            media_url: preview.mediaUrl,
            storage_path: preview.storagePath,
            media_urls: preview.mediaUrls,
            storage_paths: preview.storagePaths,
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
            claimed_at: null,
            last_error: message,
          })
          .eq('id', candidate.id);
        if (retry) summary.retrying += 1;
        else summary.failed += 1;
      }
    }

    let postData: unknown[] = [];
    if (!targetJobIds.length || targetPostJobIds.length) {
      let postQuery = context.supabaseAdmin
        .from('social_post_jobs')
        .select(postJobSelect)
        .eq('status', 'pending')
        .lte('due_at', now);
      if (targetPostJobIds.length) postQuery = postQuery.in('id', targetPostJobIds);
      const postResult = await postQuery.order('due_at', { ascending: true }).limit(10);
      if (postResult.error) return Response.json({ error: postResult.error.message }, { status: 500 });
      postData = postResult.data ?? [];
    }

    for (const candidate of postData as unknown as PostJob[]) {
      const postTeam = candidate.post.audience?.team;
      if (!candidate.post.enabled || (postTeam && !teamContentEnabled(postTeam))) {
        await context.supabaseAdmin
          .from('social_post_jobs')
          .update({ status: 'skipped', last_error: 'Die Inhaltserzeugung ist in den Team-Stammdaten deaktiviert.' })
          .eq('id', candidate.id)
          .eq('status', 'pending');
        continue;
      }
      const attempt = candidate.attempts + 1;
      const { data: claimed } = await context.supabaseAdmin
        .from('social_post_jobs')
        .update({ status: 'rendering', claimed_at: now, attempts: attempt })
        .eq('id', candidate.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (!claimed) continue;
      summary.claimed += 1;

      if (!candidate.post.title.trim() || !candidate.post.body.trim() || !candidate.post.image_paths?.length) {
        await context.supabaseAdmin
          .from('social_post_jobs')
          .update({ status: 'needs_input', last_error: 'Titel, Beitragstext und mindestens ein Bild sind erforderlich.' })
          .eq('id', candidate.id);
        summary.needsInput += 1;
        continue;
      }

      try {
        const sponsors = assignedSponsors(sponsorData, candidate.post.audience, 'post');
        const preview = await renderPostPreview(candidate, sponsors);
        const automaticallyPublish = postTeam
          ? teamAllowsAutomaticPublishing(postTeam, runtimeConfig.testMode)
          : !runtimeConfig.testMode;
        if (automaticallyPublish) {
          const caption = [candidate.post.title, candidate.post.body, sponsorMentionLine(sponsors), '#aufgehtsgrün']
            .filter(Boolean)
            .join('\n\n')
            .slice(0, 2200);
          const result = (preview.mediaUrls?.length ?? 0) > 1
            ? await publishInstagramCarousel({
              accountId: runtimeConfig.instagramAccountId,
              accessToken: runtimeConfig.instagramAccessToken,
              imageUrls: preview.mediaUrls,
              caption,
              testMode: runtimeConfig.testMode,
            })
            : await publishInstagramImage({
              accountId: runtimeConfig.instagramAccountId,
              accessToken: runtimeConfig.instagramAccessToken,
              imageUrl: preview.mediaUrl,
              caption,
              testMode: runtimeConfig.testMode,
            });
          await context.supabaseAdmin
            .from('social_post_jobs')
            .update({
              status: 'published',
              media_url: preview.mediaUrl,
              storage_path: preview.storagePath,
              media_urls: preview.mediaUrls,
              storage_paths: preview.storagePaths,
              external_post_id: result.id,
              published_at: new Date().toISOString(),
              last_error: null,
            })
            .eq('id', candidate.id);
        } else {
          await context.supabaseAdmin
            .from('social_post_jobs')
            .update({
              status: 'preview_ready',
              media_url: preview.mediaUrl,
              storage_path: preview.storagePath,
              media_urls: preview.mediaUrls,
              storage_paths: preview.storagePaths,
              last_error: null,
            })
            .eq('id', candidate.id);
        }
        summary.previewReady += 1;
      } catch (workerError) {
        const message = workerError instanceof Error ? workerError.message : 'Unbekannter Workerfehler';
        const retry = attempt < 3;
        await context.supabaseAdmin
          .from('social_post_jobs')
          .update({
            status: retry ? 'pending' : 'failed',
            due_at: retry ? retryAt(attempt) : undefined,
            claimed_at: null,
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
        birthday:social_birthdays!inner(
          id, person_name, birth_date, message, photo_path, enabled,
          person:social_people(roles)
        )
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
        const sponsors = assignedSponsors(sponsorData, { slug: 'gesamtverein', audience_group: 'club' }, 'birthday');
        const preview = await render({
          type: 'birthday',
          jobId: candidate.id,
          birthday: candidate.birthday,
          sponsors,
        });
        if (!runtimeConfig.testMode) {
          const caption = [`${candidate.birthday.person_name} · Geburtstag • ${candidate.birthday.message}`, sponsorMentionLine(sponsors)].filter(Boolean).join('\n\n').slice(0, 2200);
          const result = await publishInstagramImage({
            accountId: runtimeConfig.instagramAccountId,
            accessToken: runtimeConfig.instagramAccessToken,
            imageUrl: preview.mediaUrl,
            caption,
            testMode: runtimeConfig.testMode,
          });
          await context.supabaseAdmin
            .from('social_birthday_jobs')
            .update({
              status: 'published',
              media_url: preview.mediaUrl,
              storage_path: preview.storagePath,
              external_post_id: result.id,
              published_at: new Date().toISOString(),
              last_error: null,
            })
            .eq('id', candidate.id);
          summary.previewReady += 1;
          continue;
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
