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
    { id: "first", name: "Erste" },
    { id: "youth", name: "Jugend" },
    { id: "old", name: "Passiv", active: false },
  ];
  const seeds = editorialSeeds("stadium", teams);
  assert.equal(seeds.length, 6);
  assert.equal(new Set(seeds.map((a) => a.template_key)).size, 6);
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
test("rewrite sends private text as data, disables storage and handles non-text outputs", async () => {
  let request;
  const result = await rewriteEditorialText({
    text: "wir haben 0:0 gespielt",
    title: "Bericht",
    kind: "stadium",
    apiKey: "test",
    model: "configured-model",
    fetchImpl: async (url, options) => {
      request = JSON.parse(options.body);
      assert.equal(url, "https://api.openai.com/v1/responses");
      return Response.json({
        status: "completed",
        output: [
          { type: "reasoning" },
          {
            type: "message",
            content: [{ type: "output_text", text: "Wir haben 0:0 gespielt." }],
          },
        ],
      });
    },
  });
  assert.equal(result, "Wir haben 0:0 gespielt.");
  assert.equal(request.store, false);
  assert.equal(JSON.parse(request.input).text, "wir haben 0:0 gespielt");
  assert.match(request.instructions, /Erfinde niemals/);
});
test("incomplete or failed AI output never becomes a saved replacement", async () => {
  for (const payload of [
    {
      status: "incomplete",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Abgeschnitten" }],
        },
      ],
    },
    { status: "completed", output: [] },
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
