import { discoverEditorialTeamPhoto } from './editorial-team-photo.mjs';
import { editorialSportsBody } from './editorial-sports-format.mjs';
export { editorialSportsBody } from './editorial-sports-format.mjs';
import { decodeWidgetText, parseGermanKickoff } from '../supabase/functions/_shared/fussball-de-widget-parser.mjs';
import { editorialTeamProfile } from './editorial.mjs';

export function discoverSportsWidget(html, type) {
  for (const tag of String(html).match(/<[^>]+>/g) ?? []) {
    if (tag.match(/data-type=["']([^"']+)["']/)?.[1] !== type) continue;
    const id = tag.match(/data-id=["']([0-9a-f-]{36})["']/i)?.[1];
    if (id) return id;
  }
  return null;
}
export const discoverTableWidget = html => discoverSportsWidget(html, 'table');
function pageProps(html) {
  const source = String(html).match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!source) throw new Error('Unbekanntes Sportdatenformat.');
  const props = JSON.parse(source)?.props?.pageProps;
  if (!props || props.invalidReferrer) throw new Error('Die Verbandsdaten sind nicht verfügbar.');
  return props;
}
export function parseEditorialTable(html, glyphNameForCharacter) {
  const props = pageProps(html);
  if (!Array.isArray(props.table?.entries)) throw new Error('Die Verbandstabelle ist nicht verfügbar.');
  const decode = value => decodeWidgetText(value, glyphNameForCharacter);
  return {
    competition: decode(props.competitionName),
    rows: props.table.entries.map(row => ({
      position: decode(row.position), team: decode(row.teamName),
      matches: decode(row.matches), goals: decode(row.goalRatio), points: decode(row.points),
    })),
  };
}
const berlinDay = value => new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
export function parseEditorialMatches(html, glyphNameForCharacter) {
  const props = pageProps(html);
  if (!Array.isArray(props.nextMatches) || !Array.isArray(props.previousMatches)) throw new Error('Der Spielplan ist nicht verfügbar.');
  const decode = value => decodeWidgetText(value, glyphNameForCharacter);
  const notices = [];
  const matches = [...props.previousMatches, ...props.nextMatches].flatMap(match => {
    const home = decode(match.homeTeam?.name), away = decode(match.guestTeam?.name);
    const status = String(match.status || '').toLowerCase();
    if (/cancel|postpon|abort/.test(status) || match.notAllocated || match.prePublished) return [];
    if (/spielfrei|freilos/i.test(home + ' ' + away)) {
      notices.push(`${decode(match.kickoff?.date)} · ${home} – ${away}`);
      return [];
    }
    if (!match.id || !home || !away) return [];
    const time = decode(match.kickoff?.time);
    const kickoffAt = parseGermanKickoff(decode(match.kickoff?.dateWithWeekday || match.kickoff?.date), time || '12:00');
    const homeScore = decode(match.result?.homeResult), awayScore = decode(match.result?.guestResult);
    const completed = /acknowledged|finished/.test(status) && /^\d+$/.test(homeScore) && /^\d+$/.test(awayScore);
    return [{ id: String(match.id), date: berlinDay(kickoffAt), time, kickoffAt, home, away,
      competition: decode(match.competitionName || props.competitionName),
      finished: completed, scheduled: status === 'scheduled',
      score: completed ? `${homeScore}:${awayScore}` : null }];
  });
  return { matches: [...new Map(matches.map(match => [match.id, match])).values()], notices };
}
export function selectEditorialMatches(matches, issueDate, shortSchedule, now = new Date()) {
  const today = berlinDay(now), referenceDate = issueDate > today ? issueDate : today;
  return {
    referenceDate,
    lastMatches: matches.filter(match => match.finished && match.date <= issueDate && match.date <= today)
      .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt)).slice(0, 1),
    upcoming: matches.filter(match => match.scheduled && match.date >= referenceDate && match.kickoffAt >= now.toISOString())
      .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt)).slice(0, shortSchedule ? 2 : 3),
  };
}
function savedMatches(games, teamId) {
  return games.filter(game => game.team_id === teamId).map(game => ({
    id: game.source_match_id || game.id || game.kickoff_at + game.home_team + game.away_team,
    kickoffAt: game.kickoff_at, date: berlinDay(game.kickoff_at),
    time: new Date(game.kickoff_at).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }),
    home: game.home_team, away: game.away_team, competition: game.competition || '',
    scheduled: game.status === 'scheduled',
    finished: game.status === 'finished' && game.home_score != null && game.away_score != null,
    score: game.home_score != null && game.away_score != null ? `${game.home_score}:${game.away_score}` : null,
  }));
}
export async function editorialSportsSnapshot({ team, games, cutoff, parseFont, fetchImpl = fetch, now = new Date() }) {
  const fetchedAt = now.toISOString(), warnings = [];
  const failedSources = { table: false, matches: false };
  let table = null, sourceUrl = null, matchesUrl = null, matches = null, notices = [];
  let fetchFailed = false, teamPhoto;
  try {
    if (!team.website_path) throw new Error('Keine Mannschaftsseite hinterlegt.');
    const sourcePage = new URL(team.website_path.replace(/^\/+/, '').replace(/\/?$/, '/'), 'https://bsvnordstern.de/');
    if (sourcePage.origin !== 'https://bsvnordstern.de') throw new Error('Ungültige Mannschaftsseite.');
    const get = async url => {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(12000), redirect: 'error', headers: { referer: sourcePage.href } });
      if (!response.ok) throw new Error(`Sportdaten nicht erreichbar (HTTP ${response.status}).`);
      return response;
    };
    const html = await (await get(sourcePage.href)).text();
    teamPhoto = discoverEditorialTeamPhoto(html, sourcePage.href);
    const loadWidget = async (type, parser) => {
      const widget = discoverSportsWidget(html, type);
      if (!widget) throw new Error(type === 'table' ? 'Für diese Mannschaft ist keine Verbandstabelle hinterlegt.' : 'Für diese Mannschaft ist kein Spielplan hinterlegt.');
      const url = `https://next.fussball.de/widget/${type}/${widget}`;
      const content = await (await get(url)).text(), props = pageProps(content);
      const font = props.obfuscatedFont ? parseFont(await (await get(`https://www.fussball.de/export.fontface/-/format/ttf/id/${encodeURIComponent(props.obfuscatedFont)}/type/font`)).arrayBuffer()) : null;
      return { data: parser(content, character => font?.charToGlyph(character)?.name), url };
    };
    // Each source fails independently; no missing result is invented from a table.
    const results = await Promise.allSettled([loadWidget('table', parseEditorialTable), loadWidget('team-matches', parseEditorialMatches)]);
    if (results[0].status === 'fulfilled') { table = results[0].value.data; sourceUrl = results[0].value.url; }
    else { warnings.push(results[0].reason.message); fetchFailed = true; failedSources.table = true; }
    if (results[1].status === 'fulfilled') { matches = results[1].value.data.matches; notices = results[1].value.data.notices; matchesUrl = results[1].value.url; }
    else { warnings.push(results[1].reason.message); fetchFailed = true; failedSources.matches = true; }
  } catch (error) { warnings.push(error.message); fetchFailed = true; failedSources.table = true; failedSources.matches = true; }
  const fallback = matches === null;
  if (fallback) { matches = savedMatches(games, team.id); warnings.push('Spielplan-Ersatz aus dem gespeicherten Datenbestand; Vollständigkeit nicht gewährleistet.'); }
  const compact = editorialTeamProfile(team).compact;
  const selected = selectEditorialMatches(matches, cutoff, ['C', 'D'].includes(editorialTeamProfile(team).group), now);
  const snapshot = { fetchedAt, teamPhoto, sourceUrl, matchesUrl, table, compact, cutoff, ...selected, notices,
    warning: warnings.join(' '), fetchFailed, failedSources,
    matchSourceLabel: fallback ? 'Gespeicherte Vereinsdaten · kein vollständiges Spielarchiv.' : 'FUSSBALL.DE · veröffentlichte Mannschaftspartien über die BSV-Homepage.',
  };
  const body = editorialSportsBody(team, snapshot);
  const autoApprovalEligible = editorialTeamProfile(team).automaticSports && Boolean(matchesUrl) && (Boolean(table) || warnings.includes('Für diese Mannschaft ist keine Verbandstabelle hinterlegt.'));
  return { body, snapshot: { ...snapshot, generatedBody: body, autoApprovalEligible } };
}
