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
    },
    lineup,
  };
}

function birthdayInput(birthday: Record<string, unknown>) {
  return {
    birthdayName: birthday.person_name,
    birthdayMessage: birthday.message,
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
        const { data, error } = await context.supabaseAdmin.storage.from(bucket).download(photoPath);
        if (error) throw new Error(`Spielerfoto konnte nicht geladen werden: ${error.message}`);
        playerPhotoDataUri = await blobDataUri(data, photoPath);
      }
      svg = renderStorySvg({ type: body.type, match: birthdayInput(body.birthday), imageAssets: images, playerPhotoDataUri });
    } else {
      if (!body.game) return json({ error: 'game_missing' }, 400);
      const input = gameInput(body.game);
      svg = renderStorySvg({ type: body.type, match: input.match, lineup: input.lineup, imageAssets: images });
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
