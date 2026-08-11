import { withSupabase } from 'npm:@supabase/server@1.4.1';
import { runtimeConfig } from '../_shared/config.ts';
import { CLUB_CREST_SEEDS } from '../_shared/club-crest-seeds.ts';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const bucket = 'social-story-previews';
const homeVenues = new Set(['Hauptplatz', 'Nebenplatz', 'Kunstrasenplatz 1', 'Kunstrasenplatz 2']);
const crestStatuses = new Set(['missing', 'needs_review', 'approved', 'rejected']);
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

async function signedAssetUrl(admin: any, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) return null;
  return data?.signedUrl ?? null;
}

async function freshClubUrls(admin: any, rows: any[]): Promise<any[]> {
  return await Promise.all(rows.map(async (club) => ({
    ...club,
    crest_original_url: await signedAssetUrl(admin, club.crest_original_path),
    crest_transparent_url: await signedAssetUrl(admin, club.crest_transparent_path),
  })));
}

async function rerenderUpcomingClubGames(admin: any, clubId: string) {
  const { data: games, error: gamesError } = await admin
    .from('social_games')
    .select('id')
    .eq('away_club_id', clubId)
    .eq('enabled', true)
    .gte('kickoff_at', new Date().toISOString());
  if (gamesError) throw gamesError;
  const gameIds = (games ?? []).map((game: any) => game.id);
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
    await ensureSeedClubAssets(context.supabaseAdmin);
    const [
      { data: games, error: gamesError },
      { data: birthdays, error: birthdaysError },
      { data: teams, error: teamsError },
      { data: people, error: peopleError },
      { data: clubs, error: clubsError },
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
      context.supabaseAdmin
        .from('social_clubs')
        .select('*, aliases:social_club_aliases(alias, normalized_alias)')
        .order('name', { ascending: true }),
    ]);
    const readError = gamesError ?? birthdaysError ?? teamsError ?? peopleError ?? clubsError;
    if (readError) return json({ error: readError.message }, 500);
    return json({
      user: { userId, email },
      testMode: true,
      venues: [...homeVenues],
      teams: teams ?? [],
      people: people ?? [],
      clubs: await freshClubUrls(context.supabaseAdmin, clubs ?? []),
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
