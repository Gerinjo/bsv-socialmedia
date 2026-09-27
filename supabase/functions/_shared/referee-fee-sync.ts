import { load } from 'npm:cheerio@1.2.0';
import opentype from 'npm:opentype.js@1.3.4';
import { parseRefereeAppointment, refereeYouthSources } from '../../../src/referee-source.mjs';
import { extractWidgetPageProps, parseNextMatches } from './fussball-de-widget-parser.mjs';

export async function syncRefereeFees(db: any, fetcher = fetch, now = new Date()) {
  const { data: teams, error } = await db.from('social_teams').select('id,name,website_path').eq('referee_enabled', true).like('website_path', 'jugend/%');
  if (error) throw error;
  const summary = { checked: 0, assigned: 0, missing: 0, unknown: 0, issues: [] as string[] };
  const deadline = Date.now() + 65_000;
  const read = async (url: string) => {
    const original = new URL(url), signal = AbortSignal.timeout(8000);
    for (let hop = 0; hop < 4; hop++) {
      const response = await fetcher(url, { signal, redirect: 'manual', headers: { referer: 'https://bsvnordstern.de/' } });
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('invalid_redirect');
        const next = new URL(location, url);
        if (next.origin !== original.origin) throw new Error('cross_origin_redirect');
        url = next.href; continue;
      }
      if (!response.ok) throw new Error('source_unavailable');
      return response;
    }
    throw new Error('redirect_limit');
  };
  const orderedTeams = [...(teams || [])].sort((a, b) => a.website_path.localeCompare(b.website_path));
  // Rotate the first team each hour so a slow source cannot starve later teams.
  const offset = orderedTeams.length ? Math.floor(now.getTime() / 3600000) % orderedTeams.length : 0;
  for (const team of [...orderedTeams.slice(offset), ...orderedTeams.slice(0, offset)]) {
    const config = refereeYouthSources.find(row => row[0] === team.website_path);
    if (!config) continue;
    if (Date.now() > deadline) { summary.issues.push('Zeitlimit erreicht; weitere Mannschaften beim nächsten Abgleich.'); break; }
    try {
      const props = extractWidgetPageProps(await (await read(`https://next.fussball.de/widget/team-matches/${config[1]}`)).text());
      const rawMatches = [...new Map([...(props.previousMatches || []), ...props.nextMatches].filter((match: any) => /^[A-Z0-9]{32}$/.test(match.id) && !match.prePublished && !match.notAllocated && match.homeTeam?.teamPermanentId === config[2]).map((match: any) => [match.id, match])).values()] as any[];
      if (!/^[a-zA-Z0-9]+$/.test(props.obfuscatedFont || '')) throw new Error('font_missing');
      const font = opentype.parse(await (await read(`https://www.fussball.de/export.fontface/-/format/ttf/id/${props.obfuscatedFont}/type/font`)).arrayBuffer());
      for (const raw of rawMatches) {
        if (Date.now() > deadline) { summary.issues.push('Zeitlimit erreicht.'); break; }
        try {
          const match = parseNextMatches({ ...props, nextMatches: [raw] }, (char: string) => font.charToGlyph(char)?.name)[0];
          if (!match) continue;
          const age = Date.parse(match.kickoffAt) - now.getTime();
          if (age < -30 * 86400000 || age > 14 * 86400000) continue;
          const sourceUrl = `https://www.fussball.de/spiel/-/spiel/${match.sourceMatchId}`;
          let appointment = 'unknown';
          try {
            const html = await (await read(sourceUrl)).text();
            const $ = load(html);
            const ids = $('.team-name a[href*="/team-id/"]').map((_, el) => $(el).attr('href')?.match(/\/team-id\/([A-Z0-9]{32})/)?.[1]).get();
            if (ids.length !== 2 || ids[0] !== config[2] || ids[1] !== raw.guestTeam?.teamPermanentId) throw new Error('identity_changed');
            appointment = parseRefereeAppointment(html, load);
          } catch { summary.issues.push('Ansetzung nicht lesbar: ' + match.sourceMatchId); }
          const status = ['finished', 'acknowledged'].includes(raw.status) ? 'finished'
            : ['cancelled', 'postponed', 'aborted', 'live'].includes(raw.status) ? raw.status : 'scheduled';
          const result = await db.from('referee_fee_cases').upsert({
            source_match_id: match.sourceMatchId, source_url: sourceUrl, team_id: team.id,
            home_team: team.name, away_team: match.awayTeam.name, kickoff_at: match.kickoffAt,
            game_status: status, appointment_state: appointment, checked_at: now.toISOString(),
          }, { onConflict: 'source_match_id' });
          if (result.error) throw result.error;
          summary.checked++; summary[appointment as 'assigned' | 'missing' | 'unknown']++;
        } catch { summary.issues.push('Spiel konnte nicht übernommen werden: ' + raw.id); }
      }
    } catch { summary.issues.push('Spielplan nicht lesbar: ' + team.name); }
  }
  return summary;
}
