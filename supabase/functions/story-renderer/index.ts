import { withSupabase } from 'npm:@supabase/server@1.4.1';
import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2';
import {
  edgeFontBuffers,
  renderStorySvg,
  STORY_TYPES,
  teamCategoryLabel,
  type StoryType,
} from '../_shared/story-renderer.ts';
import { sponsorLogoReference } from '../../../src/sponsor-assignments.mjs';

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
  post?: Record<string, unknown>;
  story?: Record<string, unknown>;
  sponsors?: Array<Record<string, unknown>>;
  reportPageIndex?: number;
  reportPageCount?: number;
  postPageIndex?: number;
  postPageCount?: number;
  colorScheme?: Record<string, unknown>;
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
  const team = (game.team ?? {}) as { slug?: string; name?: string };

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
      reportScorers: game.report_scorers,
      gameStatus: game.status,
      teamCategory: teamCategoryLabel({ slug: team.slug, name: team.name }),
      actionImagePath: game.action_image_path ?? null,
      reportImagePaths: Array.isArray(game.report_image_paths)
        ? game.report_image_paths.map((path) => String(path ?? '').trim()).filter(Boolean).slice(0, 10)
        : [],
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

async function actionPhoto(admin: any, reference: string): Promise<string> {
  const { data, error } = await admin.storage.from(bucket).download(reference);
  if (error) throw new Error(`Action-Bild konnte nicht geladen werden: ${error.message}`);
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

async function sponsorLogos(admin: any, context: StoryType, sponsors: Array<Record<string, unknown>> = []): Promise<string[]> {
  return Promise.all(sponsors.slice(0, 2).map(async (sponsor) => {
    const reference = sponsorLogoReference(sponsor, context);
    if (!reference.startsWith('sponsors/') && !reference.startsWith('assets/')) throw new Error('Der Speicherpfad des Partnerlogos ist ungültig.');
    const { data, error } = await admin.storage.from(bucket).download(reference);
    if (error) throw new Error(`Partnerlogo konnte nicht geladen werden: ${error.message}`);
    return blobDataUri(data, reference);
  }));
}

let cachedImageAssets: Promise<{ logo: string; actionPlayer: string }> | undefined;
function imageAssets(admin: any) {
  cachedImageAssets ??= (async () => {
    const paths = {
      logo: 'assets/bsv-nordstern.png',
      actionPlayer: 'assets/footballer-action-v2.png',
    };
    const entries = await Promise.all(Object.entries(paths).map(async ([name, path]) => {
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error) throw new Error(`Renderer-Asset ${name} fehlt: ${error.message}`);
      return [name, await blobDataUri(data, path)];
    }));
    return Object.fromEntries(entries) as { logo: string; actionPlayer: string };
  })();
  return cachedImageAssets;
}

const securedHandler = withSupabase({ auth: ['user', 'secret'] }, async (request, context) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await request.json() as RequestBody;
    if (!body.type || !STORY_TYPES.includes(body.type)) return json({ error: 'invalid_story_type' }, 400);
    const images = await imageAssets(context.supabaseAdmin);
    const sponsorLogoDataUris = await sponsorLogos(context.supabaseAdmin, body.type, Array.isArray(body.sponsors) ? body.sponsors : []);

    let pageCount = 1;
    let outputPageNumber = 1;
    let outputPageCount = 1;
    let svgForPage: (index: number) => Promise<string>;
    if (body.type === 'birthday') {
      if (!body.birthday) return json({ error: 'birthday_missing' }, 400);
      let playerPhotoDataUri: string | undefined;
      const photoPath = String(body.birthday.photo_path ?? '').trim();
      if (photoPath) {
        playerPhotoDataUri = await personPhoto(context.supabaseAdmin, photoPath);
      }
      svgForPage = async () => renderStorySvg({
        type: body.type as StoryType,
        match: birthdayInput(body.birthday as Record<string, unknown>),
        imageAssets: images,
        sponsorLogoDataUris,
        playerPhotoDataUri,
        colorScheme: body.colorScheme,
      });
    } else if (body.type === 'story') {
      if (!body.story) return json({ error: 'story_missing' }, 400);
      const story = body.story;
      const title = String(story.title ?? '').trim();
      const motivation = String(story.motivation ?? '').trim();
      const activity = String(story.activity ?? '').trim();
      const imagePath = String(story.image_path ?? '').trim();
      const audience = story.audience as Record<string, unknown> | undefined;
      const category = story.category as Record<string, unknown> | undefined;
      const audienceLabel = String(audience?.label ?? '').trim();
      const categoryLabel = String(category?.label ?? '').trim();
      const eventAt = new Date(String(story.event_at ?? ''));
      if (!title || !motivation || !activity || !audienceLabel || !categoryLabel || !imagePath || Number.isNaN(eventAt.getTime())) {
        return json({ error: 'story_incomplete' }, 400);
      }
      if (!imagePath.startsWith(`generated/story-images/${safeSegment(story.id)}/`)) {
        return json({ error: 'invalid_story_image_path' }, 400);
      }
      const actionPhotoDataUri = await actionPhoto(context.supabaseAdmin, imagePath);
      const team = audience?.team as Record<string, unknown> | undefined;
      const eventDate = new Intl.DateTimeFormat('de-DE', {
        timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
      }).format(eventAt);
      const eventTime = new Intl.DateTimeFormat('de-DE', {
        timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit',
      }).format(eventAt);
      svgForPage = async () => renderStorySvg({
        type: body.type as StoryType,
        match: {
          storyTitle: title,
          storyMotivation: motivation,
          storyActivity: activity,
          storyAudience: audienceLabel,
          storyCategory: categoryLabel,
          storyEventDate: eventDate,
          storyEventTime: `${eventTime} Uhr`,
        },
        imageAssets: images,
        sponsorLogoDataUris,
        actionPhotoDataUri,
        colorScheme: team?.color_scheme as Record<string, unknown> | undefined,
      });
    } else if (body.type === 'post') {
      if (!body.post) return json({ error: 'post_missing' }, 400);
      const post = body.post;
      const title = String(post.title ?? '').trim();
      const audience = post.audience as Record<string, unknown> | undefined;
      const audienceLabel = String(audience?.label ?? '').trim();
      const teamCategory = teamCategoryLabel({
        slug: audience?.slug,
        audienceGroup: audience?.audience_group,
        label: audienceLabel,
      });
      const paths = Array.isArray(post.image_paths)
        ? post.image_paths.map((path) => String(path ?? '').trim()).filter(Boolean).slice(0, 10)
        : [];
      if (!title || !audienceLabel || !paths.length) return json({ error: 'post_incomplete' }, 400);
      if (paths.some((path) => !path.startsWith(`generated/post-images/${safeSegment(post.id)}/`))) {
        return json({ error: 'invalid_post_image_path' }, 400);
      }
      const requestedPageIndex = Number.isInteger(body.postPageIndex) ? Number(body.postPageIndex) : null;
      if (requestedPageIndex !== null && (requestedPageIndex < 0 || requestedPageIndex >= paths.length)) {
        return json({ error: 'invalid_post_page' }, 400);
      }
      pageCount = requestedPageIndex === null ? paths.length : 1;
      outputPageNumber = requestedPageIndex === null ? 1 : requestedPageIndex + 1;
      outputPageCount = requestedPageIndex === null
        ? paths.length
        : Math.max(Number(body.postPageCount) || paths.length, paths.length);
      svgForPage = async (index) => {
        const sourceIndex = requestedPageIndex ?? index;
        const actionPhotoDataUri = await actionPhoto(context.supabaseAdmin, paths[sourceIndex]);
        return renderStorySvg({
          type: body.type as StoryType,
          match: { postTitle: title, postAudience: audienceLabel, teamCategory },
          imageAssets: images,
          sponsorLogoDataUris,
          actionPhotoDataUri,
          reportPage: sourceIndex + 1,
          reportPageCount: outputPageCount,
          colorScheme: body.colorScheme,
        });
      };
    } else {
      if (!body.game) return json({ error: 'game_missing' }, 400);
      const input = gameInput(body.game);
      const homeCrestPath = String(input.match.homeCrestPath ?? '').trim();
      const awayCrestPath = String(input.match.awayCrestPath ?? '').trim();
      const actionImagePath = String(input.match.actionImagePath ?? '').trim();
      const reportImagePaths = Array.isArray(input.match.reportImagePaths)
        ? input.match.reportImagePaths
        : [];
      const [homeCrestDataUri, awayCrestDataUri] = await Promise.all([
        homeCrestPath ? clubCrest(context.supabaseAdmin, homeCrestPath) : undefined,
        awayCrestPath ? clubCrest(context.supabaseAdmin, awayCrestPath) : undefined,
      ]);
      if (body.type === 'report') {
        const paths = reportImagePaths.length ? reportImagePaths : actionImagePath ? [actionImagePath] : [];
        const availablePageCount = Math.max(paths.length, 1);
        const requestedPageIndex = Number.isInteger(body.reportPageIndex)
          ? Number(body.reportPageIndex)
          : null;
        if (requestedPageIndex !== null && (requestedPageIndex < 0 || requestedPageIndex >= availablePageCount)) {
          return json({ error: 'invalid_report_page' }, 400);
        }
        pageCount = requestedPageIndex === null ? availablePageCount : 1;
        outputPageNumber = requestedPageIndex === null ? 1 : requestedPageIndex + 1;
        outputPageCount = requestedPageIndex === null
          ? availablePageCount
          : Math.max(Number(body.reportPageCount) || availablePageCount, availablePageCount);
        svgForPage = async (index) => {
          const sourceIndex = requestedPageIndex ?? index;
          const actionPhotoDataUri = paths[sourceIndex]
            ? await actionPhoto(context.supabaseAdmin, paths[sourceIndex])
            : undefined;
          return renderStorySvg({
            type: body.type as StoryType,
            match: input.match,
            lineup: input.lineup,
            imageAssets: images,
            sponsorLogoDataUris,
            homeCrestDataUri,
            awayCrestDataUri,
            actionPhotoDataUri,
            reportPage: sourceIndex + 1,
            reportPageCount: outputPageCount,
            reportPageKind: sourceIndex === 0 ? 'result' : sourceIndex === 1 ? 'scorers' : 'photo',
            colorScheme: body.colorScheme,
          });
        };
      } else {
        svgForPage = async () => {
          const actionPhotoDataUri = actionImagePath
            ? await actionPhoto(context.supabaseAdmin, actionImagePath)
            : undefined;
          return renderStorySvg({
            type: body.type as StoryType,
            match: input.match,
            lineup: input.lineup,
            imageAssets: images,
            sponsorLogoDataUris,
            homeCrestDataUri,
            awayCrestDataUri,
            actionPhotoDataUri,
            colorScheme: body.colorScheme,
          });
        };
      }
    }

    const stamp = Date.now();
    const renderedPages: Array<{ mediaUrl: string; storagePath: string }> = [];
    for (let index = 0; index < pageCount; index += 1) {
      const svg = await svgForPage(index);
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
      const pageNumber = pageCount > 1 ? index + 1 : outputPageNumber;
      const suffix = Math.max(pageCount, outputPageCount) > 1 ? `-${pageNumber}` : '';
      const storagePath = `generated/${body.type}/${safeSegment(body.jobId)}/${stamp}${suffix}.png`;
      const { error: uploadError } = await context.supabaseAdmin.storage
        .from(bucket)
        .upload(storagePath, png, {
          contentType: 'image/png',
          cacheControl: '3600',
          upsert: true,
        });
      if (uploadError) throw new Error(`Vorschau ${index + 1} konnte nicht gespeichert werden: ${uploadError.message}`);
      const { data: signed, error: signedError } = await context.supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
      if (signedError || !signed?.signedUrl) {
        throw new Error(`Vorschau-URL ${index + 1} konnte nicht erstellt werden: ${signedError?.message ?? 'unbekannt'}`);
      }
      renderedPages.push({ mediaUrl: signed.signedUrl, storagePath });
    }

    const mediaUrls = renderedPages.map((page) => page.mediaUrl);
    const storagePaths = renderedPages.map((page) => page.storagePath);
    return json({
      mediaUrl: mediaUrls[0],
      storagePath: storagePaths[0],
      mediaUrls,
      storagePaths,
      format: 'png',
      width: 1080,
      height: body.type === 'report' ? 1080 : 1920,
    });
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
