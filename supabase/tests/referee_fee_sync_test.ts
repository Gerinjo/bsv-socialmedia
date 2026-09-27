import opentype from 'npm:opentype.js@1.3.4';
import { syncRefereeFees } from '../functions/_shared/referee-fee-sync.ts';
import { refereeYouthSources } from '../../src/referee-source.mjs';

const config = refereeYouthSources.find(row => row[0] === 'jugend/u13-d1')!;
const guest = 'G'.repeat(32), match = 'M'.repeat(32);
const font = new opentype.Font({familyName:'Fixture',styleName:'Regular',unitsPerEm:1000,ascender:800,descender:-200,glyphs:[new opentype.Glyph({name:'.notdef',advanceWidth:500,path:new opentype.Path()})]}).toArrayBuffer();
const page = (opponent = guest) => `<div class="stage-header"></div><div class="team-name"><a href="/team-id/${config[2]}">BSV</a></div><div class="team-name"><a href="/team-id/${opponent}">Guest</a></div><ul class="stage-meta-left"><li><span>Schiedsrichter:</span><span>Robin Test</span></li></ul>`;
const widget = `<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{obfuscatedFont:'fixture',nextMatches:[],previousMatches:[{id:match,status:'acknowledged',kickoff:{date:'26.09.2026',time:'15:00'},homeTeam:{teamPermanentId:config[2],name:'BSV'},guestTeam:{teamPermanentId:guest,name:'Guest'}}]}}})}</script>`;
function database() {
  const rows:any[]=[];
  return {rows,from:(name:string)=>name==='social_teams'?{select:()=>({eq:()=>({like:async()=>({data:[{id:'test',name:'D1',website_path:config[0]}]})})})}:{upsert:async(row:any)=>{rows.push(row);return {};}}};
}
function assert(condition:unknown,message:string) {if(!condition)throw new Error(message);}

Deno.test('fee sync follows canonical same-origin match redirect and confirms completed fixture', async()=>{
  const db=database(), urls:string[]=[];
  const fetcher:typeof fetch=async input=>{
    const url=String(input);urls.push(url);
    if(url.includes('/widget/'))return new Response(widget);
    if(url.includes('export.fontface'))return new Response(font);
    if(url.includes('/spiel/-/spiel/'))return new Response(null,{status:301,headers:{location:`https://www.fussball.de/spiel/bsv-guest/-/spiel/${match}`}});
    return new Response(page());
  };
  const summary=await syncRefereeFees(db,fetcher,new Date('2026-09-27T12:00:00Z'));
  assert(summary.assigned===1&&summary.issues.length===0,'Assigned match not recognized');
  assert(db.rows[0].game_status==='finished','Acknowledged game not finished');
  assert(urls.length===4,'Canonical redirect not followed');
});

Deno.test('foreign redirects and changed fixture identities stay unknown', async()=>{
  for(const response of [()=>new Response(null,{status:302,headers:{location:'https://other.invalid/receipt'}}),()=>new Response(page('X'.repeat(32)))]){
    const db=database();
    const fetcher:typeof fetch=async input=>{
      const url=String(input);
      if(url.includes('/widget/'))return new Response(widget);
      if(url.includes('export.fontface'))return new Response(font);
      assert(!url.includes('other.invalid'),'External redirect followed');
      return response();
    };
    const summary=await syncRefereeFees(db,fetcher,new Date('2026-09-27T12:00:00Z'));
    assert(summary.unknown===1&&db.rows[0].appointment_state==='unknown','Unknown source counted as appointment');
  }
});

Deno.test('unavailable widget does not refresh existing appointment evidence', async()=>{
  const db=database();
  const summary=await syncRefereeFees(db,async()=>new Response('',{status:503}),new Date('2026-09-27T12:00:00Z'));
  assert(db.rows.length===0&&summary.issues.length===1,'Failed source overwrote evidence');
});
