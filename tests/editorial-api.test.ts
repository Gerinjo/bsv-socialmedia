import assert from "node:assert/strict";
import { handleEditorial } from "../supabase/functions/social-media-admin-api/editorial.ts";

// Ordered query fake: also checks that updates use a version predicate.
function database(replies: any[]) {
  const calls: any[] = [];
  const db = {
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
              if (key === "update" || key === "insert") call[key] = args[0];
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
Deno.test(
  "final status changes do not rewrite or replace the original",
  async () => {
    const { db, calls } = database([
      issue,
      current,
      { ...current, status: "ready", version: 3 },
    ]);
    const result: any = await handleEditorial(db, "user", {
      ...request,
      body: "Alt",
      status: "ready",
    });
    assert.equal(result.rewritten, false);
    assert.equal(calls[2].update.original_body, "Original");
    assert.equal(calls[2].update.status, "ready");
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
