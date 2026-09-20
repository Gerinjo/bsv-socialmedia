import opentype from "npm:opentype.js@1.3.4";
import {
  ARTICLE_STATUSES,
  editorialSeeds,
  normalizeEditorialIssue,
  rewriteEditorialText,
} from "../../../src/editorial.mjs";
import { editorialSportsSnapshot } from "../../../src/editorial-sports.mjs";

const fail = (message: string) => {
  throw new Error(message);
};
async function row(query: any) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
function title(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 180)
    fail("Bitte einen Titel mit 1 bis 180 Zeichen angeben.");
  return text;
}
function text(value: unknown) {
  const result = String(value ?? "");
  if (result.length > 30000)
    fail("Der Text darf höchstens 30.000 Zeichen enthalten.");
  return result;
}
const changed = () =>
  fail(
    "Der Beitrag wurde zwischenzeitlich geändert. Bitte neu öffnen; deine Eingabe bleibt im Editor erhalten.",
  );
const departments = [
  "club",
  "all_departments",
  "football_department",
  "youth_department",
  "department",
];

export async function handleEditorial(db: any, userId: string, body: any) {
  const action = body.action;
  if (action === "editorial_list") {
    const [issues, teams, audiences] = await Promise.all([
      row(
        db
          .from("editorial_issues")
          .select("*")
          .order("publishes_on", { ascending: false }),
      ),
      row(
        db
          .from("social_teams")
          .select("id,name,active,sort_order")
          .eq("active", true)
          .order("sort_order"),
      ),
      row(
        db
          .from("social_post_audiences")
          .select("id,label,audience_group")
          .eq("active", true)
          .in("audience_group", departments)
          .order("sort_order"),
      ),
    ]);
    return {
      issues,
      teams,
      departments: audiences,
      rewriteAvailable: Boolean(
        Deno.env.get("OPENAI_API_KEY") && Deno.env.get("EDITORIAL_AI_MODEL"),
      ),
    };
  }
  if (action === "editorial_save_issue") {
    const issue = normalizeEditorialIssue(body);
    if (!body.id) {
      const teams = await row(
        db
          .from("social_teams")
          .select("id,name,active")
          .eq("active", true)
          .order("sort_order"),
      );
      const created = await row(
        db.rpc("create_editorial_issue", {
          issue,
          articles: editorialSeeds(issue.kind, teams),
          actor: userId,
        }),
      );
      return { issue: created };
    }
    const current = await row(
      db.from("editorial_issues").select("*").eq("id", body.id).single(),
    );
    if (current.kind !== issue.kind)
      fail("Die Ausgabeart kann nach dem Anlegen nicht geändert werden.");
    const saved = await row(
      db
        .from("editorial_issues")
        .update(issue)
        .eq("id", body.id)
        .eq("version", body.version)
        .select()
        .maybeSingle(),
    );
    if (!saved) changed();
    return { issue: saved };
  }
  if (action === "editorial_articles")
    return {
      articles: await row(
        db
          .from("editorial_articles")
          .select("*")
          .eq("issue_id", body.issueId)
          .order("position")
          .order("created_at"),
      ),
    };
  if (action === "editorial_save_article") {
    const issue = await row(
      db.from("editorial_issues").select("*").eq("id", body.issueId).single(),
    );
    const current = body.id
      ? await row(
          db
            .from("editorial_articles")
            .select("*")
            .eq("id", body.id)
            .eq("issue_id", issue.id)
            .single(),
        )
      : null;
    if (current && current.version !== body.version) changed();
    if (body.department_id)
      await row(
        db
          .from("social_post_audiences")
          .select("id")
          .eq("id", body.department_id)
          .eq("active", true)
          .in("audience_group", departments)
          .single(),
      );
    const status = ARTICLE_STATUSES.includes(body.status)
      ? body.status
      : fail("Unbekannter Bearbeitungsstatus.");
    const content = text(body.body),
      author = String(body.author ?? "").trim();
    if (author.length > 180) fail("Der Autorenname ist zu lang.");
    if (status === "ready" && !content.trim())
      fail("Ein leerer Beitrag kann nicht als fertig markiert werden.");
    const contentChanged = !current || content !== current.body;
    const needsRewrite =
      (current?.kind ?? "free") !== "sports" &&
      (contentChanged || body.rewrite === true) &&
      Boolean(content.trim());
    const payload = {
      title: title(body.title),
      body: content,
      original_body: contentChanged ? content : current.original_body,
      department_id: body.department_id || null,
      author,
      status: needsRewrite ? "review" : status,
      updated_by: userId,
    };
    let article = await row(
      current
        ? db
            .from("editorial_articles")
            .update(payload)
            .eq("id", current.id)
            .eq("version", body.version)
            .select()
            .maybeSingle()
        : db
            .from("editorial_articles")
            .insert({
              ...payload,
              issue_id: issue.id,
              kind: "free",
              position: 1000,
            })
            .select()
            .single(),
    );
    if (!article) changed();
    let warning = "";
    if (needsRewrite) {
      try {
        const revised = await rewriteEditorialText({
          text: content,
          title: article.title,
          kind: issue.kind,
          apiKey: Deno.env.get("OPENAI_API_KEY"),
          model: Deno.env.get("EDITORIAL_AI_MODEL"),
        });
        const updated = await row(
          db
            .from("editorial_articles")
            .update({ body: revised, status: "review", updated_by: userId })
            .eq("id", article.id)
            .eq("version", article.version)
            .select()
            .maybeSingle(),
        );
        if (!updated) {
          warning =
            "Original gespeichert; eine neuere Änderung wurde nicht durch die KI überschrieben.";
          article = await row(
            db
              .from("editorial_articles")
              .select("*")
              .eq("id", article.id)
              .single(),
          );
        } else article = updated;
      } catch (error) {
        warning = `Text gespeichert. ${error instanceof Error ? error.message : "Überarbeitung fehlgeschlagen."}`;
      }
    }
    return { article, warning, rewritten: needsRewrite && !warning };
  }
  if (action === "editorial_revisions")
    return {
      revisions: await row(
        db
          .from("editorial_article_revisions")
          .select("version,snapshot,created_at")
          .eq("article_id", body.id)
          .order("version", { ascending: false })
          .limit(30),
      ),
    };
  if (action === "editorial_sports") {
    const article = await row(
      db
        .from("editorial_articles")
        .select("*")
        .eq("id", body.id)
        .eq("kind", "sports")
        .single(),
    );
    if (article.version !== body.version) changed();
    const issue = await row(
      db
        .from("editorial_issues")
        .select("publishes_on")
        .eq("id", article.issue_id)
        .single(),
    );
    const team = await row(
      db.from("social_teams").select("*").eq("id", article.team_id).single(),
    );
    const games = await row(
      db
        .from("social_games")
        .select(
          "team_id,status,kickoff_at,home_team,away_team,home_score,away_score",
        )
        .eq("team_id", team.id)
        .eq("status", "finished")
        .lte("kickoff_at", `${issue.publishes_on}T23:59:59Z`)
        .order("kickoff_at", { ascending: false })
        .limit(30),
    );
    const { body: content, snapshot } = await editorialSportsSnapshot({
      team,
      games,
      cutoff: issue.publishes_on,
      parseFont: opentype.parse,
    });
    // Keep the last good source intact if the upstream table fails.
    if (snapshot.warning && article.source_snapshot?.table)
      return {
        article,
        warning: `Sportdaten unverändert: ${snapshot.warning}`,
      };
    const saved = await row(
      db
        .from("editorial_articles")
        .update({
          body: content,
          original_body: content,
          source_snapshot: snapshot,
          status: "review",
          updated_by: userId,
        })
        .eq("id", article.id)
        .eq("version", body.version)
        .select()
        .maybeSingle(),
    );
    if (!saved) changed();
    return { article: saved, warning: snapshot.warning };
  }
  fail("Unbekannte Redaktionsaktion.");
}
