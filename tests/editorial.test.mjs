import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeEditorialIssue,
  editorialSeeds,
  editorialCalendarDays,
  editorialMilestones,
  editorialResults,
  rewriteEditorialText,
} from "../src/editorial.mjs";
import {
  discoverTableWidget,
  parseEditorialTable,
  editorialSportsSnapshot,
} from "../src/editorial-sports.mjs";

const issue = {
  title: "Heimspiel",
  kind: "stadium",
  starts_on: "2026-09-20",
  closes_on: "2026-09-24",
  publishes_on: "2026-09-27",
};
test("issue dates reject impossible dates and inverted deadlines", () => {
  assert.deepEqual(normalizeEditorialIssue(issue), issue);
  for (const patch of [
    { starts_on: "2026-02-30" },
    { closes_on: "2026-09-19" },
    { publishes_on: "2026-09-23" },
    { kind: "other" },
    { title: " " },
  ])
    assert.throws(() => normalizeEditorialIssue({ ...issue, ...patch }));
});
test("magazines receive all mandatory contributions, newsletters start freely", () => {
  const teams = [
    { id: "first", slug:"herren-1", name: "Erste" },
    { id: "youth", slug:"u15-junioren", name: "Jugend" },
    { id: "old", name: "Passiv", active: false },
  ];
  const seeds = editorialSeeds("stadium", teams);
  assert.equal(seeds.length, 5);
  assert.equal(new Set(seeds.map((a) => a.template_key)).size, 5);
  assert.deepEqual(
    seeds.filter((a) => a.kind === "sports").map((a) => a.team_id),
    ["first", "youth"],
  );
  assert.deepEqual(editorialSeeds("newsletter", teams), []);
});
test("calendar crosses month and year boundaries, includes all same-day milestones", () => {
  const days = editorialCalendarDays("2026-12");
  assert.equal(days.length, 42);
  assert.equal(days[0], "2026-11-30");
  assert.equal(days[41], "2027-01-10");
  assert.equal(
    editorialMilestones(
      { ...issue, closes_on: issue.starts_on, publishes_on: issue.starts_on },
      issue.starts_on,
    ).length,
    3,
  );
});
test("results preserve zero scores, exclude unplayed games and future results", () => {
  const game = {
    team_id: "team",
    status: "finished",
    kickoff_at: "2026-09-20T13:00:00Z",
    home_team: "BSV",
    away_team: "Gast",
    home_score: 0,
    away_score: 0,
  };
  const result = editorialResults(
    [
      game,
      { ...game, team_id: "other" },
      { ...game, home_score: null },
      { ...game, status: "cancelled" },
      { ...game, kickoff_at: "2026-10-01T13:00:00Z" },
    ],
    "team",
    "2026-09-27",
  );
  assert.match(result, /BSV – Gast 0:0/);
  assert.equal(result.split("\n").length, 1);
});
test("Groq rewrite sends raw text as data and accepts only the finished answer", async () => {
  let request;
  const result = await rewriteEditorialText({
    text: "wir haben 0:0 gespielt",
    title: "Bericht",
    kind: "stadium",
    apiKey: "test",
    model: "configured-model",
    fetchImpl: async (url, options) => {
      request = JSON.parse(options.body);
      assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, 'Bearer test');
      return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'Wir haben 0:0 gespielt.',reasoning:'PRIVATE REASONING'}}]});
    },
  });
  assert.equal(result, "Wir haben 0:0 gespielt.");
  assert.equal(request.stream, false);
  assert.equal(request.store, undefined);
  assert.ok(request.max_completion_tokens >= 4096);
  assert.equal(JSON.parse(request.messages[1].content).text, "wir haben 0:0 gespielt");
  assert.match(request.messages[0].content, /Erfinde niemals/);
});
test("incomplete or failed AI output never becomes a saved replacement", async () => {
  for (const payload of [
    {choices:[{finish_reason:'length',message:{content:'Abgeschnitten'}}]},
    {choices:[{finish_reason:'stop',message:{content:''}}]},
    {choices:[{finish_reason:'stop',message:{content:'Ablehnung',refusal:'refused'}}]},
    {choices:[{finish_reason:'tool_calls',message:{content:'Keine Fassung',tool_calls:[{}]}}]},
    {choices:[{finish_reason:'stop',message:{content:'x'.repeat(30001)}}]},
    {choices:[]}, null,
  ]) {
    await assert.rejects(
      rewriteEditorialText({
        text: "Test",
        apiKey: "test",
        model: "model",
        fetchImpl: async () => Response.json(payload),
      }),
      /vollständige/,
    );
  }
  await assert.rejects(rewriteEditorialText({ text: "Test" }), /eingerichtet/);
});
test("table discovery and parsing preserve the official rankings without deriving them from club results", () => {
  assert.equal(
    discoverTableWidget(
      '<div data-id="52d29828-708d-438f-be85-3c8b47a58b44" data-type="table"></div>',
    ),
    "52d29828-708d-438f-be85-3c8b47a58b44",
  );
  assert.equal(
    discoverTableWidget('<div data-type="team-matches"></div>'),
    null,
  );
  const html =
    '<script id="__NEXT_DATA__">' +
    JSON.stringify({
      props: {
        pageProps: {
          competitionName: "Liga",
          table: {
            entries: [
              {
                position: "4",
                teamName: "BSV",
                matches: "3",
                goalRatio: "7:4",
                points: "6",
              },
            ],
          },
        },
      },
    }) +
    "</script>";
  assert.equal(parseEditorialTable(html, () => null).rows[0].position, "4");
  assert.throws(() => parseEditorialTable("unavailable", () => null));
});
test("missing or unsafe table sources remain explicit and cannot cause arbitrary fetches", async () => {
  let calls = 0;
  const result = await editorialSportsSnapshot({
    team: {
      id: "1",
      name: "Jugend",
      website_path: "https://internal.invalid/secret",
    },
    games: [],
    cutoff: "2026-09-27",
    parseFont: () => null,
    fetchImpl: async () => {
      calls++;
      throw Error("unexpected");
    },
  });
  assert.equal(calls, 0);
  assert.match(result.snapshot.warning, /Ungültige/);
  assert.equal(result.snapshot.table, null);
  assert.match(result.body, /Keine abgeschlossenen Ergebnisse/);
});

test('rewriting retains raw input but returns paragraphs without hard wrapping',async()=>{
 const original='wir freuen uns das ihr\r\nheute da seit\n\n\nund danke';
 let sent;
 const result=await rewriteEditorialText({text:original,title:'Grußwort',kind:'stadium',apiKey:'test',model:'configured-model',fetchImpl:async(_url,options)=>{
  sent=JSON.parse(options.body);
  return Response.json({choices:[{finish_reason:'stop',message:{content:'Wir freuen uns, dass ihr\r\nheute da seid.\r\n\r\n \r\nVielen   Dank!'}}]});
 }});
 assert.equal(JSON.parse(sent.messages[1].content).text,original);
 assert.equal(result,'Wir freuen uns, dass ihr heute da seid.\n\nVielen Dank!');
 assert.match(sent.messages[0].content,/vollständig neu/);assert.match(sent.messages[0].content,/sinnvolle Absätze/);
});

test('rewrite distinguishes exhausted API quota from temporary throttling',async()=>{
 for(const [code,expected]of [['insufficient_quota',/API-Guthaben/],['credit_balance_exhausted',/API-Guthaben/],['rate_limit_exceeded',/in Kürze/]]){
  await assert.rejects(()=>rewriteEditorialText({text:'Test',apiKey:'test',model:'configured-model',fetchImpl:async()=>Response.json({error:{code,message:'Provider detail is not exposed'}},{status:429})}),expected);
 }
});

test('Groq transport and authentication failures are actionable and never expose provider details',async()=>{
 for(const [status,pattern] of [[401,/API-Schlüssel/],[403,/Modellberechtigung/],[404,/Modelleinstellung/],[500,/HTTP 500/]]){
  await assert.rejects(rewriteEditorialText({text:'Privater Beitrag',apiKey:'PRIVATE KEY',model:'model',fetchImpl:async()=>Response.json({error:{message:'PRIVATE DETAIL'}},{status})}),error=>pattern.test(error.message)&&!/PRIVATE/.test(error.message));
 }
 for(const [name,pattern]of [['TimeoutError',/nicht rechtzeitig/],['TypeError',/nicht erreichbar/]]){
  await assert.rejects(rewriteEditorialText({text:'Text',apiKey:'test',model:'model',fetchImpl:async()=>{const error=new Error('PRIVATE DETAIL');error.name=name;throw error;}}),pattern);
 }
 await assert.rejects(rewriteEditorialText({text:'Text',apiKey:'test',model:'model',fetchImpl:async()=>new Response('not json')}),/vollständige/);
});
test('Groq GPT OSS requests keep reasoning out of the returned article and limit generation',async()=>{
 let request;
 await rewriteEditorialText({text:'Ein Text',apiKey:'test',model:'openai/gpt-oss-120b',fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return Response.json({choices:[{finish_reason:'stop',message:{content:'Ein Text.',reasoning:'Never publish this'}}]});}});
 assert.equal(request.reasoning_effort,'low');assert.equal(request.include_reasoning,false);
 assert.ok(request.max_completion_tokens>=4096&&request.max_completion_tokens<=20000);
 assert.equal(request.messages[0].role,'system');assert.equal(request.messages[1].role,'user');
});
