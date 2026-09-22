import assert from "node:assert/strict";
import { handleEditorial } from "../supabase/functions/social-media-admin-api/editorial.ts";
import { prepareEditorialPeople, withEditorialPeople } from '../supabase/functions/_shared/editorial-people.ts';

// Ordered query fake: also checks that updates use a version predicate.
function database(replies: any[]) {
  const calls: any[] = [];
  const db = {
    rpc(name: string, args: any) {
      calls.push({rpc:name,args});
      return Promise.resolve({data:replies.shift(),error:null});
    },
    from(table: string) {
      const call: any = { table, filters: [] };
      calls.push(call);
      const query: any = new Proxy(
        {},
        {
          get(_target, key) {
            if (key === "then")
              return (resolve: any) =>
                resolve({ data: replies.shift(), error: null });
            return (...args: any[]) => {
              if (key === "update" || key === "insert" || key === "upsert") call[key] = args[0];
              if (key === "delete") call.delete = true;
              if (key === "eq") call.filters.push(args);
              return query;
            };
          },
        },
      );
      return query;
    },
  };
  return { db, calls };
}
const issue = { id: "issue", kind: "stadium" };
const current = {
  id: "article",
  issue_id: "issue",
  version: 2,
  body: "Alt",
  original_body: "Original",
  kind: "free",
};
const request = {
  action: "editorial_save_article",
  id: "article",
  issueId: "issue",
  version: 2,
  title: "Bericht",
  body: "Neu",
  status: "draft",
};
Deno.test('waiver is an explicit versioned coach-only action that keeps text and can be reversed', async () => {
  const coach = {...current, kind:'coach', status:'ready'};
  const {db,calls}=database([coach,{...coach,status:'waived',version:3}]);
  await handleEditorial(db,'user',{action:'editorial_waive_article',id:coach.id,version:2,waived:true});
  assert.equal(calls[1].update.status,'waived');
  assert.equal(calls[1].update.body,undefined);
  assert.equal(calls[1].update.approved_at,null);
  assert.equal(calls[1].update.updated_by,'user');
  assert.ok(calls[1].filters.some(([key,value]:any[])=>key==='version' && value===2));
  for(const body of ['', 'Existing draft']) {
    const revoked=database([{...coach,status:'waived',body},{...coach,status:body?'review':'draft'}]);
    await handleEditorial(revoked.db,'user',{action:'editorial_waive_article',id:coach.id,version:2,waived:false});
    assert.equal(revoked.calls[1].update.status,body?'review':'draft');
  }
  for(const input of [{...coach,version:3},{...coach,kind:'sports'},{...coach,kind:'free'}]) {
    const denied=database([input]);
    await assert.rejects(handleEditorial(denied.db,'user',{action:'editorial_waive_article',id:coach.id,version:2,waived:true}));
    assert.ok(denied.calls.every(call=>!call.update));
  }
  const race=database([coach,null]);
  await assert.rejects(handleEditorial(race.db,'user',{action:'editorial_waive_article',id:coach.id,version:2,waived:true}),/geändert/);
  const approve=database([{...coach,status:'waived'}]);
  await assert.rejects(handleEditorial(approve.db,'user',{action:'editorial_approve_article',id:coach.id,version:2}),/Verzicht aufheben/);
  const edit=database([issue,{...coach,status:'waived'}]);
  await assert.rejects(handleEditorial(edit.db,'user',request),/Verzicht aufheben/);
  const bypass=database([issue,coach]);
  await assert.rejects(handleEditorial(bypass.db,'user',{...request,status:'waived'}),/Verzicht-Button/);
});
Deno.test('people are resolved from office/team assignments and client-supplied names or portraits are ignored', async () => {
  const board = { ...current, kind: 'board', title: 'Grußwort', author: '', department_id: null };
  const { db, calls } = database([issue, board,
    [{ id: 'chair', display_name: 'Vorstand', roles: ['1. Vorstand'], source_photo_url: null }], [],
    { ...board, version: 3 }]);
  await handleEditorial(db, 'user', { ...request, body: 'Alt', title: 'Grußwort', person_ids: ['chair'], author: 'Forged', people_snapshot: [{ photo_url: 'https://evil.example/' }] });
  assert.equal(calls[4].update.author, 'Vorstand');
  assert.deepEqual(calls[4].update.people_snapshot, [{person_id:'chair',name:'Vorstand',role:'1. Vorstand',source_photo_url:null,photo_path:null}]);
  assert.equal(calls[4].update.status, 'review');
  const invalid = database([issue, { ...current, kind:'coach', team_id:'first' },
    [{id:'wrong',display_name:'Falsches Team',roles:['Trainer']}], [{person_id:'wrong',team_id:'second',role:'Trainer'}]]);
  await assert.rejects(handleEditorial(invalid.db, 'user', {...request,person_ids:['wrong']}), /Funktion oder Mannschaft/);
  assert.ok(invalid.calls.every(call=>!call.update));
});
Deno.test('selected portraits are copied privately, reused on text edits and signed without exposing storage paths', async () => {
  const person={id:'chair',display_name:'Vorstand',roles:['1. Vorstand'],source_photo_url:'https://gerinjo.github.io/bsv-website/images/portrait.png'};
  const {db}=database([[person],[],[person],[]]);
  const uploads:any[]=[],removed:any[]=[];
  (db as any).storage={from(bucket:string){assert.equal(bucket,'editorial-portraits');return {
    upload:async(path:string,bytes:any)=>{uploads.push({path,bytes});return {error:null};},
    remove:async(paths:string[])=>{removed.push(...paths);return {error:null};},
    createSignedUrl:async(path:string)=>({data:{signedUrl:'https://example.org/signed/'+path},error:null}),
  };}};
  const previousFetch=globalThis.fetch;let fetches=0;
  globalThis.fetch=async(url,options)=>{fetches++;assert.equal(options?.redirect,'manual');if(String(url).startsWith('https://gerinjo.github.io/'))return new Response(null,{status:301,headers:{location:'https://bsvnordstern.de/images/portrait.png'}});return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),{headers:{'content-type':'image/png'}});};
  try {
    const first=await prepareEditorialPeople(db,'issue',{kind:'board'},['chair']);
    assert.equal(uploads.length,1);
    const second=await prepareEditorialPeople(db,'issue',{kind:'board',people_snapshot:first.people},['chair']);
    assert.equal(fetches,2);assert.equal(uploads.length,1);
    await second.cleanup();assert.equal(removed.length,0);
    const result=await withEditorialPeople(db,{articles:[{people:[{name:'Vorstand',role:'1. Vorstand',photo_path:first.people[0].photo_path}]}]});
    assert.ok(result.articles[0].people[0].photo_url);
    assert.equal(result.articles[0].people[0].photo_path,undefined);
    await first.cleanup();assert.equal(removed.length,1);
  } finally {globalThis.fetch=previousFetch;}
});
Deno.test('automatic youth sources cannot be edited or approved through manual article endpoints', async () => {
  const automatic = { ...current, automatic_sports: true, kind: 'sports' };
  const editing = database([issue, automatic]);
  await assert.rejects(handleEditorial(editing.db, 'user', request), /automatisch/);
  assert.ok(editing.calls.every(call => !call.update));
  const approval = database([automatic]);
  await assert.rejects(handleEditorial(approval.db, 'user', { action: 'editorial_approve_article', id: current.id, version: 2 }), /automatisch/);
  assert.ok(approval.calls.every(call => !call.update));
});
Deno.test('sport refresh adds missing A–D teams without overwriting existing articles', async () => {
  const { db, calls } = database([
    issue,
    [{ id: 'first', slug: 'herren-1', name: 'Herren', active: true }, { id: 'youth', name: 'C1-Junioren', active: false }],
    [{ team_id: 'first', template_key: 'sports:first' }],
    null,
    [{ team_id: 'first', body: 'Reviewed' }, { team_id: 'youth', body: '' }],
  ]);
  const result: any = await handleEditorial(db, 'user', { action: 'editorial_prepare_sports', issueId: 'issue' });
  assert.equal(calls[3].upsert.length, 1);
  assert.equal(calls[3].upsert[0].team_id, 'youth');
  assert.equal(calls[3].upsert[0].body, undefined);
  assert.equal(result.articles[0].body, 'Reviewed');
});
Deno.test('a team without a table can still refresh previously imported match results', async () => {
  const old = { ...current, kind: 'sports', team_id: 'd3', source_snapshot: { table: null, lastMatches: [{ score: '0:0' }] } };
  const { db, calls } = database([old, { publishes_on: '2026-09-27' }, { id: 'd3', name: 'D3-Junioren', website_path: 'jugend/u13-d3' }, [], [], { ...old, version: 3 }]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any) => new Response(String(url).includes('/widget/')
    ? '<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { nextMatches: [], previousMatches: [{ id: 'match', status: 'acknowledged', kickoff: { date: '01.01.2026', time: '14:00' }, homeTeam: { name: 'BSV' }, guestTeam: { name: 'Gast' }, result: { homeResult: '2', guestResult: '0' } }] } } }) + '</script>'
    : '<div data-type="team-matches" data-id="af96d999-a7ba-432a-87c5-439ab401516d"></div>');
  try {
    await handleEditorial(db, 'user', { action: 'editorial_sports', id: 'article', version: 2 });
    assert.equal(calls[5].update.source_snapshot.lastMatches[0].score, '2:0');
    assert.equal(calls[5].update.status, 'ready');
    assert.equal(calls[5].update.automatic_sports, true);
  } finally { globalThis.fetch = originalFetch; }
});
Deno.test("a saved cover survives a temporary signed URL failure", async () => {
  const { db } = database([
    { ...issue, version: 1 },
    { ...issue, version: 2, cover_path: "issue/saved.png" },
  ]);
  let removed = false;
  Object.assign(db, {
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        createSignedUrl: async () => ({ error: new Error("Signing unavailable") }),
        remove: async () => { removed = true; return { error: null }; },
      }),
    },
  });
  await assert.rejects(handleEditorial(db, "user", {
    action: "editorial_cover",
    issueId: issue.id,
    version: 1,
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  }), /Signing unavailable/);
  assert.equal(removed, false);
});
Deno.test("saving a stale article fails before any write", async () => {
  const { db, calls } = database([issue, current]);
  await assert.rejects(
    handleEditorial(db, "user", { ...request, version: 1 }),
    /zwischenzeitlich/,
  );
  assert.ok(calls.every((call) => !call.update));
});
Deno.test(
  "AI outage retains the raw saved text and original, and reports a warning",
  async () => {
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.delete("EDITORIAL_AI_MODEL");
    const saved = { ...current, version: 3, body: "Neu", original_body: "Neu" };
    const { db, calls } = database([issue, current, saved]);
    const result: any = await handleEditorial(db, "user", request);
    assert.equal(result.article.body, "Neu");
    assert.match(result.warning, /gespeichert/);
    assert.equal(calls[2].update.original_body, "Neu");
    assert.equal(calls[2].update.status, "review");
    assert.ok(
      calls[2].filters.some(
        ([key, value]: any[]) => key === "version" && value === 2,
      ),
    );
  },
);
Deno.test("save cannot bypass the explicit approval action", async () => {
  const { db, calls } = database([issue, current]);
  await assert.rejects(
    handleEditorial(db, "user", { ...request, body: "Alt", status: "ready" }),
    /Freigabe-Button/,
  );
  assert.ok(calls.every((call) => !call.update));
});
Deno.test(
  "explicit approval checks the saved version and preserves the text",
  async () => {
    const { db, calls } = database([
      current,
      { ...current, status: "ready", version: 3 },
    ]);
    const result: any = await handleEditorial(db, "user", {
      action: "editorial_approve_article",
      id: "article",
      version: 2,
    });
    assert.equal(result.article.status, "ready");
    assert.equal(calls[1].update.status, "ready");
    assert.equal(calls[1].update.approved_by, "user");
    assert.equal(calls[1].update.body, undefined);
    assert.ok(
      calls[1].filters.some(
        ([key, value]: any[]) => key === "version" && value === 2,
      ),
    );
  },
);
Deno.test("an empty contribution cannot be marked ready", async () => {
  const { db, calls } = database([issue, current]);
  await assert.rejects(
    handleEditorial(db, "user", { ...request, body: " ", status: "ready" }),
    /leer/,
  );
  assert.ok(calls.every((call) => !call.update));
});
Deno.test(
  "a race after loading an article is rejected by the conditional write",
  async () => {
    const { db } = database([issue, current, null]);
    await assert.rejects(
      handleEditorial(db, "user", request),
      /zwischenzeitlich/,
    );
  },
);

Deno.test("a later author edit survives a slow AI response", async () => {
  const saved = { ...current, version: 3, body: "Neu", original_body: "Neu" };
  const newer = { ...saved, version: 4, body: "Neuere redaktionelle Änderung" };
  const { db, calls } = database([issue, current, saved, null, newer]);
  const originalFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", "test");
  Deno.env.set("EDITORIAL_AI_MODEL", "test-model");
  globalThis.fetch = async () =>
    Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "KI-Fassung" }],
        },
      ],
    });
  try {
    const result: any = await handleEditorial(db, "user", request);
    assert.equal(result.article.body, newer.body);
    assert.match(result.warning, /neuere Änderung/);
    assert.ok(
      calls[3].filters.some(
        ([key, value]: any[]) => key === "version" && value === 3,
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.delete("EDITORIAL_AI_MODEL");
  }
});
Deno.test('gallery uploads are rolled back when the article version changes before saving', async()=>{
 const {db}=database([issue,current,null]);const uploaded:string[]=[],removed:string[]=[];
 (db as any).storage={from(bucket:string){assert.equal(bucket,'editorial-galleries');return {
  upload:async(path:string)=>{uploaded.push(path);return {error:null};},remove:async(paths:string[])=>{removed.push(...paths);return {error:null};},
 };}};
 await assert.rejects(handleEditorial(db,'user',{...request,gallery_groups:[{id:'group',title:'Galerie',cover_id:'image',images:[{id:'image',alt:'Bild',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII='}]}]}),/geändert/);
 assert.equal(uploaded.length,1);assert.deepEqual(removed,uploaded);
});

Deno.test('deleting further articles protects fixed rubrics, checks versions and retains published assets', async () => {
  for (const kind of ['free', 'event', 'coach']) {
    const article = {...current, kind, team_id: kind === 'coach' ? 'youth-team' : null};
    const {db,calls} = database([article, ...(kind === 'coach' ? [{slug:'b-jugend'}] : []), {id:article.id}]);
    assert.deepEqual(await handleEditorial(db,'user',{action:'editorial_delete_article',id:article.id,version:2}), {removed:true});
    const deletion = calls.find(call=>call.delete);
    assert.deepEqual(deletion.filters, [['id',article.id],['version',2],['kind',kind]]);
    assert.ok(calls.every(call=>['editorial_articles','social_teams'].includes(call.table)));
  }
  for (const article of [{...current,kind:'board'}, {...current,kind:'youth'}, {...current,kind:'sports'}, {...current,automatic_sports:true}, ...['herren-1','herren-2','frauen-1','frauen-2'].map(slug=>({...current,kind:'coach',team_id:slug}))]) {
    const denied = database([article, {slug:'team_id' in article ? article.team_id : null}]);
    await assert.rejects(handleEditorial(denied.db,'user',{action:'editorial_delete_article',id:article.id,version:2}), /Nur weitere Beiträge/);
    assert.ok(denied.calls.every(call=>!call.delete));
  }
  const stale=database([{...current,version:3}]);
  await assert.rejects(handleEditorial(stale.db,'user',{action:'editorial_delete_article',id:current.id,version:2}),/geändert/);
  assert.ok(stale.calls.every(call=>!call.delete));
  const race=database([current,null]);
  await assert.rejects(handleEditorial(race.db,'user',{action:'editorial_delete_article',id:current.id,version:2}),/geändert/);
});

Deno.test('cover configuration is versioned and rejects references outside this issue or active teams',async()=>{
 const {editorialCoverDefaults}=await import('../src/editorial-publication.mjs');
 const settings={...editorialCoverDefaults({...issue,title:'Heft',publishes_on:'2026-09-27'},[]),articles:[{id:'article',alias:'Teaser'}],teamSlugs:['herren-1']};
 const request={action:'editorial_save_cover_settings',issueId:'issue',version:2,settings};
 const entries=[{id:'article',kind:'free'}],teams=[{slug:'herren-1'}];
 const success=database([{...issue,version:2},entries,teams,{...issue,version:3,cover_settings:settings}]);
 await handleEditorial(success.db,'user',request);
 assert.deepEqual(success.calls[3].update,{cover_settings:settings});assert.deepEqual(success.calls[3].filters,[['id','issue'],['version',2]]);
 for(const [articles,allowedTeams] of [[[],teams],[[{id:'article',kind:'sports'}],teams],[entries,[]]]){
  const denied=database([{...issue,version:2},articles,allowedTeams]);
  await assert.rejects(handleEditorial(denied.db,'user',request),/nicht verfügbare/);assert.ok(denied.calls.every(call=>!call.update));
 }
 const stale=database([{...issue,version:3}]);await assert.rejects(handleEditorial(stale.db,'user',request),/geändert/);assert.ok(stale.calls.every(call=>!call.update));
 const race=database([{...issue,version:2},entries,teams,null]);await assert.rejects(handleEditorial(race.db,'user',request),/geändert/);
});

Deno.test('existing cover metadata can be saved without uploading or replacing the image',async()=>{
 const original={...issue,title:'Heft',version:2,cover_path:'issue/original.jpg'};
 const request={action:'editorial_cover',issueId:issue.id,version:2,alt:'Neue Bildbeschreibung',credit:'Foto: Verein'};
 const saved={...original,version:3,cover_alt:request.alt,cover_credit:request.credit};
 const {db,calls}=database([original,saved]);
 Object.assign(db,{storage:{from:()=>({createSignedUrl:async(path:string)=>{assert.equal(path,original.cover_path);return {data:{signedUrl:'https://example.org/original.jpg'},error:null};}})}});
 const result=await handleEditorial(db,'user',request);
 assert.ok(result && 'issue' in result && result.issue);
 assert.equal(result.issue.cover_path,original.cover_path);assert.equal(result.issue.cover_alt,request.alt);
 assert.deepEqual(calls[1].update,{cover_alt:request.alt,cover_credit:request.credit});assert.deepEqual(calls[1].filters,[['id',issue.id],['version',2]]);
 for (const value of [{...original,version:3},{...original,cover_path:null}]){
   const denied=database([value]);await assert.rejects(handleEditorial(denied.db,'user',request));assert.ok(denied.calls.every(call=>!call.update));
 }
 const long=database([original]);await assert.rejects(handleEditorial(long.db,'user',{...request,alt:'x'.repeat(301)}),/300 Zeichen/);assert.ok(long.calls.every(call=>!call.update));
 const race=database([original,null]);await assert.rejects(handleEditorial(race.db,'user',request),/geändert/);
});

Deno.test('saving cover defaults validates selections and atomically saves with version and actor', async () => {
 const settings={showNumber:true,number:'07',showNamePart1:true,namePart1:'VEREIN',showNamePart2:true,namePart2:'news.',showHeadline:true,headline:'Heimspiel',showDate:true,articles:[{id:'article',alias:'Vorstand'}],teamSlugs:['herren-1']};
 const currentIssue={...issue,version:5};
 const {db,calls}=database([currentIssue,[{id:'article',kind:'board'}],[{slug:'herren-1'}],{...currentIssue,version:6,cover_settings:settings}]);
 const result=await handleEditorial(db,'actor',{action:'editorial_save_cover_defaults',issueId:'issue',version:5,settings});
 assert.ok(result && 'issue' in result);
 assert.equal(result.issue.version,6);
 assert.deepEqual(calls[3],{rpc:'save_editorial_cover_defaults',args:{target:'issue',expected_version:5,settings,actor:'actor'}});
 for(const invalid of [{...currentIssue,version:6},{...currentIssue,kind:'newsletter'}]) {
  const fake=database([invalid]);
  await assert.rejects(()=>handleEditorial(fake.db,'actor',{action:'editorial_save_cover_defaults',issueId:'issue',version:5,settings}));
  assert.equal(fake.calls.length,1);
 }
 const foreign=database([currentIssue,[],[{slug:'herren-1'}]]);
 await assert.rejects(()=>handleEditorial(foreign.db,'actor',{action:'editorial_save_cover_defaults',issueId:'issue',version:5,settings}));
 assert.equal(foreign.calls.some(call=>call.rpc),false);
});

Deno.test('editorial list and issue creation include disabled second adult teams without youth greetings',async()=>{
 const teams=[{id:'second-men',slug:'herren-2',name:'Zweite Herren',active:false},{id:'second-women',slug:'frauen-2',name:'Zweite Frauen',active:false},{id:'young',slug:'u15-junioren',name:'C-Jugend',active:false}];
 const listing=database([[],teams,[],[],[]]);
 const listed:any=await handleEditorial(listing.db,'actor',{action:'editorial_list'});
 assert.equal(listed.teams[0].active,true);assert.equal(listed.teams[1].active,true);assert.equal(teams[0].active,false);
 const creation=database([teams,{id:'new'}]);
 await handleEditorial(creation.db,'actor',{action:'editorial_save_issue',kind:'stadium',title:'Neu',starts_on:'2026-09-22',closes_on:'2026-09-23',publishes_on:'2026-09-27'});
 assert.deepEqual(creation.calls[1].args.articles.filter((a:any)=>a.kind==='coach').map((a:any)=>a.team_id),['second-men','second-women']);
 assert.equal(creation.calls[1].args.articles.filter((a:any)=>a.kind==='sports').length,3);
 const settings={showNumber:true,number:'01',showNamePart1:true,namePart1:'Verein',showNamePart2:true,namePart2:'News',showHeadline:true,headline:'Heft',showDate:true,articles:[],teamSlugs:['herren-2','frauen-2']};
 const cover=database([{...issue,version:1},[],teams,{...issue,version:2}]);
 await handleEditorial(cover.db,'actor',{action:'editorial_save_cover_settings',issueId:'issue',version:1,settings});
 assert.deepEqual(cover.calls[3].update.cover_settings.teamSlugs,['herren-2','frauen-2']);
});
