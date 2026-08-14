import { withSupabase } from 'npm:@supabase/server@1.4.1';
import opentype from 'npm:opentype.js@1.3.4';
import { runtimeConfig } from '../_shared/config.ts';
import { extractWidgetPageProps, parseNextMatches } from '../_shared/fussball-de-widget-parser.mjs';

type Team = {
  id: string;
  slug: string;
  name: string;
  competition: string;
  website_path: string | null;
  fussball_de_widget_id: string;
  fussball_de_team_id: string;
};

type ClubSource = {
  clubId: string;
  crestSourceUrl: string | null;
};

const terminalStatuses = new Set(['finished', 'cancelled', 'aborted']);

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
  return normalizedName.replaceAll(' ', '-').replaceAll(/[^a-z0-9-]/g, '').slice(0, 72)
    || `verein-${crypto.randomUUID().slice(0, 8)}`;
}

function displayCompetition(imported: string, fallback: string): string {
  const value = imported.trim();
  return !value || /^(?:FS|ME|PO|TU)\//i.test(value) ? fallback : value;
}

async function ensureClub(admin: any, teamName: string, source: ClubSource) {
  const alias = required(teamName, 'Vereinsname');
  const normalizedAlias = normalizeClubName(alias);
  const { data: knownAlias, error: aliasError } = await admin
    .from('social_club_aliases')
    .select('club_id')
    .eq('normalized_alias', normalizedAlias)
    .maybeSingle();
  if (aliasError) throw aliasError;

  const sourceFields = {
    fussball_de_url: source.clubId ? `https://next.fussball.de/verein/-/${source.clubId}` : null,
    crest_source_url: source.crestSourceUrl,
  };

  if (knownAlias?.club_id) {
    const { data: club, error: clubError } = await admin
      .from('social_clubs')
      .select('*')
      .eq('id', knownAlias.club_id)
      .single();
    if (clubError) throw clubError;
    const update: Record<string, unknown> = {};
    if (!club.fussball_de_url && sourceFields.fussball_de_url) update.fussball_de_url = sourceFields.fussball_de_url;
    if (!club.crest_source_url && sourceFields.crest_source_url) {
      update.crest_source_url = sourceFields.crest_source_url;
      if (club.crest_status === 'missing') update.crest_status = 'needs_review';
    }
    if (Object.keys(update).length) {
      const { data: updated, error: updateError } = await admin
        .from('social_clubs').update(update).eq('id', club.id).select('*').single();
      if (updateError) throw updateError;
      return updated;
    }
    return club;
  }

  const { data: club, error: clubError } = await admin
    .from('social_clubs')
    .upsert({
      slug: clubSlug(normalizedAlias),
      name: canonicalClubName(alias),
      normalized_name: normalizedAlias,
      ...sourceFields,
      crest_status: source.crestSourceUrl ? 'needs_review' : 'missing',
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

async function readWidget(team: Team) {
  const widgetUrl = `https://next.fussball.de/widget/team-matches/${team.fussball_de_widget_id}`;
  const sourcePage = team.website_path
    ? `https://gerinjo.github.io/bsv-website/${team.website_path.replace(/^\/+|\/+$/g, '')}/`
    : 'https://gerinjo.github.io/bsv-website/';
  const response = await fetch(widgetUrl, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      referer: sourcePage,
      'user-agent': 'BSV-Nordstern-Social-Media-Builder/1.0 (+https://gerinjo.github.io/bsv-website/)',
    },
  });
  if (!response.ok) throw new Error(`Widget antwortet mit HTTP ${response.status}.`);
  const pageProps = extractWidgetPageProps(await response.text());
  const fontId = required(pageProps.obfuscatedFont, 'Widget-Schrift');
  const fontResponse = await fetch(`https://www.fussball.de/export.fontface/-/format/ttf/id/${encodeURIComponent(fontId)}/type/font`);
  if (!fontResponse.ok) throw new Error(`Widget-Schrift antwortet mit HTTP ${fontResponse.status}.`);
  const font = opentype.parse(await fontResponse.arrayBuffer());
  return parseNextMatches(pageProps, (character: string) => font.charToGlyph(character)?.name);
}

async function syncTeam(admin: any, team: Team) {
  const matches = await readWidget(team);
  const summary = { team: team.slug, found: matches.length, inserted: 0, updated: 0, skipped: 0 };

  for (const match of matches) {
    const isHome = match.homeTeam.teamPermanentId === team.fussball_de_team_id;
    const isAway = match.awayTeam.teamPermanentId === team.fussball_de_team_id;
    if (!isHome && !isAway) {
      summary.skipped += 1;
      continue;
    }

    const homeTeamName = isHome ? team.name : match.homeTeam.name;
    const awayTeamName = isAway ? team.name : match.awayTeam.name;

    const [homeClub, awayClub] = await Promise.all([
      ensureClub(admin, homeTeamName, match.homeTeam),
      ensureClub(admin, awayTeamName, match.awayTeam),
    ]);
    const { data: existing, error: existingError } = await admin
      .from('social_games')
      .select('id, status, venue')
      .eq('source', 'fussball.de')
      .eq('source_match_id', match.sourceMatchId)
      .maybeSingle();
    if (existingError) throw existingError;

    const importedStatus = existing && terminalStatuses.has(existing.status) ? existing.status : match.status;
    const payload = {
      source: 'fussball.de',
      source_match_id: match.sourceMatchId,
      source_url: `https://next.fussball.de/spiel/-/${match.sourceMatchId}`,
      team_id: team.id,
      is_home: isHome,
      home_team: homeTeamName,
      away_team: awayTeamName,
      home_club_id: homeClub.id,
      away_club_id: awayClub.id,
      competition: displayCompetition(match.competition, team.competition),
      venue: isHome ? (existing?.venue || 'Hauptplatz') : null,
      kickoff_at: match.kickoffAt,
      status: importedStatus,
      enabled: true,
    };

    if (existing) {
      const { error } = await admin.from('social_games').update(payload).eq('id', existing.id);
      if (error) throw error;
      summary.updated += 1;
    } else {
      const { error } = await admin.from('social_games').insert(payload);
      if (error) throw error;
      summary.inserted += 1;
    }
  }
  return summary;
}

const secretHandler = withSupabase({ auth: 'secret' }, async (request, context) => {
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  const { data: teams, error: teamsError } = await context.supabaseAdmin
    .from('social_teams')
    .select('id, slug, name, competition, website_path, fussball_de_widget_id, fussball_de_team_id')
    .eq('active', true)
    .eq('sync_enabled', true)
    .not('fussball_de_widget_id', 'is', null)
    .not('fussball_de_team_id', 'is', null)
    .order('sort_order', { ascending: true });
  if (teamsError) return Response.json({ error: teamsError.message }, { status: 500 });

  const results = [];
  let failed = 0;
  for (const team of (teams ?? []) as Team[]) {
    try {
      const result = await syncTeam(context.supabaseAdmin, team);
      results.push({ ...result, ok: true });
      await context.supabaseAdmin.from('social_teams').update({
        last_synced_at: new Date().toISOString(),
        last_sync_error: null,
      }).eq('id', team.id);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : 'Unbekannter Importfehler';
      results.push({ team: team.slug, ok: false, error: message });
      await context.supabaseAdmin.from('social_teams').update({
        last_synced_at: new Date().toISOString(),
        last_sync_error: message.slice(0, 1000),
      }).eq('id', team.id);
    }
  }

  return Response.json({ ok: failed === 0, syncedAt: new Date().toISOString(), teams: results }, { status: failed ? 207 : 200 });
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
