import { withSupabase } from 'npm:@supabase/server@1.4.1';
import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2';
import {
  edgeFontBuffers,
  renderStorySvg,
  STORY_TYPES,
  type StoryType,
} from '../_shared/story-renderer.ts';

const wasmBytes = await Deno.readFile(
  new URL('index_bg.wasm', import.meta.resolve('npm:@resvg/resvg-wasm@2.6.2')),
);
await initWasm(wasmBytes);

const bucket = 'social-story-previews';
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

type RequestBody = {
  type?: StoryType;
  jobId?: string;
  game?: Record<string, unknown>;
  birthday?: Record<string, unknown>;
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: corsHeaders });
}

function safeSegment(value: unknown): string {
  const normalized = String(value ?? '').replaceAll(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return normalized || crypto.randomUUID();
}

function gameInput(game: Record<string, unknown>) {
  const kickoff = new Date(String(game.kickoff_at ?? game.kickoffAt ?? ''));
  if (Number.isNaN(kickoff.getTime())) throw new Error('Ungültiger Anstoßzeitpunkt.');

  const date = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(kickoff);
  const time = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
  }).format(kickoff);
  const lineup = (game.lineup ?? {}) as { formation?: string; players?: unknown[] };
  const homeClub = (game.home_club ?? {}) as { crest_status?: string; crest_transparent_path?: string };
  const awayClub = (game.away_club ?? {}) as { crest_status?: string; crest_transparent_path?: string };

  return {
    match: {
      matchId: game.source_match_id,
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      competition: game.competition,
      venue: game.venue,
      date,
      time: `${time} Uhr`,
      formation: lineup.formation,
      homeScore: game.home_score,
      awayScore: game.away_score,
      resultLabel: game.result_label,
      resultMessage: game.result_message,
      gameStatus: game.status,
      homeCrestPath: homeClub.crest_status === 'approved' ? homeClub.crest_transparent_path : null,
      awayCrestPath: awayClub.crest_status === 'approved' ? awayClub.crest_transparent_path : null,
    },
    lineup,
  };
}

function birthdayInput(birthday: Record<string, unknown>) {
  const person = (birthday.person ?? {}) as { roles?: unknown };
  return {
    birthdayName: birthday.person_name,
    birthdayMessage: birthday.message,
    birthdayRoles: person.roles,
  };
}

function contentType(path: string, fallback = 'image/png'): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  return fallback;
}

async function blobDataUri(blob: Blob, path: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${contentType(path, blob.type || 'application/octet-stream')};base64,${btoa(binary)}`;
}

async function personPhoto(admin: any, reference: string): Promise<string> {
  if (reference.startsWith('https://')) {
    const url = new URL(reference);
    const allowed = url.protocol === 'https:'
      && url.hostname === 'gerinjo.github.io'
      && url.pathname.startsWith('/bsv-website/images/')
      && !url.username
      && !url.password;
    if (!allowed) throw new Error('Die externe Spielerfoto-URL ist nicht freigegeben.');
    const response = await fetch(url, { redirect: 'error' });
    if (!response.ok) throw new Error(`Spielerfoto antwortet mit HTTP ${response.status}.`);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('Die Spielerfoto-URL liefert kein Bild.');
    if (blob.size > 10 * 1024 * 1024) throw new Error('Das Spielerfoto ist größer als 10 MB.');
    return blobDataUri(blob, url.pathname);
  }

  const { data, error } = await admin.storage.from(bucket).download(reference);
  if (error) throw new Error(`Spielerfoto konnte nicht geladen werden: ${error.message}`);
  return blobDataUri(data, reference);
}

async function clubCrest(admin: any, reference: string): Promise<string | undefined> {
  if (!reference.startsWith('club-crests/') && reference !== 'assets/bsv-nordstern.png') {
    throw new Error('Der Speicherpfad des Vereinswappens ist ungültig.');
  }
  const { data, error } = await admin.storage.from(bucket).download(reference);
  if (error) return undefined;
  return blobDataUri(data, reference);
}

let cachedImageAssets: Promise<{ logo: string; sparkasseLogo: string; actionPlayer: string }> | undefined;
function imageAssets(admin: any) {
  cachedImageAssets ??= (async () => {
    const paths = {
      logo: 'assets/bsv-nordstern.png',
      sparkasseLogo: 'assets/sparkasse-hegau-bodensee-white.png',
      actionPlayer: 'assets/footballer-action-v2.png',
    };
    const entries = await Promise.all(Object.entries(paths).map(async ([name, path]) => {
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error) throw new Error(`Renderer-Asset ${name} fehlt: ${error.message}`);
      return [name, await blobDataUri(data, path)];
    }));
    return Object.fromEntries(entries) as { logo: string; sparkasseLogo: string; actionPlayer: string };
  })();
  return cachedImageAssets;
}

const securedHandler = withSupabase({ auth: ['user', 'secret'] }, async (request, context) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await request.json() as RequestBody;
    if (!body.type || !STORY_TYPES.includes(body.type)) return json({ error: 'invalid_story_type' }, 400);
    const images = await imageAssets(context.supabaseAdmin);

    let svg: string;
    if (body.type === 'birthday') {
      if (!body.birthday) return json({ error: 'birthday_missing' }, 400);
      let playerPhotoDataUri: string | undefined;
      const photoPath = String(body.birthday.photo_path ?? '').trim();
      if (photoPath) {
        playerPhotoDataUri = await personPhoto(context.supabaseAdmin, photoPath);
      }
      svg = renderStorySvg({ type: body.type, match: birthdayInput(body.birthday), imageAssets: images, playerPhotoDataUri });
    } else {
      if (!body.game) return json({ error: 'game_missing' }, 400);
      const input = gameInput(body.game);
      const homeCrestPath = String(input.match.homeCrestPath ?? '').trim();
      const awayCrestPath = String(input.match.awayCrestPath ?? '').trim();
      const [homeCrestDataUri, awayCrestDataUri] = await Promise.all([
        homeCrestPath ? clubCrest(context.supabaseAdmin, homeCrestPath) : undefined,
        awayCrestPath ? clubCrest(context.supabaseAdmin, awayCrestPath) : undefined,
      ]);
      svg = renderStorySvg({
        type: body.type,
        match: input.match,
        lineup: input.lineup,
        imageAssets: images,
        homeCrestDataUri,
        awayCrestDataUri,
      });
    }

    const renderer = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1080 },
      font: {
        fontBuffers: edgeFontBuffers,
        loadSystemFonts: false,
        defaultFontFamily: 'Noto Sans',
        sansSerifFamily: 'Noto Sans',
        serifFamily: 'Noto Serif',
      },
      imageRendering: 0,
      textRendering: 0,
      shapeRendering: 2,
    });
    const rendered = renderer.render();
    const png = rendered.asPng();
    rendered.free();
    renderer.free();

    const storagePath = `generated/${body.type}/${safeSegment(body.jobId)}/${Date.now()}.png`;
    const { error: uploadError } = await context.supabaseAdmin.storage
      .from(bucket)
      .upload(storagePath, png, {
        contentType: 'image/png',
        cacheControl: '3600',
        upsert: true,
      });
    if (uploadError) throw new Error(`Vorschau konnte nicht gespeichert werden: ${uploadError.message}`);

    const { data: signed, error: signedError } = await context.supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    if (signedError || !signed?.signedUrl) {
      throw new Error(`Vorschau-URL konnte nicht erstellt werden: ${signedError?.message ?? 'unbekannt'}`);
    }

    return json({ mediaUrl: signed.signedUrl, storagePath, format: 'png', width: 1080, height: 1920 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Renderfehler';
    return json({ error: message }, 500);
  }
});

export default {
  fetch(request: Request): Promise<Response> | Response {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    return securedHandler(request);
  },
};
