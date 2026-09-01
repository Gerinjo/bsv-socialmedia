import { withSupabase } from 'npm:@supabase/server@1.4.1';
import { runtimeConfig } from '../_shared/config.ts';
import { CLUB_CREST_SEEDS } from '../_shared/club-crest-seeds.ts';
import { currentWeeklyEventAt, nextStoryDueAt } from '../../../src/story-schedule.mjs';
import { inspectInstagramAccount } from '../../../src/instagram-publisher.mjs';
import {
  cleanupSummary,
  historyState,
  normalizeRetentionDays,
  withHistoryState,
} from '../../../src/history-retention.mjs';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const bucket = 'social-story-previews';
const homeVenues = new Set(['Hauptplatz', 'Nebenplatz', 'Kunstrasenplatz 1', 'Kunstrasenplatz 2']);
const crestStatuses = new Set(['missing', 'needs_review', 'approved', 'rejected']);
const sponsorStatuses = new Set(['missing', 'needs_review', 'approved', 'rejected']);
const sponsorContexts = new Set(['announcement', 'lineup', 'result', 'report', 'birthday', 'post', 'story']);
const stoppedGameStatuses = new Set(['cancelled', 'aborted']);
const publishingModes = new Set(['manual', 'automatic']);
const teamColorSources = new Set(['global', 'group', 'custom']);
const teamColorKeys = ['background', 'panel', 'primary', 'accent', 'muted', 'surface', 'ink'] as const;
const defaultTeamColorScheme = {
  background: '#071f16',
  panel: '#164f32',
  primary: '#91c82f',
  accent: '#f4d638',
  muted: '#a8cbb4',
  surface: '#f4f1e8',
  ink: '#10251a',
};
const originalMimeTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: corsHeaders });
}

function required(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} fehlt.`);
  return normalized;
}

function normalizeClubName(value: unknown): string {
  return required(value, 'Vereinsname')
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE')
    .replaceAll('ß', 'ss')
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()
    .replaceAll(/\s+/g, ' ')
    .replace(/\s+(?:ii|iii|iv|[2-9])$/i, '');
}

function canonicalClubName(value: unknown): string {
  return required(value, 'Vereinsname').replace(/\s+(?:II|III|IV|[2-9])$/i, '').trim();
}

function clubSlug(normalizedName: string): string {
  return normalizedName.replaceAll(' ', '-').replaceAll(/[^a-z0-9-]/g, '').slice(0, 72) || `verein-${crypto.randomUUID().slice(0, 8)}`;
}

function sponsorSlug(value: unknown): string {
  return required(value, 'Partnername')
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE')
    .replaceAll('ß', 'ss')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 72) || `partner-${crypto.randomUUID().slice(0, 8)}`;
}

function instagramHandle(value: unknown): string | null {
  const normalized = String(value ?? '').trim().replace(/^@+/, '');
  if (!normalized) return null;
  if (!/^[A-Za-z0-9._]{1,30}$/.test(normalized)) throw new Error('Der Instagram-Name ist ungültig.');
  return `@${normalized}`;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function parseDataUrl(value: unknown, allowedMimeTypes: Set<string>, maximumBytes: number) {
  const input = required(value, 'Bilddatei');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(input);
  if (!match || !allowedMimeTypes.has(match[1])) throw new Error('Das Bildformat wird nicht unterstützt.');
  const bytes = decodeBase64(match[2]);
  if (!bytes.length || bytes.length > maximumBytes) throw new Error('Die Bilddatei ist leer oder zu groß.');
  return { mime: match[1], bytes };
}

function validHttpUrl(value: unknown): string | null {
  const input = String(value ?? '').trim();
  if (!input) return null;
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Der Quellenlink ist ungültig.');
  return url.toString();
}

function teamColorScheme(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Das Farbschema ist ungültig.');
  return Object.fromEntries(teamColorKeys.map((key) => {
    const color = String((value as Record<string, unknown>)[key] ?? '').trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error(`Die Farbe „${key}“ ist ungültig.`);
    return [key, color];
  }));
}

function pngHasAlpha(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return bytes.length > 26
    && signature.every((value, index) => bytes[index] === value)
    && (bytes[25] === 4 || bytes[25] === 6);
}

async function ensureClub(admin: any, teamName: unknown) {
  const alias = required(teamName, 'Vereinsname');
  const normalizedAlias = normalizeClubName(alias);
  const { data: knownAlias, error: aliasError } = await admin
    .from('social_club_aliases')
    .select('club_id')
    .eq('normalized_alias', normalizedAlias)
    .maybeSingle();
  if (aliasError) throw aliasError;
  if (knownAlias?.club_id) {
    const { data: club, error } = await admin.from('social_clubs').select('*').eq('id', knownAlias.club_id).single();
    if (error) throw error;
    return club;
  }

  const canonicalName = canonicalClubName(alias);
  const { data: club, error: clubError } = await admin
    .from('social_clubs')
    .upsert({
      slug: clubSlug(normalizedAlias),
      name: canonicalName,
      normalized_name: normalizedAlias,
      crest_status: 'missing',
    }, { onConflict: 'normalized_name' })
    .select('*')
    .single();
  if (clubError) throw clubError;
  const { error: newAliasError } = await admin.from('social_club_aliases').upsert({
    club_id: club.id,
    alias,
    normalized_alias: normalizedAlias,
  }, { onConflict: 'normalized_alias' });
  if (newAliasError) throw newAliasError;
  return club;
}

let seedAssetsPromise: Promise<void> | undefined;
function ensureSeedClubAssets(admin: any): Promise<void> {
  seedAssetsPromise ??= (async () => {
    const bytes = decodeBase64(CLUB_CREST_SEEDS.tsvAachLinz);
    for (const path of [
      'club-crests/tsv-aach-linz/original.png',
      'club-crests/tsv-aach-linz/transparent.png',
    ]) {
      const { error } = await admin.storage.from(bucket).upload(path, bytes, {
        contentType: 'image/png',
        cacheControl: '604800',
        upsert: true,
      });
      if (error) throw new Error(`Startwappen konnte nicht gespeichert werden: ${error.message}`);
    }
  })();
  return seedAssetsPromise;
}

async function runWorker(targetJobIds: string[] = [], targetPostJobIds: string[] = [], targetIndependentStoryJobIds: string[] = []): Promise<Record<string, unknown>> {
  if (!runtimeConfig.supabaseUrl || !runtimeConfig.workerApiKey) {
    throw new Error('Die automatische Vorschau ist nicht konfiguriert.');
  }
  const response = await fetch(`${runtimeConfig.supabaseUrl}/functions/v1/social-media-worker`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: runtimeConfig.workerApiKey,
    },
    body: JSON.stringify({ trigger: 'admin-save', requested_at: new Date().toISOString(), targetJobIds, targetPostJobIds, targetIndependentStoryJobIds }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? `Vorschau-Worker antwortet mit HTTP ${response.status}.`));
  return payload;
}

async function runIndependentStoryPreviewWorker(previewIndependentStoryJobIds: string[]): Promise<Record<string, unknown>> {
  if (!runtimeConfig.supabaseUrl || !runtimeConfig.workerApiKey) throw new Error('Die automatische Vorschau ist nicht konfiguriert.');
  const response = await fetch(`${runtimeConfig.supabaseUrl}/functions/v1/social-media-worker`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: runtimeConfig.workerApiKey },
    body: JSON.stringify({
      trigger: 'independent-story-preview',
      requested_at: new Date().toISOString(),
      previewOnly: true,
      previewIndependentStoryJobIds,
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? `Vorschau-Worker antwortet mit HTTP ${response.status}.`));
  return payload;
}

async function runAnnouncementPreviewWorker(previewJobIds: string[]): Promise<Record<string, unknown>> {
  if (!runtimeConfig.supabaseUrl || !runtimeConfig.workerApiKey) {
    throw new Error('Die automatische Vorschau ist nicht konfiguriert.');
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`${runtimeConfig.supabaseUrl}/functions/v1/social-media-worker`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: runtimeConfig.workerApiKey,
      },
      body: JSON.stringify({
        trigger: 'team-color-change',
        requested_at: new Date().toISOString(),
        previewOnly: true,
        previewJobIds,
      }),
    });
    const responseText = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    if (response.ok) return payload;
    const message = String(payload.error ?? (responseText || `Vorschau-Worker antwortet mit HTTP ${response.status}.`));
    if (response.status < 500 || attempt === 3) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }
  throw new Error('Die Ankündigungsvorschauen konnten nicht aktualisiert werden.');
}

async function rerenderTeamAnnouncementPreviews(admin: any, teamId: string) {
  const { data: games, error: gamesError } = await admin
    .from('social_games')
    .select('id')
    .eq('team_id', teamId)
    .eq('enabled', true)
    .gte('kickoff_at', new Date().toISOString());
  if (gamesError) throw gamesError;
  const gameIds = (games ?? []).map((game: any) => game.id);
  if (!gameIds.length) return { requested: 0, generated: 0, failed: 0, runs: [] };

  const { data: jobs, error: jobsError } = await admin
    .from('social_story_jobs')
    .select('id')
    .in('game_id', gameIds)
    .eq('story_type', 'announcement')
    .in('status', ['pending', 'preview_ready', 'failed', 'needs_input']);
  if (jobsError) throw jobsError;
  const jobIds = (jobs ?? []).map((job: any) => job.id);
  const runs: Record<string, unknown>[] = [];
  for (let index = 0; index < jobIds.length; index += 40) {
    runs.push(await runAnnouncementPreviewWorker(jobIds.slice(index, index + 40)));
  }
  return {
    requested: jobIds.length,
    generated: runs.reduce((total, run) => total + Number(run.previewGenerated ?? 0), 0),
    failed: runs.reduce((total, run) => total + Number(run.previewFailed ?? 0), 0),
    runs,
  };
}

async function renderGameJobNow(admin: any, gameId: string, storyType: 'announcement' | 'lineup' | 'result' | 'report') {
  const { data: game, error: gameError } = await admin
    .from('social_games')
    .select('id, team:social_teams(active, content_enabled)')
    .eq('id', gameId)
    .maybeSingle();
  if (gameError) throw gameError;
  if (!game) throw new Error('Das Spiel wurde nicht gefunden.');
  const team = Array.isArray(game.team) ? game.team[0] : game.team;
  if (!team?.active || !team?.content_enabled) {
    await admin
      .from('social_story_jobs')
      .update({ status: 'skipped', last_error: 'Die Inhaltserzeugung ist in den Team-Stammdaten deaktiviert.' })
      .eq('game_id', gameId)
      .eq('story_type', storyType)
      .in('status', ['pending', 'preview_ready', 'failed', 'needs_input']);
    return { skipped: true, reason: 'team_content_disabled' };
  }
  const { data: existing, error: selectError } = await admin
    .from('social_story_jobs')
    .select('id')
    .eq('game_id', gameId)
    .eq('story_type', storyType)
    .maybeSingle();
  if (selectError) throw selectError;

  let jobId = existing?.id as string | undefined;
  if (jobId) {
    const { error } = await admin
      .from('social_story_jobs')
      .update({
        status: 'pending',
        due_at: new Date().toISOString(),
        attempts: 0,
        claimed_at: null,
        last_error: null,
      })
      .eq('id', jobId)
      .in('status', ['pending', 'preview_ready', 'published', 'failed', 'needs_input', 'skipped']);
    if (error) throw error;
  } else {
    const { data: inserted, error } = await admin
      .from('social_story_jobs')
      .insert({
        game_id: gameId,
        story_type: storyType,
        status: 'pending',
        due_at: new Date().toISOString(),
        attempts: 0,
        claimed_at: null,
        last_error: null,
      })
      .select('id')
      .single();
    if (error) throw error;
    jobId = inserted.id;
  }

  return runWorker(jobId ? [jobId] : []);
}

const signedUrlTtlSeconds = 60 * 60 * 24 * 30;
const signedUrlRefreshWindowMs = 60 * 60 * 1000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function signedUrlExpiresAt(value: unknown): number {
  try {
    const input = String(value ?? '').trim();
    if (!input) return 0;
    const token = new URL(input).searchParams.get('token');
    const payloadPart = token?.split('.')[1];
    if (!payloadPart) return 0;
    const base64 = payloadPart.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    const expiresAt = Number(payload.exp) * 1000;
    return Number.isFinite(expiresAt) ? expiresAt : 0;
  } catch {
    return 0;
  }
}

function signedUrlIsFresh(value: unknown): value is string {
  return signedUrlExpiresAt(value) > Date.now() + signedUrlRefreshWindowMs;
}

function canCacheSignedPath(path: string): boolean {
  return path.startsWith('generated/') || path.startsWith('assets/');
}

async function signedAssetUrl(admin: any, path: string | null, existingUrl: unknown = null): Promise<string | null> {
  if (!path) return null;
  if (signedUrlIsFresh(existingUrl)) {
    if (canCacheSignedPath(path)) signedUrlCache.set(path, { url: existingUrl, expiresAt: signedUrlExpiresAt(existingUrl) });
    return existingUrl;
  }
  if (canCacheSignedPath(path)) {
    const cached = signedUrlCache.get(path);
    if (cached && cached.expiresAt > Date.now() + signedUrlRefreshWindowMs) return cached.url;
    signedUrlCache.delete(path);
  }
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, signedUrlTtlSeconds);
  if (error || !data?.signedUrl) return null;
  if (canCacheSignedPath(path)) {
    if (signedUrlCache.size > 1000) signedUrlCache.clear();
    signedUrlCache.set(path, { url: data.signedUrl, expiresAt: signedUrlExpiresAt(data.signedUrl) });
  }
  return data.signedUrl;
}

async function freshPreviewUrls(admin: any, rows: any[]): Promise<any[]> {
  return await Promise.all(rows.map(async (row) => {
    const jobs = await Promise.all((row.jobs ?? []).map(async (job: any) => {
      const storagePaths = Array.isArray(job.storage_paths) && job.storage_paths.length
        ? job.storage_paths.map((path: unknown) => String(path ?? '').trim()).filter(Boolean).slice(0, 10)
        : job.storage_path ? [job.storage_path] : [];
      if (!storagePaths.length) return { ...job, media_urls: [] };
      const existingMediaUrls = Array.isArray(job.media_urls) ? job.media_urls : [];
      const mediaUrls = await Promise.all(storagePaths.map((path: string, index: number) =>
        signedAssetUrl(admin, path, existingMediaUrls[index] ?? (index === 0 ? job.media_url : null))
      ));
      const validMediaUrls = mediaUrls.filter(Boolean);
      return { ...job, media_url: validMediaUrls[0] ?? job.media_url, media_urls: validMediaUrls };
    }));
    const reportImagePaths = Array.isArray(row.report_image_paths) && row.report_image_paths.length
      ? row.report_image_paths.map((path: unknown) => String(path ?? '').trim()).filter(Boolean).slice(0, 10)
      : row.action_image_path ? [row.action_image_path] : [];
    const reportImages = await Promise.all(reportImagePaths.map(async (path: string, index: number) => ({
      path,
      position: index + 1,
      url: await signedAssetUrl(admin, path),
    })));
    return {
      ...row,
      jobs,
      action_image_url: reportImages[0]?.url ?? null,
      report_images: reportImages.filter((image) => image.url),
    };
  }));
}

async function freshPostUrls(admin: any, rows: any[]): Promise<any[]> {
  return await Promise.all(rows.map(async (row) => {
    const imagePaths = Array.isArray(row.image_paths)
      ? row.image_paths.map((path: unknown) => String(path ?? '').trim()).filter(Boolean).slice(0, 10)
      : [];
    const images = await Promise.all(imagePaths.map(async (path: string, index: number) => ({
      path,
      position: index + 1,
      url: await signedAssetUrl(admin, path),
    })));
    const job = Array.isArray(row.job) ? row.job[0] : row.job;
    const storagePaths = Array.isArray(job?.storage_paths) && job.storage_paths.length
      ? job.storage_paths.map((path: unknown) => String(path ?? '').trim()).filter(Boolean).slice(0, 10)
      : job?.storage_path ? [job.storage_path] : [];
    const existingMediaUrls = Array.isArray(job?.media_urls) ? job.media_urls : [];
    const mediaUrls = await Promise.all(storagePaths.map((path: string, index: number) =>
      signedAssetUrl(admin, path, existingMediaUrls[index] ?? (index === 0 ? job?.media_url : null))
    ));
    return {
      ...row,
      images: images.filter((image) => image.url),
      job: job ? {
        ...job,
        media_url: mediaUrls.find(Boolean) ?? job.media_url,
        media_urls: mediaUrls.filter(Boolean),
      } : null,
    };
  }));
}

async function freshIndependentStoryUrls(admin: any, rows: any[]): Promise<any[]> {
  return await Promise.all(rows.map(async (row) => {
    const jobs = await Promise.all((row.jobs ?? []).map(async (job: any) => ({
      ...job,
      media_url: await signedAssetUrl(admin, job.storage_path, job.media_url) ?? job.media_url,
    })));
    return {
      ...row,
      image_url: await signedAssetUrl(admin, row.image_path),
      jobs: jobs.sort((left: any, right: any) => new Date(right.scheduled_for).getTime() - new Date(left.scheduled_for).getTime()),
    };
  }));
}

async function freshClubUrls(admin: any, rows: any[]): Promise<any[]> {
  return await Promise.all(rows.map(async (club) => ({
    ...club,
    crest_original_url: await signedAssetUrl(admin, club.crest_original_path),
    crest_transparent_url: await signedAssetUrl(admin, club.crest_transparent_path),
  })));
}

async function freshSponsorUrls(admin: any, rows: any[]): Promise<any[]> {
  return await Promise.all(rows.map(async (sponsor) => ({
    ...sponsor,
    logo_original_url: await signedAssetUrl(admin, sponsor.logo_original_path),
    logo_transparent_url: await signedAssetUrl(admin, sponsor.logo_transparent_path),
    logo_white_url: await signedAssetUrl(admin, sponsor.logo_white_path),
  })));
}

function cleanupStoragePaths(kind: 'game' | 'post' | 'story', record: any): string[] {
  const jobs = Array.isArray(record.jobs) ? record.jobs : record.job ? [record.job] : [];
  const paths = jobs.flatMap((job: any) => [
    job?.storage_path,
    ...(Array.isArray(job?.storage_paths) ? job.storage_paths : []),
  ]);
  if (kind === 'game') paths.push(record.action_image_path, ...(Array.isArray(record.report_image_paths) ? record.report_image_paths : []));
  if (kind === 'post') paths.push(...(Array.isArray(record.image_paths) ? record.image_paths : []));
  if (kind === 'story') paths.push(record.image_path);
  return [...new Set(paths.map((path: unknown) => String(path ?? '').trim()).filter(Boolean))];
}

async function removeStoragePaths(admin: any, paths: string[]): Promise<void> {
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(index, index + 100));
    if (error) throw error;
  }
}

async function rerenderUpcomingClubGames(admin: any, clubId: string) {
  const now = new Date().toISOString();
  const [homeGames, awayGames] = await Promise.all([
    admin
      .from('social_games')
      .select('id')
      .eq('home_club_id', clubId)
      .eq('enabled', true)
      .gte('kickoff_at', now),
    admin
      .from('social_games')
      .select('id')
      .eq('away_club_id', clubId)
      .eq('enabled', true)
      .gte('kickoff_at', now),
  ]);
  if (homeGames.error) throw homeGames.error;
  if (awayGames.error) throw awayGames.error;
  const gameIds = [...new Set([
    ...(homeGames.data ?? []).map((game: any) => game.id),
    ...(awayGames.data ?? []).map((game: any) => game.id),
  ])];
  if (!gameIds.length) return null;
  const { error } = await admin
    .from('social_story_jobs')
    .update({
      status: 'pending',
      due_at: new Date().toISOString(),
      attempts: 0,
      claimed_at: null,
      last_error: null,
    })
    .in('game_id', gameIds)
    .eq('story_type', 'announcement')
    .in('status', ['pending', 'preview_ready', 'failed', 'needs_input', 'skipped']);
  if (error) throw error;
  return runWorker();
}

async function invalidateSponsorPreviews(admin: any, sponsorId: string, previousContexts: string[] = []) {
  if (!sponsorId) return null;
  const { data: currentAssignments, error: assignmentError } = await admin
    .from('social_sponsor_assignments')
    .select('context')
    .eq('sponsor_id', sponsorId);
  if (assignmentError) throw assignmentError;
  const contexts = [...new Set([
    ...previousContexts,
    ...(currentAssignments ?? []).map((assignment: any) => String(assignment.context ?? '')),
  ].filter((context) => sponsorContexts.has(context)))];
  if (!contexts.length) return null;
  const now = new Date().toISOString();
  const gameContexts = contexts.filter((context) => ['announcement', 'lineup', 'result', 'report'].includes(context));
  let gameJobIds: string[] = [];
  let postJobIds: string[] = [];
  let independentStoryJobIds: string[] = [];
  if (gameContexts.length) {
    const { data: gameJobs, error: gameError } = await admin.from('social_story_jobs').update({ status: 'pending', due_at: now, attempts: 0, claimed_at: null, last_error: null }).in('story_type', gameContexts).in('status', ['pending', 'preview_ready', 'failed']).select('id');
    if (gameError) throw gameError;
    gameJobIds = (gameJobs ?? []).map((job: any) => job.id);
  }
  if (contexts.includes('post')) {
    const { data: postJobs, error: postError } = await admin.from('social_post_jobs').update({ status: 'pending', due_at: now, attempts: 0, claimed_at: null, last_error: null }).in('status', ['pending', 'preview_ready', 'failed']).select('id');
    if (postError) throw postError;
    postJobIds = (postJobs ?? []).map((job: any) => job.id);
  }
  if (contexts.includes('story')) {
    const { data: storyJobs, error: storyError } = await admin.from('social_independent_story_jobs').update({ status: 'pending', due_at: now, attempts: 0, claimed_at: null, last_error: null }).in('status', ['preview_ready', 'failed']).select('id');
    if (storyError) throw storyError;
    independentStoryJobIds = (storyJobs ?? []).map((job: any) => job.id);
  }
  let birthdayQueued = 0;
  if (contexts.includes('birthday')) {
    const { data: birthdayJobs, error: birthdayError } = await admin.from('social_birthday_jobs').update({ status: 'pending', due_at: now, attempts: 0, claimed_at: null, last_error: null }).in('status', ['pending', 'preview_ready', 'failed']).select('id');
    if (birthdayError) throw birthdayError;
    birthdayQueued = (birthdayJobs ?? []).length;
  }
  const runs: Record<string, unknown>[] = [];
  const batchCount = Math.max(Math.ceil(gameJobIds.length / 10), Math.ceil(postJobIds.length / 10), Math.ceil(independentStoryJobIds.length / 10), birthdayQueued ? 1 : 0);
  for (let index = 0; index < batchCount; index += 1) {
    runs.push(await runWorker(gameJobIds.slice(index * 10, index * 10 + 10), postJobIds.slice(index * 10, index * 10 + 10), independentStoryJobIds.slice(index * 10, index * 10 + 10)));
  }
  return { contexts, gameJobs: gameJobIds.length, postJobs: postJobIds.length, birthdayJobs: birthdayQueued, runs };
}

const securedHandler = withSupabase({ auth: 'user' }, async (request, context) => {
  const claims = context.userClaims as Record<string, unknown> | undefined;
  const userId = String(claims?.sub ?? claims?.id ?? '');
  const email = String(claims?.email ?? '');
  if (!userId) return json({ error: 'identity_missing' }, 401);

  const { data: membership, error: membershipError } = await context.supabaseAdmin
    .from('social_admins')
    .select('user_id, email, role, is_active')
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) return json({ error: membershipError.message }, 500);
  if (!membership || !membership.is_active) {
    return json({ error: 'not_authorized', userId, email, reason: 'account_inactive' }, 403);
  }
  const normalizedRole = String(membership.role ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  const allowedRoles = new Set(['admin', 'sm-team']);
  if (!allowedRoles.has(normalizedRole)) {
    return json({ error: 'not_authorized', userId, email, reason: 'role_missing', role: membership.role }, 403);
  }

  if (request.method === 'GET') {
    await ensureSeedClubAssets(context.supabaseAdmin);
    const [
      { data: games, error: gamesError },
      { data: birthdays, error: birthdaysError },
      { data: teamSettings, error: teamsError },
      { data: teamColorGroups, error: teamColorGroupsError },
      { data: people, error: peopleError },
      { data: clubs, error: clubsError },
      { data: members, error: membersError },
      { data: postAudiences, error: postAudiencesError },
      { data: websiteAudiences, error: websiteAudiencesError },
      { data: posts, error: postsError },
      { data: storyCategories, error: storyCategoriesError },
      { data: independentStories, error: independentStoriesError },
      { data: sponsors, error: sponsorsError },
      { data: sponsorAssignments, error: sponsorAssignmentsError },
      { data: sponsorWebsiteAssignments, error: sponsorWebsiteAssignmentsError },
      { data: cleanupSettings, error: cleanupSettingsError },
    ] = await Promise.all([
      context.supabaseAdmin
        .from('social_games')
        .select('*, jobs:social_story_jobs(*)')
        .order('kickoff_at', { ascending: true }),
      context.supabaseAdmin
        .from('social_birthdays')
        .select('*, person:social_people(id, display_name, roles, source_photo_url, cutout_path, birth_date), jobs:social_birthday_jobs(*)')
        .order('birth_date', { ascending: true }),
      context.supabaseAdmin
        .from('social_teams')
        .select('id, slug, name, competition, website_path, fussball_de_url, fussball_de_widget_id, sync_enabled, last_synced_at, last_sync_error, active, content_enabled, publishing_mode, family_key, color_source, color_scheme, sort_order')
        .order('sort_order', { ascending: true }),
      context.supabaseAdmin
        .from('social_team_color_groups')
        .select('key, label, color_scheme, sort_order')
        .order('sort_order', { ascending: true }),
      context.supabaseAdmin
        .from('social_people')
        .select('id, slug, display_name, roles, source_photo_url, cutout_path, birth_date')
        .eq('active', true)
        .order('display_name', { ascending: true }),
      context.supabaseAdmin
        .from('social_clubs')
        .select('*, aliases:social_club_aliases(alias, normalized_alias)')
        .order('name', { ascending: true }),
      context.supabaseAdmin
        .from('social_admins')
        .select('user_id, email, role, is_active, created_at')
        .order('email', { ascending: true }),
      context.supabaseAdmin
        .from('social_post_audiences')
        .select('id, slug, audience_group, label, sort_order, team_id')
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      context.supabaseAdmin
        .from('social_post_audiences')
        .select('id, slug, audience_group, label, sort_order, team_id, active')
        .order('sort_order', { ascending: true }),
      context.supabaseAdmin
        .from('social_posts')
        .select('*, audience:social_post_audiences(id, slug, audience_group, label), job:social_post_jobs(*)')
        .order('updated_at', { ascending: false }),
      context.supabaseAdmin
        .from('social_story_categories')
        .select('id, slug, label, sort_order')
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      context.supabaseAdmin
        .from('social_independent_stories')
        .select('*, category:social_story_categories(id, slug, label), audience:social_post_audiences(id, slug, audience_group, label, team_id), jobs:social_independent_story_jobs(*)')
        .order('updated_at', { ascending: false }),
      context.supabaseAdmin
        .from('social_sponsors')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      context.supabaseAdmin
        .from('social_sponsor_assignments')
        .select('sponsor_id, audience_id, context, slot')
        .order('slot', { ascending: true }),
      context.supabaseAdmin
        .from('social_sponsor_website_assignments')
        .select('sponsor_id, audience_id'),
      context.supabaseAdmin
        .from('social_cleanup_settings')
        .select('retention_days, updated_at')
        .eq('id', 1)
        .maybeSingle(),
    ]);
    const readError = gamesError ?? birthdaysError ?? teamsError ?? teamColorGroupsError ?? peopleError ?? clubsError ?? membersError
      ?? postAudiencesError ?? websiteAudiencesError ?? postsError ?? storyCategoriesError ?? independentStoriesError ?? sponsorsError ?? sponsorAssignmentsError
      ?? sponsorWebsiteAssignmentsError ?? cleanupSettingsError;
    if (readError) return json({ error: readError.message }, 500);
    const retentionDays = normalizeRetentionDays(cleanupSettings?.retention_days);
    const [preparedGames, preparedPosts, preparedIndependentStories] = await Promise.all([
      freshPreviewUrls(context.supabaseAdmin, games ?? []),
      freshPostUrls(context.supabaseAdmin, posts ?? []),
      freshIndependentStoryUrls(context.supabaseAdmin, independentStories ?? []),
    ]);
    const historyRecords = {
      game: preparedGames.map((record: any) => withHistoryState(record, 'game', retentionDays)),
      post: preparedPosts.map((record: any) => withHistoryState(record, 'post', retentionDays)),
      story: preparedIndependentStories.map((record: any) => withHistoryState(record, 'story', retentionDays)),
    };
    return json({
      user: { userId, email, role: String(membership.role ?? '').trim() || 'sm-team' },
      members: members ?? [],
      testMode: runtimeConfig.testMode,
      venues: [...homeVenues],
      teams: (teamSettings ?? []).filter((team: any) => team.active),
      teamSettings: teamSettings ?? [],
      teamColorGroups: teamColorGroups ?? [],
      people: people ?? [],
      postAudiences: postAudiences ?? [],
      websiteAudiences: websiteAudiences ?? [],
      posts: historyRecords.post,
      storyCategories: storyCategories ?? [],
      independentStories: historyRecords.story,
      sponsors: await freshSponsorUrls(context.supabaseAdmin, sponsors ?? []),
      sponsorAssignments: sponsorAssignments ?? [],
      sponsorWebsiteAssignments: sponsorWebsiteAssignments ?? [],
      clubs: await freshClubUrls(context.supabaseAdmin, clubs ?? []),
      games: historyRecords.game,
      birthdays: await freshPreviewUrls(context.supabaseAdmin, birthdays ?? []),
      cleanupSettings: { retentionDays, updatedAt: cleanupSettings?.updated_at ?? null },
      cleanupSummary: cleanupSummary(historyRecords, retentionDays),
      instagramConfiguration: {
        accountIdConfigured: Boolean(runtimeConfig.instagramAccountId),
        accessTokenConfigured: Boolean(runtimeConfig.instagramAccessToken),
        graphApiVersion: runtimeConfig.metaGraphApiVersion,
      },
    });
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await request.json() as Record<string, any>;
    const action = required(body.action, 'Aktion');

    if (action === 'test_instagram_connection') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      if (!runtimeConfig.instagramAccountId || !runtimeConfig.instagramAccessToken) {
        throw new Error('Instagram Account ID und Access Token sind in Supabase noch nicht vollständig konfiguriert.');
      }
      const expectedUsername = required(body.expectedUsername, 'Erwarteter Instagram-Benutzername')
        .replace(/^@+/, '')
        .toLowerCase();
      if (!/^[a-z0-9._]{1,30}$/.test(expectedUsername)) throw new Error('Der erwartete Instagram-Benutzername ist ungültig.');
      const account = await inspectInstagramAccount({
        accountId: runtimeConfig.instagramAccountId,
        accessToken: runtimeConfig.instagramAccessToken,
        graphApiVersion: runtimeConfig.metaGraphApiVersion,
      });
      if (account.username.toLowerCase() !== expectedUsername) {
        throw new Error(`Das konfigurierte Instagram-Konto ist @${account.username}, erwartet wurde @${expectedUsername}.`);
      }
      if (account.accountType !== 'BUSINESS') {
        throw new Error(`@${account.username} ist kein Instagram-Business-Konto (Kontotyp: ${account.accountType || 'unbekannt'}).`);
      }
      return json({ ok: true, account, testMode: runtimeConfig.testMode });
    }

    if (action === 'save_cleanup_settings') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const retentionDays = normalizeRetentionDays(body.retentionDays, -1);
      if (retentionDays < 1) throw new Error('Die Aufbewahrungsdauer muss zwischen 1 und 3.650 Tagen liegen.');
      const { data, error } = await context.supabaseAdmin.from('social_cleanup_settings').upsert({
        id: 1,
        retention_days: retentionDays,
        updated_by: userId,
      }).select('retention_days, updated_at').single();
      if (error) throw error;
      return json({ ok: true, cleanupSettings: { retentionDays: data.retention_days, updatedAt: data.updated_at } });
    }

    if (action === 'set_record_archived') {
      const kind = required(body.kind, 'Datensatzart') as 'game' | 'post' | 'story';
      const recordId = required(body.recordId, 'Datensatz-ID');
      const archived = body.archived !== false;
      const configs = {
        game: { table: 'social_games', jobs: 'social_story_jobs', foreignKey: 'game_id' },
        post: { table: 'social_posts', jobs: 'social_post_jobs', foreignKey: 'post_id' },
        story: { table: 'social_independent_stories', jobs: 'social_independent_story_jobs', foreignKey: 'story_id' },
      } as const;
      const config = configs[kind];
      if (!config) throw new Error('Die Datensatzart ist ungültig.');
      const { data: record, error: updateError } = await context.supabaseAdmin.from(config.table).update({
        archived_at: archived ? new Date().toISOString() : null,
        archived_by: archived ? userId : null,
        enabled: !archived,
      }).eq('id', recordId).select('id, archived_at').maybeSingle();
      if (updateError) throw updateError;
      if (!record) throw new Error('Der Datensatz wurde nicht gefunden.');
      if (archived) {
        const { error: jobError } = await context.supabaseAdmin.from(config.jobs).update({
          status: 'skipped',
          last_error: 'Manuell als nicht mehr benötigt markiert.',
        }).eq(config.foreignKey, recordId).in('status', ['pending', 'preview_ready', 'failed', 'needs_input', 'skipped']);
        if (jobError) throw jobError;
      }
      return json({ ok: true, archived, archivedAt: record.archived_at });
    }

    if (action === 'purge_historical_data') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      if (body.confirm !== 'DELETE_ELIGIBLE_HISTORY') throw new Error('Die endgültige Löschung wurde nicht bestätigt.');
      const [settingsResult, gamesResult, postsResult, storiesResult] = await Promise.all([
        context.supabaseAdmin.from('social_cleanup_settings').select('retention_days').eq('id', 1).maybeSingle(),
        context.supabaseAdmin.from('social_games').select('id, kickoff_at, archived_at, action_image_path, report_image_paths, jobs:social_story_jobs(status, published_at, storage_path, storage_paths)'),
        context.supabaseAdmin.from('social_posts').select('id, archived_at, image_paths, job:social_post_jobs(status, published_at, storage_path, storage_paths)'),
        context.supabaseAdmin.from('social_independent_stories').select('id, schedule_kind, archived_at, image_path, jobs:social_independent_story_jobs(status, published_at, storage_path)'),
      ]);
      const cleanupError = settingsResult.error ?? gamesResult.error ?? postsResult.error ?? storiesResult.error;
      if (cleanupError) throw cleanupError;
      const retentionDays = normalizeRetentionDays(settingsResult.data?.retention_days);
      const now = Date.now();
      const candidates = {
        game: (gamesResult.data ?? []).filter((record: any) => historyState(record, 'game', retentionDays, now).cleanup_eligible),
        post: (postsResult.data ?? []).filter((record: any) => historyState(record, 'post', retentionDays, now).cleanup_eligible),
        story: (storiesResult.data ?? []).filter((record: any) => historyState(record, 'story', retentionDays, now).cleanup_eligible),
      };
      const storagePaths = [...new Set([
        ...candidates.game.flatMap((record: any) => cleanupStoragePaths('game', record)),
        ...candidates.post.flatMap((record: any) => cleanupStoragePaths('post', record)),
        ...candidates.story.flatMap((record: any) => cleanupStoragePaths('story', record)),
      ])];
      if (storagePaths.length) await removeStoragePaths(context.supabaseAdmin, storagePaths);
      const deletions = [
        ['social_games', candidates.game],
        ['social_posts', candidates.post],
        ['social_independent_stories', candidates.story],
      ] as const;
      for (const [table, records] of deletions) {
        const ids = records.map((record: any) => record.id);
        if (!ids.length) continue;
        const { error } = await context.supabaseAdmin.from(table).delete().in('id', ids);
        if (error) throw error;
      }
      return json({
        ok: true,
        retentionDays,
        deleted: {
          games: candidates.game.length,
          posts: candidates.post.length,
          stories: candidates.story.length,
          storageObjects: storagePaths.length,
        },
      });
    }

    if (action === 'set_team_member_access') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const targetUserId = required(body.userId, 'Benutzer-ID');
      if (targetUserId === userId) throw new Error('Der eigene aktuell verwendete Admin-Zugang kann nicht gesperrt werden.');
      const isActive = body.isActive === true;
      const { data: target, error: targetError } = await context.supabaseAdmin
        .from('social_admins')
        .select('user_id, email, role, is_active')
        .eq('user_id', targetUserId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) throw new Error('Das Teammitglied wurde nicht gefunden.');
      if (!isActive && target.role === 'admin' && target.is_active) {
        const { count, error: countError } = await context.supabaseAdmin
          .from('social_admins')
          .select('user_id', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('is_active', true)
          .neq('user_id', targetUserId);
        if (countError) throw countError;
        if (!count) throw new Error('Der letzte aktive Administrator kann nicht gesperrt werden.');
      }
      const { data: updated, error: updateError } = await context.supabaseAdmin
        .from('social_admins')
        .update({ is_active: isActive })
        .eq('user_id', targetUserId)
        .select('user_id, email, role, is_active, created_at')
        .single();
      if (updateError) throw updateError;
      const { error: authError } = await context.supabaseAdmin.auth.admin.updateUserById(targetUserId, {
        ban_duration: isActive ? 'none' : '876000h',
      });
      if (authError) {
        await context.supabaseAdmin.from('social_admins').update({ is_active: target.is_active }).eq('user_id', targetUserId);
        throw new Error(`Der Auth-Zugang konnte nicht ${isActive ? 'entsperrt' : 'gesperrt'} werden: ${authError.message}`);
      }
      return json({ ok: true, member: updated });
    }

    if (action === 'delete_team_member') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const targetUserId = required(body.userId, 'Benutzer-ID');
      if (targetUserId === userId) throw new Error('Der eigene aktuell verwendete Admin-Zugang kann nicht gelöscht werden.');
      const { data: target, error: targetError } = await context.supabaseAdmin
        .from('social_admins')
        .select('user_id, email, role, is_active')
        .eq('user_id', targetUserId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) throw new Error('Das Teammitglied wurde nicht gefunden.');
      if (target.role === 'admin' && target.is_active) {
        const { count, error: countError } = await context.supabaseAdmin
          .from('social_admins')
          .select('user_id', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('is_active', true)
          .neq('user_id', targetUserId);
        if (countError) throw countError;
        if (!count) throw new Error('Der letzte aktive Administrator kann nicht gelöscht werden.');
      }
      const { error: authError } = await context.supabaseAdmin.auth.admin.deleteUser(targetUserId);
      if (authError) throw new Error(`Der Auth-Zugang konnte nicht gelöscht werden: ${authError.message}`);
      const { error: membershipDeleteError } = await context.supabaseAdmin
        .from('social_admins')
        .delete()
        .eq('user_id', targetUserId);
      if (membershipDeleteError) throw membershipDeleteError;
      return json({ ok: true, deletedUserId: targetUserId });
    }

    if (action === 'create_team_member') {
      if (String(membership.role ?? '').trim().toLowerCase() !== 'admin') {
        return json({ error: 'admin_only' }, 403);
      }
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const role = String(body.role ?? 'sm-team').trim();
      const isActive = body.is_active !== false;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
      if (password.length < 10) throw new Error('Das Passwort muss mindestens 10 Zeichen lang sein.');
      if (!['admin', 'sm-team'].includes(role)) throw new Error('Die Rolle ist ungültig.');
      const { data: createdUser, error: createUserError } = await context.supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { social_role: role },
      });
      if (createUserError) throw new Error(createUserError.message || 'Der Benutzer konnte nicht angelegt werden.');
      const { data: member, error: insertError } = await context.supabaseAdmin
        .from('social_admins')
        .upsert({
          user_id: createdUser.user.id,
          email,
          role,
          is_active: isActive,
        }, { onConflict: 'user_id' })
        .select('*')
        .single();
      if (insertError) {
        await context.supabaseAdmin.auth.admin.deleteUser(createdUser.user.id);
        throw insertError;
      }
      if (!isActive) {
        const { error: banError } = await context.supabaseAdmin.auth.admin.updateUserById(createdUser.user.id, { ban_duration: '876000h' });
        if (banError) {
          await context.supabaseAdmin.from('social_admins').delete().eq('user_id', createdUser.user.id);
          await context.supabaseAdmin.auth.admin.deleteUser(createdUser.user.id);
          throw new Error(`Der inaktive Zugang konnte nicht gesperrt werden: ${banError.message}`);
        }
      }
      return json({ ok: true, member });
    }

    if (action === 'save_team_settings') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const teamId = required(body.teamId, 'Mannschaft');
      const publishingMode = required(body.publishingMode, 'Veröffentlichungsmodus');
      if (!publishingModes.has(publishingMode)) throw new Error('Der Veröffentlichungsmodus ist ungültig.');
      const colorSource = String(body.colorSource ?? 'custom').trim();
      if (!teamColorSources.has(colorSource)) throw new Error('Die Farbquelle ist ungültig.');
      const { data: previousTeam, error: previousTeamError } = await context.supabaseAdmin
        .from('social_teams')
        .select('id, family_key, color_scheme')
        .eq('id', teamId)
        .maybeSingle();
      if (previousTeamError) throw previousTeamError;
      if (!previousTeam) throw new Error('Die Mannschaft wurde nicht gefunden.');
      let resolvedColorScheme: Record<string, string>;
      if (colorSource === 'global') {
        resolvedColorScheme = { ...defaultTeamColorScheme };
      } else if (colorSource === 'group') {
        const { data: colorGroup, error: colorGroupError } = await context.supabaseAdmin
          .from('social_team_color_groups')
          .select('color_scheme')
          .eq('key', previousTeam.family_key)
          .maybeSingle();
        if (colorGroupError) throw colorGroupError;
        if (!colorGroup) throw new Error('Für diese Mannschaft wurde keine Familienfarbe gefunden.');
        resolvedColorScheme = teamColorScheme(colorGroup.color_scheme);
      } else {
        resolvedColorScheme = teamColorScheme(body.colorScheme);
      }
      const payload = {
        active: body.active === true,
        content_enabled: body.contentEnabled === true,
        publishing_mode: publishingMode,
        color_source: colorSource,
        color_scheme: resolvedColorScheme,
      };
      const previousColorScheme = teamColorScheme(previousTeam.color_scheme);
      const colorSchemeChanged = teamColorKeys.some((key) => previousColorScheme[key] !== payload.color_scheme[key]);
      const { data: team, error: teamError } = await context.supabaseAdmin
        .from('social_teams')
        .update(payload)
        .eq('id', teamId)
        .select('*')
        .single();
      if (teamError) throw teamError;
      const { error: audienceError } = await context.supabaseAdmin
        .from('social_post_audiences')
        .update({ active: payload.active })
        .eq('team_id', teamId);
      if (audienceError) throw audienceError;
      let previewRefresh = null;
      if (!payload.active || !payload.content_enabled) {
        const { data: gameRows, error: gamesError } = await context.supabaseAdmin
          .from('social_games')
          .select('id')
          .eq('team_id', teamId)
          .eq('enabled', true);
        if (gamesError) throw gamesError;
        const gameIds = (gameRows ?? []).map((game: any) => game.id);
        if (gameIds.length) {
          const { error: jobsError } = await context.supabaseAdmin
            .from('social_story_jobs')
            .update({ status: 'skipped', last_error: 'Die Inhaltserzeugung ist in den Team-Stammdaten deaktiviert.' })
            .in('game_id', gameIds)
            .in('status', ['pending', 'preview_ready', 'failed', 'needs_input']);
          if (jobsError) throw jobsError;
        }
      } else if (colorSchemeChanged) {
        previewRefresh = await rerenderTeamAnnouncementPreviews(context.supabaseAdmin, teamId);
      }
      return json({ ok: true, team, colorSchemeChanged, previewRefresh });
    }

    if (action === 'save_team_color_group') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const groupKey = required(body.groupKey, 'Mannschaftsfamilie');
      const colorScheme = teamColorScheme(body.colorScheme);
      const { data: colorGroup, error: colorGroupError } = await context.supabaseAdmin
        .from('social_team_color_groups')
        .update({ color_scheme: colorScheme })
        .eq('key', groupKey)
        .select('key, label, color_scheme, sort_order')
        .maybeSingle();
      if (colorGroupError) throw colorGroupError;
      if (!colorGroup) throw new Error('Die Mannschaftsfamilie wurde nicht gefunden.');
      const { data: inheritedTeams, error: inheritedTeamsError } = await context.supabaseAdmin
        .from('social_teams')
        .update({ color_scheme: colorScheme })
        .eq('family_key', groupKey)
        .eq('color_source', 'group')
        .select('id, active, content_enabled');
      if (inheritedTeamsError) throw inheritedTeamsError;
      const previewRefreshes = [];
      for (const team of inheritedTeams ?? []) {
        if (team.active && team.content_enabled) {
          previewRefreshes.push(await rerenderTeamAnnouncementPreviews(context.supabaseAdmin, team.id));
        }
      }
      return json({
        ok: true,
        colorGroup,
        inheritedTeams: (inheritedTeams ?? []).length,
        previewRefresh: {
          requested: previewRefreshes.reduce((total, item) => total + Number(item.requested ?? 0), 0),
          generated: previewRefreshes.reduce((total, item) => total + Number(item.generated ?? 0), 0),
          failed: previewRefreshes.reduce((total, item) => total + Number(item.failed ?? 0), 0),
        },
      });
    }

    if (action === 'save_game') {
      const kickoff = new Date(required(body.kickoffAt, 'Anstoß'));
      if (Number.isNaN(kickoff.getTime())) throw new Error('Anstoß ist ungültig.');
      const teamId = required(body.teamId, 'BSV-Mannschaft');
      const { data: team, error: teamError } = await context.supabaseAdmin
        .from('social_teams')
        .select('id, name, competition, content_enabled')
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
      const [bsvClub, opponentClub] = await Promise.all([
        ensureClub(context.supabaseAdmin, team.name),
        ensureClub(context.supabaseAdmin, opponent),
      ]);
      const payload: Record<string, unknown> = {
        source: body.source === 'fussball.de' ? 'fussball.de' : 'manual',
        source_match_id: String(body.sourceMatchId ?? '').trim() || null,
        source_url: String(body.sourceUrl ?? '').trim() || null,
        team_id: team.id,
        is_home: isHome,
        home_team: isHome ? team.name : opponent,
        away_team: isHome ? opponent : team.name,
        home_club_id: isHome ? bsvClub.id : opponentClub.id,
        away_club_id: isHome ? opponentClub.id : bsvClub.id,
        competition: team.competition,
        venue,
        kickoff_at: kickoff.toISOString(),
        enabled: body.enabled !== false,
      };
      if (body.id) payload.id = body.id;
      const { data, error } = await context.supabaseAdmin.from('social_games').upsert(payload).select().single();
      if (error) throw error;
      if (kickoff.getTime() <= Date.now()) {
        const { error: skippedError } = await context.supabaseAdmin
          .from('social_story_jobs')
          .update({ status: 'skipped', last_error: 'Das Spiel liegt bereits in der Vergangenheit.' })
          .eq('game_id', data.id)
          .in('story_type', ['announcement', 'lineup'])
          .in('status', ['pending', 'failed', 'needs_input']);
        if (skippedError) throw skippedError;
        const { error: resultJobError } = await context.supabaseAdmin
          .from('social_story_jobs')
          .update({ status: 'needs_input', last_error: 'Bitte zuerst das Ergebnis eintragen.' })
          .eq('game_id', data.id)
          .eq('story_type', 'result')
          .in('status', ['pending', 'failed', 'skipped']);
        if (resultJobError) throw resultJobError;
        return json({ ok: true, game: data, archived: true, automation: null });
      }
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

    if (action === 'set_game_status') {
      const gameId = required(body.gameId, 'Spiel-ID');
      const nextStatus = required(body.status, 'Spielstatus');
      if (!stoppedGameStatuses.has(nextStatus)) throw new Error('Der Spielstatus ist ungültig.');
      const { data: game, error: gameError } = await context.supabaseAdmin
        .from('social_games')
        .select('id, status, home_score, away_score')
        .eq('id', gameId)
        .maybeSingle();
      if (gameError) throw gameError;
      if (!game) throw new Error('Das Spiel wurde nicht gefunden.');
      if (game.status === 'finished' || game.home_score !== null || game.away_score !== null) {
        throw new Error('Ein bereits gespieltes Spiel kann nicht abgesagt oder abgebrochen werden.');
      }
      if (stoppedGameStatuses.has(game.status)) throw new Error('Das Spiel wurde bereits beendet.');
      const { error: statusError } = await context.supabaseAdmin
        .from('social_games')
        .update({ status: nextStatus })
        .eq('id', gameId);
      if (statusError) throw statusError;
      const statusLabel = nextStatus === 'cancelled' ? 'abgesagt' : 'abgebrochen';
      const { error: jobsError } = await context.supabaseAdmin
        .from('social_story_jobs')
        .update({ status: 'skipped', last_error: `Das Spiel wurde ${statusLabel}.` })
        .eq('game_id', gameId)
        .in('story_type', ['lineup', 'result', 'report'])
        .in('status', ['pending', 'preview_ready', 'failed', 'needs_input', 'skipped']);
      if (jobsError) throw jobsError;
      const automation = await renderGameJobNow(context.supabaseAdmin, gameId, 'announcement');
      return json({ ok: true, status: nextStatus, automation });
    }

    if (action === 'save_result') {
      const homeScore = Number(body.homeScore);
      const awayScore = Number(body.awayScore);
      if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
        throw new Error('Das Ergebnis muss aus zwei nicht-negativen ganzen Zahlen bestehen.');
      }
      const gameId = required(body.gameId, 'Spiel-ID');
      const actionImageDataUrl = String(body.actionImageDataUrl ?? '').trim();
      const actionImage = actionImageDataUrl ? parseDataUrl(actionImageDataUrl, new Set(['image/jpeg', 'image/png', 'image/webp']), 8 * 1024 * 1024) : null;
      let removedReportImagePaths: string[] = [];
      const { data: existingGame, error: existingGameError } = await context.supabaseAdmin
        .from('social_games')
        .select('id, action_image_path, report_image_paths')
        .eq('id', gameId)
        .maybeSingle();
      if (existingGameError) throw existingGameError;
      if (!existingGame) throw new Error('Das Spiel wurde nicht gefunden.');
      const resultUpdate: Record<string, unknown> = {
        home_score: homeScore,
        away_score: awayScore,
        result_label: String(body.resultLabel ?? '').trim() || null,
        result_message: String(body.resultMessage ?? '').trim() || null,
        status: 'finished',
      };
      if ('reportScorers' in body) resultUpdate.report_scorers = String(body.reportScorers ?? '').trim() || null;
      if (actionImage) {
        const extension = originalMimeTypes.get(actionImage.mime) ?? 'png';
        const actionImagePath = `generated/action-images/${gameId}/${Date.now()}.${extension}`;
        const { error: uploadError } = await context.supabaseAdmin.storage.from(bucket).upload(actionImagePath, actionImage.bytes, {
          contentType: actionImage.mime,
          upsert: true,
        });
        if (uploadError) throw uploadError;
        resultUpdate.action_image_path = actionImagePath;
        resultUpdate.report_image_paths = [actionImagePath];
      }
      if (Array.isArray(body.reportImages)) {
        if (body.reportImages.length > 10) throw new Error('Ein Spielbericht kann höchstens zehn Bilder enthalten.');
        const ordered = body.reportImages.map((item: any, index: number) => ({
          path: required(item?.path, `Bild ${index + 1}`),
          position: Number(item?.position),
        })).sort((left: any, right: any) => left.position - right.position);
        const validPositions = ordered.every((item: any, index: number) => Number.isInteger(item.position) && item.position === index + 1);
        if (!validPositions) throw new Error('Die Bildpositionen müssen fortlaufend bei 1 beginnen.');
        const prefix = `generated/action-images/${gameId}/`;
        if (ordered.some((item: any) => !item.path.startsWith(prefix))) throw new Error('Ein Bildpfad gehört nicht zu diesem Spiel.');
        const nextPaths = ordered.map((item: any) => item.path);
        const previousPaths = Array.isArray(existingGame.report_image_paths) && existingGame.report_image_paths.length
          ? existingGame.report_image_paths.map((path: unknown) => String(path ?? '').trim()).filter(Boolean)
          : existingGame.action_image_path ? [existingGame.action_image_path] : [];
        removedReportImagePaths = previousPaths.filter((path: string) => path.startsWith(prefix) && !nextPaths.includes(path));
        resultUpdate.report_image_paths = nextPaths;
        resultUpdate.action_image_path = nextPaths[0] ?? null;
      }
      const { error } = await context.supabaseAdmin
        .from('social_games')
        .update(resultUpdate)
        .eq('id', gameId);
      if (error) throw error;
      if (removedReportImagePaths.length) {
        const { error: removeError } = await context.supabaseAdmin.storage.from(bucket).remove(removedReportImagePaths);
        if (removeError) console.warn(`Entfernte Spielbericht-Bilder konnten nicht bereinigt werden: ${removeError.message}`);
      }
      const { error: reportJobError } = await context.supabaseAdmin
        .from('social_story_jobs')
        .update({
          status: 'needs_input',
          attempts: 0,
          claimed_at: null,
          last_error: 'Spielbericht wurde geändert. Bitte erneut freigeben.',
          media_url: null,
          storage_path: null,
          media_urls: [],
          storage_paths: [],
        })
        .eq('game_id', gameId)
        .eq('story_type', 'report')
        .in('status', ['pending', 'rendering', 'preview_ready', 'published', 'failed', 'needs_input', 'skipped']);
      if (reportJobError) throw reportJobError;
      const automation = await renderGameJobNow(context.supabaseAdmin, gameId, 'result');
      return json({ ok: true, saved: true, automation });
    }

    if (action === 'upload_report_image') {
      const gameId = required(body.gameId, 'Spiel-ID');
      const image = parseDataUrl(body.imageDataUrl, new Set(['image/jpeg', 'image/png', 'image/webp']), 8 * 1024 * 1024);
      const { data: game, error: gameError } = await context.supabaseAdmin
        .from('social_games')
        .select('id')
        .eq('id', gameId)
        .maybeSingle();
      if (gameError) throw gameError;
      if (!game) throw new Error('Das Spiel wurde nicht gefunden.');
      const extension = originalMimeTypes.get(image.mime) ?? 'jpg';
      const path = `generated/action-images/${gameId}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await context.supabaseAdmin.storage.from(bucket).upload(path, image.bytes, {
        contentType: image.mime,
        cacheControl: '604800',
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const url = await signedAssetUrl(context.supabaseAdmin, path);
      return json({ ok: true, image: { path, url } });
    }

    if (action === 'approve_result') {
      const gameId = required(body.gameId, 'Spiel-ID');
      const automation = await renderGameJobNow(context.supabaseAdmin, gameId, 'report');
      return json({ ok: true, automation });
    }

    if (action === 'save_independent_story') {
      const storyId = String(body.storyId ?? '').trim() || crypto.randomUUID();
      const audienceId = required(body.audienceId, 'Zielgruppe');
      const categoryId = required(body.categoryId, 'Kategorie');
      const title = required(body.title, 'Titel');
      const motivation = required(body.motivation, 'Motivation');
      const activity = required(body.activity, 'Aktivität');
      const showActivityHeading = body.showActivityHeading !== false;
      const showMotivationHeading = body.showMotivationHeading !== false;
      const eventAt = new Date(required(body.eventAt, 'Termin'));
      const scheduleKind = String(body.scheduleKind ?? 'once');
      if (Number.isNaN(eventAt.getTime())) throw new Error('Der Termin ist ungültig.');
      if (title.length > 120 || motivation.length > 700 || activity.length > 300) throw new Error('Ein Story-Text ist zu lang.');
      if (!['once', 'weekly'].includes(scheduleKind)) throw new Error('Die Veröffentlichungsregel ist ungültig.');
      const publishAt = scheduleKind === 'once' ? new Date(required(body.publishAt, 'Veröffentlichungszeitpunkt')) : null;
      if (publishAt && Number.isNaN(publishAt.getTime())) throw new Error('Der Veröffentlichungszeitpunkt ist ungültig.');
      const weeklyWeekday = scheduleKind === 'weekly' ? Number(body.weeklyWeekday) : null;
      const weeklyTime = scheduleKind === 'weekly' ? required(body.weeklyTime, 'Uhrzeit').slice(0, 5) : null;
      if (scheduleKind === 'weekly' && (!Number.isInteger(weeklyWeekday) || Number(weeklyWeekday) < 1 || Number(weeklyWeekday) > 7 || !/^\d{2}:\d{2}$/.test(String(weeklyTime)))) {
        throw new Error('Bitte einen gültigen Wochentag und eine Uhrzeit auswählen.');
      }
      const [{ data: audience, error: audienceError }, { data: category, error: categoryError }, { data: existing, error: existingError }] = await Promise.all([
        context.supabaseAdmin.from('social_post_audiences').select('id').eq('id', audienceId).eq('active', true).maybeSingle(),
        context.supabaseAdmin.from('social_story_categories').select('id').eq('id', categoryId).eq('active', true).maybeSingle(),
        context.supabaseAdmin.from('social_independent_stories').select('id, image_path').eq('id', storyId).maybeSingle(),
      ]);
      if (audienceError) throw audienceError;
      if (categoryError) throw categoryError;
      if (existingError) throw existingError;
      if (!audience) throw new Error('Die ausgewählte Zielgruppe ist nicht aktiv.');
      if (!category) throw new Error('Die ausgewählte Kategorie ist nicht aktiv.');
      const payload: Record<string, unknown> = {
        id: storyId,
        audience_id: audienceId,
        category_id: categoryId,
        title,
        motivation,
        activity,
        show_activity_heading: showActivityHeading,
        show_motivation_heading: showMotivationHeading,
        event_at: eventAt.toISOString(),
        schedule_kind: scheduleKind,
        publish_at: publishAt?.toISOString() ?? null,
        weekly_weekday: weeklyWeekday,
        weekly_time: weeklyTime,
        schedule_timezone: 'Europe/Berlin',
        enabled: true,
      };
      if (!existing) payload.created_by = userId;
      const { data: story, error: storyError } = await context.supabaseAdmin.from('social_independent_stories').upsert(payload).select('id').single();
      if (storyError) throw storyError;
      return json({ ok: true, storyId: story.id });
    }

    if (action === 'upload_independent_story_image') {
      const storyId = required(body.storyId, 'Story-ID');
      const image = parseDataUrl(body.imageDataUrl, new Set(['image/jpeg', 'image/png', 'image/webp']), 8 * 1024 * 1024);
      const { data: story, error: storyError } = await context.supabaseAdmin.from('social_independent_stories').select('id, image_path').eq('id', storyId).maybeSingle();
      if (storyError) throw storyError;
      if (!story) throw new Error('Die Story wurde nicht gefunden.');
      const extension = originalMimeTypes.get(image.mime) ?? 'jpg';
      const path = `generated/story-images/${storyId}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await context.supabaseAdmin.storage.from(bucket).upload(path, image.bytes, { contentType: image.mime, cacheControl: '604800', upsert: false });
      if (uploadError) throw uploadError;
      const { error: updateError } = await context.supabaseAdmin.from('social_independent_stories').update({ image_path: path }).eq('id', storyId);
      if (updateError) {
        await context.supabaseAdmin.storage.from(bucket).remove([path]);
        throw updateError;
      }
      if (story.image_path?.startsWith(`generated/story-images/${storyId}/`)) {
        const { error: removeError } = await context.supabaseAdmin.storage.from(bucket).remove([story.image_path]);
        if (removeError) console.warn(`Altes Story-Bild konnte nicht bereinigt werden: ${removeError.message}`);
      }
      return json({ ok: true, image: { path, url: await signedAssetUrl(context.supabaseAdmin, path) } });
    }

    if (action === 'preview_independent_story' || action === 'schedule_independent_story') {
      const storyId = required(body.storyId, 'Story-ID');
      const { data: story, error: storyError } = await context.supabaseAdmin
        .from('social_independent_stories')
        .select('*, audience:social_post_audiences(team:social_teams(active, content_enabled))')
        .eq('id', storyId).eq('enabled', true).maybeSingle();
      if (storyError) throw storyError;
      if (!story) throw new Error('Die Story wurde nicht gefunden.');
      if (!story.image_path) throw new Error('Bitte zuerst ein Bild hochladen.');
      const audience = Array.isArray(story.audience) ? story.audience[0] : story.audience;
      const team = Array.isArray(audience?.team) ? audience.team[0] : audience?.team;
      if (team && (!team.active || !team.content_enabled)) throw new Error('Für diese Mannschaft ist die Inhaltserzeugung deaktiviert.');
      const scheduledFor = action === 'preview_independent_story'
        ? new Date().toISOString()
        : nextStoryDueAt(story, new Date());
      const occurrenceEventAt = action === 'schedule_independent_story' && story.schedule_kind === 'weekly'
        ? currentWeeklyEventAt(story.event_at, new Date(), story.schedule_timezone)
        : story.event_at;
      if (action === 'schedule_independent_story' && story.schedule_kind === 'once' && new Date(scheduledFor).getTime() < Date.now() - 60_000) {
        throw new Error('Der Veröffentlichungszeitpunkt liegt in der Vergangenheit.');
      }
      if (action === 'schedule_independent_story') {
        const { error: staleError } = await context.supabaseAdmin.from('social_independent_story_jobs').delete().eq('story_id', storyId).in('status', ['pending', 'failed', 'needs_input', 'skipped']);
        if (staleError) throw staleError;
      }
      const { data: job, error: jobError } = await context.supabaseAdmin.from('social_independent_story_jobs').insert({
        story_id: storyId,
        scheduled_for: scheduledFor,
        event_at: occurrenceEventAt,
        due_at: scheduledFor,
        status: action === 'preview_independent_story' ? 'needs_input' : 'pending',
      }).select('id').single();
      if (jobError) throw jobError;
      const automation = action === 'preview_independent_story'
        ? await runIndependentStoryPreviewWorker([job.id])
        : new Date(scheduledFor).getTime() <= Date.now() ? await runWorker([], [], [job.id]) : null;
      return json({ ok: true, jobId: job.id, scheduledFor, automation });
    }

    if (action === 'delete_independent_story') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const storyId = required(body.storyId, 'Story-ID');
      const [{ data: story, error: storyError }, { data: cleanupSettings, error: settingsError }] = await Promise.all([
        context.supabaseAdmin.from('social_independent_stories').select('schedule_kind, archived_at, image_path, jobs:social_independent_story_jobs(status, published_at, storage_path)').eq('id', storyId).maybeSingle(),
        context.supabaseAdmin.from('social_cleanup_settings').select('retention_days').eq('id', 1).maybeSingle(),
      ]);
      if (storyError) throw storyError;
      if (settingsError) throw settingsError;
      if (!story) throw new Error('Die Story wurde nicht gefunden.');
      if (!historyState(story, 'story', normalizeRetentionDays(cleanupSettings?.retention_days)).cleanup_eligible) {
        throw new Error('Die Story ist noch innerhalb der Aufbewahrungsfrist.');
      }
      const paths = [...new Set([story.image_path, ...(story.jobs ?? []).map((job: any) => job.storage_path)].map((path) => String(path ?? '').trim()).filter(Boolean))];
      if (paths.length) {
        const { error: removeError } = await context.supabaseAdmin.storage.from(bucket).remove(paths);
        if (removeError) throw removeError;
      }
      const { error: deleteError } = await context.supabaseAdmin.from('social_independent_stories').delete().eq('id', storyId);
      if (deleteError) throw deleteError;
      return json({ ok: true });
    }

    if (action === 'save_post') {
      const postId = String(body.postId ?? '').trim() || crypto.randomUUID();
      const audienceId = required(body.audienceId, 'Zielgruppe');
      const title = required(body.title, 'Titel');
      const postBody = String(body.body ?? '').trim();
      if (title.length > 120) throw new Error('Der Titel darf höchstens 120 Zeichen lang sein.');
      if (postBody.length > 2200) throw new Error('Der Beitragstext darf höchstens 2.200 Zeichen lang sein.');
      const { data: audience, error: audienceError } = await context.supabaseAdmin
        .from('social_post_audiences')
        .select('id')
        .eq('id', audienceId)
        .eq('active', true)
        .maybeSingle();
      if (audienceError) throw audienceError;
      if (!audience) throw new Error('Die ausgewählte Zielgruppe ist nicht aktiv.');
      const { data: existing, error: existingError } = await context.supabaseAdmin
        .from('social_posts')
        .select('id, image_paths')
        .eq('id', postId)
        .maybeSingle();
      if (existingError) throw existingError;
      let imagePaths = Array.isArray(existing?.image_paths) ? existing.image_paths : [];
      let removedPaths: string[] = [];
      if (Array.isArray(body.images)) {
        if (body.images.length > 10) throw new Error('Ein Beitrag kann höchstens zehn Bilder enthalten.');
        const ordered = body.images.map((item: any, index: number) => ({
          path: required(item?.path, `Bild ${index + 1}`),
          position: Number(item?.position),
        })).sort((left: any, right: any) => left.position - right.position);
        if (!ordered.every((item: any, index: number) => Number.isInteger(item.position) && item.position === index + 1)) {
          throw new Error('Die Bildpositionen müssen fortlaufend bei 1 beginnen.');
        }
        const prefix = `generated/post-images/${postId}/`;
        if (ordered.some((item: any) => !item.path.startsWith(prefix))) throw new Error('Ein Bildpfad gehört nicht zu diesem Beitrag.');
        const nextPaths = ordered.map((item: any) => item.path);
        removedPaths = imagePaths.filter((path: string) => path.startsWith(prefix) && !nextPaths.includes(path));
        imagePaths = nextPaths;
      }
      const payload: Record<string, unknown> = {
        id: postId,
        audience_id: audienceId,
        title,
        body: postBody,
        image_paths: imagePaths,
        enabled: true,
      };
      if (!existing) payload.created_by = userId;
      const { data: post, error: postError } = await context.supabaseAdmin
        .from('social_posts')
        .upsert(payload)
        .select('id')
        .single();
      if (postError) throw postError;
      if (removedPaths.length) {
        const { error: removeError } = await context.supabaseAdmin.storage.from(bucket).remove(removedPaths);
        if (removeError) console.warn(`Entfernte Beitragsbilder konnten nicht bereinigt werden: ${removeError.message}`);
      }
      const { error: jobError } = await context.supabaseAdmin
        .from('social_post_jobs')
        .upsert({
          post_id: post.id,
          status: 'needs_input',
          attempts: 0,
          claimed_at: null,
          last_error: 'Beitrag wurde geändert. Bitte freigeben.',
          media_url: null,
          storage_path: null,
          media_urls: [],
          storage_paths: [],
          external_post_id: null,
          published_at: null,
        }, { onConflict: 'post_id' });
      if (jobError) throw jobError;
      return json({ ok: true, postId: post.id });
    }

    if (action === 'upload_post_image') {
      const postId = required(body.postId, 'Beitrags-ID');
      const image = parseDataUrl(body.imageDataUrl, new Set(['image/jpeg', 'image/png', 'image/webp']), 8 * 1024 * 1024);
      const { data: post, error: postError } = await context.supabaseAdmin
        .from('social_posts')
        .select('id')
        .eq('id', postId)
        .maybeSingle();
      if (postError) throw postError;
      if (!post) throw new Error('Der Beitrag wurde nicht gefunden.');
      const extension = originalMimeTypes.get(image.mime) ?? 'jpg';
      const path = `generated/post-images/${postId}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await context.supabaseAdmin.storage.from(bucket).upload(path, image.bytes, {
        contentType: image.mime,
        cacheControl: '604800',
        upsert: false,
      });
      if (uploadError) throw uploadError;
      return json({ ok: true, image: { path, url: await signedAssetUrl(context.supabaseAdmin, path) } });
    }

    if (action === 'approve_post') {
      const postId = required(body.postId, 'Beitrags-ID');
      const { data: post, error: postError } = await context.supabaseAdmin
        .from('social_posts')
        .select('id, title, body, image_paths, enabled, audience:social_post_audiences(team:social_teams(active, content_enabled))')
        .eq('id', postId)
        .maybeSingle();
      if (postError) throw postError;
      if (!post?.enabled) throw new Error('Der Beitrag wurde nicht gefunden.');
      if (!String(post.title ?? '').trim()) throw new Error('Der Titel fehlt.');
      if (!String(post.body ?? '').trim()) throw new Error('Der Beitragstext fehlt.');
      if (!Array.isArray(post.image_paths) || post.image_paths.length < 1) throw new Error('Bitte mindestens ein Bild hochladen.');
      const audience = Array.isArray(post.audience) ? post.audience[0] : post.audience;
      const audienceTeam = Array.isArray(audience?.team) ? audience.team[0] : audience?.team;
      if (audienceTeam && (!audienceTeam.active || !audienceTeam.content_enabled)) {
        throw new Error('Für diese Mannschaft ist die Inhaltserzeugung in den Stammdaten deaktiviert.');
      }
      const { data: job, error: jobError } = await context.supabaseAdmin
        .from('social_post_jobs')
        .upsert({
          post_id: postId,
          status: 'pending',
          due_at: new Date().toISOString(),
          attempts: 0,
          claimed_at: null,
          last_error: null,
        }, { onConflict: 'post_id' })
        .select('id')
        .single();
      if (jobError) throw jobError;
      const automation = await runWorker([], [job.id]);
      return json({ ok: true, automation });
    }

    if (action === 'delete_post') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const postId = required(body.postId, 'Beitrags-ID');
      const [{ data: post, error: postError }, { data: cleanupSettings, error: settingsError }] = await Promise.all([
        context.supabaseAdmin
          .from('social_posts')
          .select('archived_at, image_paths, job:social_post_jobs(status, published_at, storage_paths, storage_path)')
          .eq('id', postId)
          .maybeSingle(),
        context.supabaseAdmin.from('social_cleanup_settings').select('retention_days').eq('id', 1).maybeSingle(),
      ]);
      if (postError) throw postError;
      if (settingsError) throw settingsError;
      if (!post) throw new Error('Der Beitrag wurde nicht gefunden.');
      if (!historyState(post, 'post', normalizeRetentionDays(cleanupSettings?.retention_days)).cleanup_eligible) {
        throw new Error('Der Beitrag ist noch innerhalb der Aufbewahrungsfrist.');
      }
      const postJob = Array.isArray(post.job) ? post.job[0] : post.job;
      const paths = [...new Set([
        ...(Array.isArray(post.image_paths) ? post.image_paths : []),
        ...(Array.isArray(postJob?.storage_paths) ? postJob.storage_paths : []),
        postJob?.storage_path,
      ].map((path) => String(path ?? '').trim()).filter(Boolean))];
      if (paths.length) {
        const { error: removeError } = await context.supabaseAdmin.storage.from(bucket).remove(paths);
        if (removeError) throw removeError;
      }
      const { error: deleteError } = await context.supabaseAdmin.from('social_posts').delete().eq('id', postId);
      if (deleteError) throw deleteError;
      return json({ ok: true });
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

    if (action === 'save_sponsor') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const sponsorId = String(body.sponsorId ?? '').trim();
      const name = required(body.name, 'Partnername');
      if (name.length > 120) throw new Error('Der Partnername darf höchstens 120 Zeichen lang sein.');
      const sortOrder = Number(body.sortOrder ?? 100);
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 32767) throw new Error('Die Sortierung ist ungültig.');
      const payload = {
        name,
        website_url: validHttpUrl(body.websiteUrl),
        instagram_handle: instagramHandle(body.instagramHandle),
        logo_source_url: validHttpUrl(body.sourceUrl),
        active: body.active !== false,
        sort_order: sortOrder,
      };
      if (sponsorId) {
        const { data, error } = await context.supabaseAdmin
          .from('social_sponsors')
          .update(payload)
          .eq('id', sponsorId)
          .select()
          .single();
        if (error) throw error;
        await invalidateSponsorPreviews(context.supabaseAdmin, sponsorId);
        return json({ ok: true, sponsor: data });
      }
      const { data, error } = await context.supabaseAdmin
        .from('social_sponsors')
        .insert({ ...payload, slug: sponsorSlug(name) })
        .select()
        .single();
      if (error) throw error;
      return json({ ok: true, sponsor: data });
    }

    if (action === 'save_sponsor_logo') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const sponsorId = required(body.sponsorId, 'Werbepartner');
      const { data: sponsor, error: sponsorError } = await context.supabaseAdmin
        .from('social_sponsors')
        .select('id, slug')
        .eq('id', sponsorId)
        .maybeSingle();
      if (sponsorError) throw sponsorError;
      if (!sponsor) throw new Error('Der Werbepartner wurde nicht gefunden.');
      const original = parseDataUrl(body.originalDataUrl, new Set(originalMimeTypes.keys()), 5 * 1024 * 1024);
      const transparent = parseDataUrl(body.transparentDataUrl, new Set(['image/png']), 5 * 1024 * 1024);
      const white = parseDataUrl(body.whiteDataUrl, new Set(['image/png']), 5 * 1024 * 1024);
      if (!pngHasAlpha(transparent.bytes) || !pngHasAlpha(white.bytes)) {
        throw new Error('Freistellung und weiße Variante müssen PNG-Dateien mit Alphakanal sein.');
      }
      const originalPath = `sponsors/${sponsor.slug}/original.${originalMimeTypes.get(original.mime)}`;
      const transparentPath = `sponsors/${sponsor.slug}/transparent.png`;
      const whitePath = `sponsors/${sponsor.slug}/white-v2.png`;
      const processing = body.processing && typeof body.processing === 'object' ? body.processing : {};
      const confidenceValue = Number(processing.confidence);
      const metadata = {
        method: String(processing.method ?? 'edge-connected-background').slice(0, 80),
        confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : null,
        reviewRecommended: Boolean(processing.reviewRecommended),
        borderDominance: Number(processing.borderDominance) || 0,
        transparentBorderRatio: Number(processing.transparentBorderRatio) || 0,
        removedRatio: Number(processing.removedRatio) || 0,
        backgroundColor: processing.backgroundColor ?? null,
        threshold: Number(processing.threshold) || null,
        width: Number(processing.width) || null,
        height: Number(processing.height) || null,
        whiteVariantVersion: 2,
        reviewed: false,
      };
      const uploads = await Promise.all([
        context.supabaseAdmin.storage.from(bucket).upload(originalPath, original.bytes, {
          contentType: original.mime, cacheControl: '604800', upsert: true,
        }),
        context.supabaseAdmin.storage.from(bucket).upload(transparentPath, transparent.bytes, {
          contentType: 'image/png', cacheControl: '604800', upsert: true,
        }),
        context.supabaseAdmin.storage.from(bucket).upload(whitePath, white.bytes, {
          contentType: 'image/png', cacheControl: '604800', upsert: true,
        }),
      ]);
      const uploadError = uploads.find((result) => result.error)?.error;
      if (uploadError) throw new Error(`Partnerlogo konnte nicht gespeichert werden: ${uploadError.message}`);
      const { data, error } = await context.supabaseAdmin
        .from('social_sponsors')
        .update({
          logo_original_path: originalPath,
          logo_transparent_path: transparentPath,
          logo_white_path: whitePath,
          logo_status: 'needs_review',
          processing_metadata: metadata,
        })
        .eq('id', sponsorId)
        .select()
        .single();
      if (error) throw error;
      await invalidateSponsorPreviews(context.supabaseAdmin, sponsorId);
      return json({ ok: true, sponsor: data });
    }

    if (action === 'save_sponsor_white_logo') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const sponsorId = required(body.sponsorId, 'Werbepartner');
      const { data: sponsor, error: sponsorError } = await context.supabaseAdmin
        .from('social_sponsors')
        .select('id, slug, logo_white_path, processing_metadata')
        .eq('id', sponsorId)
        .maybeSingle();
      if (sponsorError) throw sponsorError;
      if (!sponsor) throw new Error('Der Werbepartner wurde nicht gefunden.');
      const white = parseDataUrl(body.whiteDataUrl, new Set(['image/png']), 5 * 1024 * 1024);
      if (!pngHasAlpha(white.bytes)) throw new Error('Die weiße Variante muss eine PNG-Datei mit Alphakanal sein.');
      const whitePath = `sponsors/${sponsor.slug}/white-v2.png`;
      const { error: uploadError } = await context.supabaseAdmin.storage.from(bucket).upload(whitePath, white.bytes, {
        contentType: 'image/png', cacheControl: '604800', upsert: true,
      });
      if (uploadError) throw new Error(`Weiße Partnerlogo-Variante konnte nicht gespeichert werden: ${uploadError.message}`);
      const { data, error } = await context.supabaseAdmin
        .from('social_sponsors')
        .update({
          logo_white_path: whitePath,
          logo_status: 'needs_review',
          processing_metadata: {
            ...(sponsor.processing_metadata ?? {}),
            whiteVariantVersion: 2,
            reviewed: false,
          },
        })
        .eq('id', sponsorId)
        .select()
        .single();
      if (error) throw error;
      const previousWhitePath = String(sponsor.logo_white_path ?? '').trim();
      if (previousWhitePath.startsWith('sponsors/') && previousWhitePath !== whitePath) {
        await context.supabaseAdmin.storage.from(bucket).remove([previousWhitePath]);
      }
      await invalidateSponsorPreviews(context.supabaseAdmin, sponsorId);
      return json({ ok: true, sponsor: data });
    }

    if (action === 'approve_sponsor_logo' || action === 'reject_sponsor_logo') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const sponsorId = required(body.sponsorId, 'Werbepartner');
      const { data: sponsor, error: sponsorError } = await context.supabaseAdmin
        .from('social_sponsors')
        .select('id, logo_transparent_path, logo_white_path, processing_metadata')
        .eq('id', sponsorId)
        .maybeSingle();
      if (sponsorError) throw sponsorError;
      if (!sponsor) throw new Error('Der Werbepartner wurde nicht gefunden.');
      const nextStatus = action === 'approve_sponsor_logo' ? 'approved' : 'rejected';
      if (!sponsorStatuses.has(nextStatus)) throw new Error('Ungültiger Prüfstatus.');
      if (nextStatus === 'approved' && (!sponsor.logo_transparent_path || !sponsor.logo_white_path)) {
        throw new Error('Freistellung oder weiße Logovariante fehlt.');
      }
      const { error } = await context.supabaseAdmin
        .from('social_sponsors')
        .update({
          logo_status: nextStatus,
          processing_metadata: {
            ...(sponsor.processing_metadata ?? {}),
            reviewed: true,
            reviewedAt: new Date().toISOString(),
            reviewedBy: userId,
          },
        })
        .eq('id', sponsorId);
      if (error) throw error;
      await invalidateSponsorPreviews(context.supabaseAdmin, sponsorId);
      return json({ ok: true, status: nextStatus });
    }

    if (action === 'discard_sponsor_logo') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const sponsorId = required(body.sponsorId, 'Werbepartner');
      const { data: sponsor, error: sponsorError } = await context.supabaseAdmin
        .from('social_sponsors')
        .select('id, logo_original_path, logo_transparent_path, logo_white_path')
        .eq('id', sponsorId)
        .maybeSingle();
      if (sponsorError) throw sponsorError;
      if (!sponsor) throw new Error('Der Werbepartner wurde nicht gefunden.');
      const paths = [...new Set([
        sponsor.logo_original_path,
        sponsor.logo_transparent_path,
        sponsor.logo_white_path,
      ].map((path) => String(path ?? '').trim()).filter((path) => path.startsWith('sponsors/')))];
      if (paths.length) {
        const { error: removeError } = await context.supabaseAdmin.storage.from(bucket).remove(paths);
        if (removeError) throw new Error(`Partnerlogo-Dateien konnten nicht gelöscht werden: ${removeError.message}`);
      }
      const { error } = await context.supabaseAdmin
        .from('social_sponsors')
        .update({
          logo_original_path: null,
          logo_transparent_path: null,
          logo_white_path: null,
          logo_status: 'missing',
          processing_metadata: { discarded: true, discardedAt: new Date().toISOString(), discardedBy: userId },
        })
        .eq('id', sponsorId);
      if (error) throw error;
      await invalidateSponsorPreviews(context.supabaseAdmin, sponsorId);
      return json({ ok: true, status: 'missing', removed: paths.length });
    }

    if (action === 'save_sponsor_assignments') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const sponsorId = required(body.sponsorId, 'Werbepartner');
      const { data: previousAssignments, error: previousAssignmentsError } = await context.supabaseAdmin
        .from('social_sponsor_assignments')
        .select('context')
        .eq('sponsor_id', sponsorId);
      if (previousAssignmentsError) throw previousAssignmentsError;
      const previousContexts = (previousAssignments ?? []).map((assignment: any) => String(assignment.context ?? ''));
      const assignments = Array.isArray(body.assignments) ? body.assignments : [];
      const websiteAudienceIds = [...new Set(
        (Array.isArray(body.websiteAudienceIds) ? body.websiteAudienceIds : [])
          .map((audienceId: unknown) => required(audienceId, 'Website-Einheit')),
      )];
      const normalized = assignments.map((assignment: any) => ({
        sponsor_id: sponsorId,
        audience_id: required(assignment?.audienceId, 'Einheit'),
        context: required(assignment?.context, 'Kontext'),
        slot: Number(assignment?.slot),
      }));
      if (normalized.some((assignment: any) => !sponsorContexts.has(assignment.context) || ![1, 2].includes(assignment.slot))) {
        throw new Error('Eine Sponsor-Zuordnung ist ungültig.');
      }
      const assignmentKeys = normalized.map((assignment: any) => `${assignment.audience_id}:${assignment.context}`);
      if (new Set(assignmentKeys).size !== assignmentKeys.length) throw new Error('Eine Einheit wurde im gleichen Kontext doppelt belegt.');
      const socialAudienceIds = [...new Set(normalized.map((assignment: any) => assignment.audience_id))];
      if (socialAudienceIds.length) {
        const { data: audiences, error: audienceError } = await context.supabaseAdmin
          .from('social_post_audiences')
          .select('id')
          .in('id', socialAudienceIds)
          .eq('active', true);
        if (audienceError) throw audienceError;
        if ((audiences ?? []).length !== socialAudienceIds.length) throw new Error('Mindestens eine Social-Media-Einheit ist nicht mehr aktiv.');
        const contexts = [...new Set(normalized.map((assignment: any) => assignment.context))];
        const { data: occupied, error: occupiedError } = await context.supabaseAdmin
          .from('social_sponsor_assignments')
          .select('sponsor_id, audience_id, context, slot')
          .in('audience_id', socialAudienceIds)
          .in('context', contexts)
          .neq('sponsor_id', sponsorId);
        if (occupiedError) throw occupiedError;
        const conflicts = normalized.filter((assignment: any) => (occupied ?? []).some((existing: any) => (
          existing.audience_id === assignment.audience_id
          && existing.context === assignment.context
          && existing.slot === assignment.slot
        )));
        if (conflicts.length) throw new Error('Mindestens ein ausgewählter Platz ist bereits durch einen anderen Werbepartner belegt.');
      }
      if (websiteAudienceIds.length) {
        const { data: websiteAudiences, error: websiteAudienceError } = await context.supabaseAdmin
          .from('social_post_audiences')
          .select('id, audience_group')
          .in('id', websiteAudienceIds);
        if (websiteAudienceError) throw websiteAudienceError;
        const allowedWebsiteGroups = new Set(['club', 'all_departments', 'football_department', 'youth_department', 'mens_team', 'womens_team', 'youth_team']);
        if (
          (websiteAudiences ?? []).length !== websiteAudienceIds.length
          || (websiteAudiences ?? []).some((audience: any) => !allowedWebsiteGroups.has(String(audience.audience_group ?? '')))
        ) throw new Error('Mindestens eine Website-Einheit ist ungültig.');
      }
      const { error: deleteError } = await context.supabaseAdmin
        .from('social_sponsor_assignments')
        .delete()
        .eq('sponsor_id', sponsorId);
      if (deleteError) throw deleteError;
      if (normalized.length) {
        const { error: insertError } = await context.supabaseAdmin
          .from('social_sponsor_assignments')
          .insert(normalized);
        if (insertError) throw insertError;
      }
      const { error: deleteWebsiteError } = await context.supabaseAdmin
        .from('social_sponsor_website_assignments')
        .delete()
        .eq('sponsor_id', sponsorId);
      if (deleteWebsiteError) throw deleteWebsiteError;
      if (websiteAudienceIds.length) {
        const { error: insertWebsiteError } = await context.supabaseAdmin
          .from('social_sponsor_website_assignments')
          .insert(websiteAudienceIds.map((audienceId) => ({ sponsor_id: sponsorId, audience_id: audienceId })));
        if (insertWebsiteError) throw insertWebsiteError;
      }
      const automation = await invalidateSponsorPreviews(context.supabaseAdmin, sponsorId, previousContexts);
      return json({ ok: true, assignments: normalized, websiteAudienceIds, automation });
    }

    if (action === 'delete_sponsor') {
      if (normalizedRole !== 'admin') return json({ error: 'admin_only' }, 403);
      const sponsorId = required(body.sponsorId, 'Werbepartner');
      const { data: sponsor, error: sponsorError } = await context.supabaseAdmin
        .from('social_sponsors')
        .select('logo_original_path, logo_transparent_path, logo_white_path')
        .eq('id', sponsorId)
        .maybeSingle();
      if (sponsorError) throw sponsorError;
      if (!sponsor) throw new Error('Der Werbepartner wurde nicht gefunden.');
      const { data: previousAssignments, error: previousAssignmentsError } = await context.supabaseAdmin
        .from('social_sponsor_assignments')
        .select('context')
        .eq('sponsor_id', sponsorId);
      if (previousAssignmentsError) throw previousAssignmentsError;
      const previousContexts = (previousAssignments ?? []).map((assignment: any) => String(assignment.context ?? ''));
      const paths = [...new Set([
        sponsor.logo_original_path,
        sponsor.logo_transparent_path,
        sponsor.logo_white_path,
      ].map((path) => String(path ?? '').trim()).filter((path) => path.startsWith('sponsors/')))];
      if (paths.length) {
        const { error: removeError } = await context.supabaseAdmin.storage.from(bucket).remove(paths);
        if (removeError) throw removeError;
      }
      const { error } = await context.supabaseAdmin.from('social_sponsors').delete().eq('id', sponsorId);
      if (error) throw error;
      const automation = await invalidateSponsorPreviews(context.supabaseAdmin, sponsorId, previousContexts);
      return json({ ok: true, automation });
    }

    if (action === 'save_club_crest') {
      const clubId = required(body.clubId, 'Verein');
      const { data: club, error: clubError } = await context.supabaseAdmin
        .from('social_clubs')
        .select('id, slug')
        .eq('id', clubId)
        .maybeSingle();
      if (clubError) throw clubError;
      if (!club) throw new Error('Der Verein wurde nicht gefunden.');

      const original = parseDataUrl(body.originalDataUrl, new Set(originalMimeTypes.keys()), 5 * 1024 * 1024);
      const transparent = parseDataUrl(body.transparentDataUrl, new Set(['image/png']), 5 * 1024 * 1024);
      if (!pngHasAlpha(transparent.bytes)) throw new Error('Die freigestellte Datei muss ein PNG mit Alphakanal sein.');
      const originalExtension = originalMimeTypes.get(original.mime)!;
      const originalPath = `club-crests/${club.slug}/original.${originalExtension}`;
      const transparentPath = `club-crests/${club.slug}/transparent.png`;
      const sourceUrl = validHttpUrl(body.sourceUrl);
      const processing = body.processing && typeof body.processing === 'object' ? body.processing : {};
      const confidenceValue = Number(processing.confidence);
      const confidence = Number.isFinite(confidenceValue)
        ? Math.max(0, Math.min(1, confidenceValue))
        : null;
      const metadata = {
        method: String(processing.method ?? 'edge-connected-background').slice(0, 80),
        reviewRecommended: Boolean(processing.reviewRecommended),
        borderDominance: Number(processing.borderDominance) || 0,
        transparentBorderRatio: Number(processing.transparentBorderRatio) || 0,
        removedRatio: Number(processing.removedRatio) || 0,
        backgroundColor: processing.backgroundColor ?? null,
        threshold: Number(processing.threshold) || null,
        width: Number(processing.width) || null,
        height: Number(processing.height) || null,
        reviewed: false,
      };

      const [{ error: originalError }, { error: transparentError }] = await Promise.all([
        context.supabaseAdmin.storage.from(bucket).upload(originalPath, original.bytes, {
          contentType: original.mime,
          cacheControl: '604800',
          upsert: true,
        }),
        context.supabaseAdmin.storage.from(bucket).upload(transparentPath, transparent.bytes, {
          contentType: 'image/png',
          cacheControl: '604800',
          upsert: true,
        }),
      ]);
      if (originalError) throw new Error(`Original konnte nicht gespeichert werden: ${originalError.message}`);
      if (transparentError) throw new Error(`Freistellung konnte nicht gespeichert werden: ${transparentError.message}`);

      const { data, error } = await context.supabaseAdmin
        .from('social_clubs')
        .update({
          crest_source_url: sourceUrl,
          crest_original_path: originalPath,
          crest_transparent_path: transparentPath,
          crest_status: 'needs_review',
          transparency_confidence: confidence,
          transparency_metadata: metadata,
          last_checked_at: new Date().toISOString(),
        })
        .eq('id', clubId)
        .select()
        .single();
      if (error) throw error;
      return json({ ok: true, club: data });
    }

    if (action === 'discard_club_crest') {
      const clubId = required(body.clubId, 'Verein');
      const { data: club, error: clubError } = await context.supabaseAdmin
        .from('social_clubs')
        .select('id, crest_original_path, crest_transparent_path')
        .eq('id', clubId)
        .maybeSingle();
      if (clubError) throw clubError;
      if (!club) throw new Error('Der Verein wurde nicht gefunden.');

      const paths = [...new Set([
        club.crest_original_path,
        club.crest_transparent_path,
      ].filter((path): path is string => Boolean(path)))];
      if (paths.length) {
        const { error: removeError } = await context.supabaseAdmin.storage.from(bucket).remove(paths);
        if (removeError) throw new Error(`Wappen-Dateien konnten nicht gelöscht werden: ${removeError.message}`);
      }

      const { error: resetError } = await context.supabaseAdmin
        .from('social_clubs')
        .update({
          crest_original_path: null,
          crest_transparent_path: null,
          crest_status: 'missing',
          transparency_confidence: null,
          transparency_metadata: {
            discarded: true,
            discardedAt: new Date().toISOString(),
            discardedBy: userId,
          },
          last_checked_at: new Date().toISOString(),
        })
        .eq('id', clubId);
      if (resetError) throw resetError;
      const automation = await rerenderUpcomingClubGames(context.supabaseAdmin, clubId);
      return json({ ok: true, status: 'missing', removed: paths.length, automation });
    }

    if (action === 'approve_club_crest' || action === 'reject_club_crest') {
      const clubId = required(body.clubId, 'Verein');
      const { data: club, error: clubError } = await context.supabaseAdmin
        .from('social_clubs')
        .select('id, crest_transparent_path, transparency_metadata')
        .eq('id', clubId)
        .maybeSingle();
      if (clubError) throw clubError;
      if (!club) throw new Error('Der Verein wurde nicht gefunden.');
      const nextStatus = action === 'approve_club_crest' ? 'approved' : 'rejected';
      if (!crestStatuses.has(nextStatus)) throw new Error('Ungültiger Prüfstatus.');
      if (nextStatus === 'approved' && !club.crest_transparent_path) throw new Error('Es gibt noch keine Freistellung zum Freigeben.');
      const { error } = await context.supabaseAdmin
        .from('social_clubs')
        .update({
          crest_status: nextStatus,
          last_checked_at: new Date().toISOString(),
          transparency_metadata: {
            ...(club.transparency_metadata ?? {}),
            reviewed: true,
            reviewedAt: new Date().toISOString(),
            reviewedBy: userId,
          },
        })
        .eq('id', clubId);
      if (error) throw error;
      const automation = nextStatus === 'approved'
        ? await rerenderUpcomingClubGames(context.supabaseAdmin, clubId)
        : null;
      return json({ ok: true, status: nextStatus, automation });
    }

    if (action === 'retry_job') {
      const table = body.kind === 'birthday'
        ? 'social_birthday_jobs'
        : body.kind === 'post'
          ? 'social_post_jobs'
          : body.kind === 'independent-story'
            ? 'social_independent_story_jobs'
          : 'social_story_jobs';
      const { error } = await context.supabaseAdmin
        .from(table)
        .update({ status: 'pending', due_at: new Date().toISOString(), attempts: 0, last_error: null })
        .eq('id', required(body.jobId, 'Job-ID'));
      if (error) throw error;
      const jobId = required(body.jobId, 'Job-ID');
      const automation = body.kind === 'post'
        ? await runWorker([], [jobId])
        : body.kind === 'independent-story'
          ? await runWorker([], [], [jobId])
          : await runWorker();
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
