import assert from 'node:assert/strict';
import opentype from 'npm:opentype.js@1.3.4';
import api from '../supabase/functions/social-media-admin-api/index.ts';
import {setResourceApiContext} from './support/resource-api-auth.ts';

function setup(areas = ['resources'], home = false) {
  const calls: any[] = [];
  const membership = {role:'sm-team',is_active:true,is_blocked:false,access_areas:areas};
  const query: any = {select:()=>query,eq:()=>query,maybeSingle:async()=>({data:membership})};
  setResourceApiContext({userClaims:{sub:'test-trainer'},supabaseAdmin:{
    from:()=>query,
    rpc:async (name: string, {payload}: any) => {
      assert.equal(name,'resource_request'); calls.push(payload);
      if(payload.action==='list') return {data:{resources:[{id:'bus'}],matches:[],bookings:[],teams:[]}};
      if(payload.action==='_match') return {data:{match:{is_home:home}}};
      if(payload.action==='_teams') return {data:{teams:[{id:'team',slug:'u13-d1-junioren',name:'D1',fussball_de_widget_id:'11111111-1111-1111-1111-111111111111',fussball_de_team_id:'BSV'}]}};
      return {data:{ok:true}};
    },
  }});
  return calls;
}
const post = (action: string, body = {}) => api.fetch(new Request('https://example.test/admin',{method:'POST',body:JSON.stringify({action,month:'2026-11',...body})}));

Deno.test('actual admin API entrypoint loads the bus calendar with its production dependencies', async () => {
  const calls=setup(); const response=await post('resource_list'); const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));
  assert.deepEqual(body.resources,[{id:'bus'}]); assert.equal(calls.at(-1).action,'list');
});

Deno.test('actual admin API supplies a working font parser when synchronizing games', async () => {
  const calls=setup(); const previousFetch=globalThis.fetch;
  const font=new opentype.Font({familyName:'Fixture',styleName:'Regular',unitsPerEm:1000,ascender:800,descender:-200,glyphs:[new opentype.Glyph({name:'.notdef',advanceWidth:500,path:new opentype.Path()})]}).toArrayBuffer();
  globalThis.fetch=async (url: any) => {
    if(String(url).includes('/export.fontface/'))return new Response(font);
    assert.ok(String(url).startsWith('https://next.fussball.de/widget/team-matches/'));
    const pageProps={obfuscatedFont:'fixture',nextMatches:[{id:'game',status:'scheduled',kickoff:{dateWithWeekday:'Sonntag, 01.11.2026',time:'14:00'},homeTeam:{name:'BSV',teamPermanentId:'BSV'},guestTeam:{name:'Gast',teamPermanentId:'GUEST'}}]};
    return new Response('<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps}})+'</script>');
  };
  try {
    const response=await post('resource_sync');const body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body));assert.deepEqual(body.warnings,[]);
    assert.equal(body.fetched[0].count,1);assert.equal(calls.find(c=>c.action==='_sync').matches[0].matchMinutes,70);
  } finally {globalThis.fetch=previousFetch;}
});

Deno.test('actual admin API rejects resources access before calling the database RPC', async () => {
  const calls=setup([]);const response=await post('resource_list');
  assert.equal(response.status,403);assert.equal((await response.json()).error,'area_forbidden');assert.deepEqual(calls,[]);
});

Deno.test('actual admin API blocks home bookings and stores the detailed away-game plan', async () => {
  const body={teamId:'team',resourceId:'bus',matchId:'game',expectedKickoff:'2027-01-01T15:00:00Z',startsAt:'2027-01-01T13:15:00Z',endsAt:'2027-01-01T18:20:00Z',timing:{travelMinutes:30,returnMinutes:30}};
  const rejected=setup(['resources'],true);let response=await post('resource_book',body);
  assert.equal(response.status,409);assert.match((await response.json()).error,/Heimspiele/);assert.ok(!rejected.some(p=>p.action==='book'));
  const allowed=setup();response=await post('resource_book',body);
  assert.equal(response.status,200,JSON.stringify(await response.json()));
  const saved=allowed.find(p=>p.action==='book');assert.equal(saved.planning.startsAt,'2027-01-01T13:15:00.000Z');assert.equal(saved.planning.endsAt,'2027-01-01T18:20:00.000Z');assert.equal(saved.planning.events.length,10);
});
