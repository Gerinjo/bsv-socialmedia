import test from 'node:test';
import assert from 'node:assert/strict';
import { editorialSeeds, editorialTeamProfile } from '../src/editorial.mjs';
import { parseEditorialMatches, selectEditorialMatches, editorialSportsSnapshot, editorialSportsBody } from '../src/editorial-sports.mjs';
const html = props => `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: props } })}</script>`;
const fixture = (id, status, date, extra = {}) => ({ id, status, kickoff: { date, time: '14:00' }, homeTeam: { name: 'BSV' }, guestTeam: { name: 'Gast' }, result: { homeResult: '0', guestResult: '0' }, ...extra });
test('stadium scope includes A–D independently of social-media activation and makes all sports automatic while keeping only youth compact', () => {
  const teams = [
    { id: 'men', slug: 'herren-1', active: true },
    { id: 'women', slug: 'frauen-2', active: true },
    { id: 'a', website_path: 'jugend/u19', active: false },
    { id: 'b', name: 'B-Junioren', active: false },
    { id: 'c', website_path: 'jugend/u15-c2', active: false },
    { id: 'd', website_path: 'jugend/juniorinnen/u13', active: false },
    { id: 'e', website_path: 'jugend/u11-e1', active: true },
    { id: 'old', slug: 'alte-herren', active: true },
  ];
  assert.deepEqual(editorialSeeds('stadium', teams).filter(a => a.kind === 'sports').map(a => a.team_id), ['men', 'women', 'a', 'b', 'c', 'd']);
  assert.deepEqual(teams.filter(t => editorialTeamProfile(t).compact).map(t => t.id), ['a', 'b', 'c', 'd']);
  const seeds = editorialSeeds('stadium', teams);
  assert.deepEqual(seeds.filter(a => a.automatic_sports).map(a => a.team_id), ['men', 'women', 'a', 'b', 'c', 'd']);
  assert.ok(seeds.filter(a => a.kind === 'coach').every(a => !a.automatic_sports));
});
test('official acknowledged zero results are retained; cancelled, postponed, live and bye entries do not become results', () => {
  const parsed = parseEditorialMatches(html({
    previousMatches: [fixture('zero', 'acknowledged', '19.09.2026'), fixture('live', 'live', '20.09.2026')],
    nextMatches: [fixture('next', 'scheduled', '26.09.2026'), fixture('cancelled', 'cancelled', '27.09.2026'), fixture('postponed', 'postponed', '28.09.2026'), fixture('bye', 'scheduled', '29.09.2026', { guestTeam: { name: 'spielfrei' } })],
  }), () => null);
  const selected = selectEditorialMatches(parsed.matches, '2026-09-26', false, new Date('2026-09-20T10:00:00Z'));
  assert.deepEqual(selected.lastMatches.map(m => m.score), ['0:0']);
  assert.deepEqual(selected.upcoming.map(m => m.id), ['next']);
  assert.equal(parsed.notices.length, 1);
});
test('upcoming selection respects publication day and current time, with two fixtures for compact youth', () => {
  const matches = Array.from({ length: 5 }, (_, i) => ({ id: String(i), date: `2026-09-${20+i}`, kickoffAt: `2026-09-${20+i}T12:00:00Z`, scheduled: true }));
  assert.equal(selectEditorialMatches(matches, '2026-09-22', false, new Date('2026-09-20T10:00Z')).upcoming.length, 3);
  assert.equal(selectEditorialMatches(matches, '2026-09-22', true, new Date('2026-09-20T10:00Z')).upcoming.length, 2);
  assert.equal(selectEditorialMatches(matches, '2026-09-19', false, new Date('2026-09-20T13:00Z')).upcoming[0].date, '2026-09-21');
});
test('sports fetch uses both official widgets, preserves full table and carries source timestamps', async () => {
  const team = { id: 'c', name: 'C1-Junioren', website_path: 'jugend/u15-c1' };
  const tableId='52d29828-708d-438f-be85-3c8b47a58b44', matchesId='af96d999-a7ba-432a-87c5-439ab401516d';
  const result = await editorialSportsSnapshot({ team, games: [], cutoff: '2026-09-26', now: new Date('2026-09-20T10:00Z'), parseFont: () => null,
    fetchImpl: async url => new Response(String(url).includes('/widget/table/') ? html({ competitionName: 'Liga', table: { entries: Array.from({length:12}, (_, i) => ({position:String(i+1),teamName:'Team '+i,matches:'3',goalRatio:'4:2',points:'6'})) } })
      : String(url).includes('/widget/team-matches/') ? html({ previousMatches:[fixture('last','acknowledged','19.09.2026')], nextMatches:[fixture('next','scheduled','26.09.2026')] })
      : `<div data-type="table" data-id="${tableId}"></div><div data-type="team-matches" data-id="${matchesId}"></div>`),
  });
  assert.equal(result.snapshot.table.rows.length, 12);
  assert.equal(result.snapshot.compact, true);
  assert.equal(result.snapshot.lastMatches[0].score, '0:0');
  assert.equal(result.snapshot.upcoming[0].date, '2026-09-26');
  assert.equal(result.snapshot.warning, '');
  assert.equal(result.snapshot.autoApprovalEligible, true);
  assert.equal(result.snapshot.generatedBody, result.body);
  assert.match(result.body, /^SPORT KOMPAKT/);
  assert.match(result.body, /LETZTE PARTIE/);
  assert.match(result.body, /NÄCHSTE SPIELE/);
  assert.equal(result.body, editorialSportsBody(team, result.snapshot));
});

test('successful adult sources approve automatically; failed fixture sources do not', async () => {
  const team={id:'men',slug:'herren-1',name:'Herren I',website_path:'fussball/herren/bezirksliga',active:true};
  for(const failed of [false,true]) {
    const result=await editorialSportsSnapshot({team,games:[],cutoff:'2026-09-26',parseFont:()=>null,
      fetchImpl:async url=>String(url).includes('/widget/team-matches/') && failed ? new Response('',{status:503}) : new Response(String(url).includes('/widget/table/')
        ? html({competitionName:'Liga',table:{entries:[{position:'1',teamName:'BSV',matches:'1',goalRatio:'2:0',points:'3'}]}})
        : String(url).includes('/widget/team-matches/') ? html({previousMatches:[],nextMatches:[]})
        : '<div data-type="table" data-id="52d29828-708d-438f-be85-3c8b47a58b44"></div><div data-type="team-matches" data-id="af96d999-a7ba-432a-87c5-439ab401516d"></div>')});
    assert.equal(result.snapshot.autoApprovalEligible,!failed);
    assert.equal(result.snapshot.compact,false);
    assert.doesNotMatch(result.body,/^SPORT KOMPAKT/);
  }
});
