import { prepareEditorialTeamPhoto } from '../_shared/editorial-team-photo.ts';
import { prepareEditorialGalleries, withArticleGalleries } from '../_shared/editorial-galleries.ts';
import { loadEditorialPeople, prepareEditorialPeople } from '../_shared/editorial-people.ts';
import {
  handleEditorialPublication,
  withEditorialCover,
} from "./editorial-publication.ts";
import opentype from "npm:opentype.js@1.3.4";
import {
  ARTICLE_STATUSES,
  editorialCanDeleteArticle,
  editorialSeeds,
  editorialTeamProfile,
  normalizeEditorialIssue,
  rewriteEditorialText,
} from "../../../src/editorial.mjs";
import { editorialSportsSnapshot } from "../../../src/editorial-sports.mjs";
import { normalizeNewsletterSettings, newsletterSource, newsletterSelection } from '../../../src/newsletter.mjs';
import { normalizeEditorialCoverSettings } from '../../../src/editorial-publication.mjs';

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

async function loadNewsletterSource(db: any, sourceIssueId: unknown, sourceVersion?: unknown) {
  if (typeof sourceIssueId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(sourceIssueId)) fail('Bitte ein veröffentlichtes Stadionheft auswählen.');
  if (sourceVersion != null && (!Number.isInteger(sourceVersion) || Number(sourceVersion) < 1)) fail('Ungültige Heftfassung.');
  let query = db.from('editorial_publications').select('issue_id,issue_version,published_at,snapshot').eq('issue_id', sourceIssueId);
  if (sourceVersion != null) query = query.eq('issue_version', sourceVersion);
  return newsletterSource(await row(query.order('issue_version',{ascending:false}).limit(1).maybeSingle()));
}

export async function handleEditorial(db: any, userId: string, body: any) {
  const action = body.action;
  if (
    [
      "editorial_approve_article",
      "editorial_waive_article",
      "editorial_cover",
      "editorial_events",
      "editorial_add_event",
      "editorial_remove_event",
      "editorial_preview_issue",
      "editorial_publish_issue",
    ].includes(action)
  )
    return handleEditorialPublication(db, userId, body);
  if (action === "editorial_list") {
    const [issues, teams, audiences, people] = await Promise.all([
      row(
        db
          .from("editorial_issues")
          .select("*")
          .order("publishes_on", { ascending: false }),
      ),
      row(
        db
          .from("social_teams")
          .select("id,name,slug,website_path,active,sort_order")
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
      loadEditorialPeople(db),
    ]);
    return {
      people,
      issues: await Promise.all(
        issues.map((issue: any) => withEditorialCover(db, issue)),
      ),
      // This flag is scoped to the editorial UI; social-media settings stay untouched.
      teams: teams.map((team: any) => ({...team, active: team.active || /^(herren|frauen)-[12]$/.test(team.slug || '')})),
      departments: audiences,
      rewriteAvailable: Boolean(
        Deno.env.get("GROQ_API_KEY") && Deno.env.get("EDITORIAL_GROQ_MODEL"),
      ),
    };
  }
  if (action === "editorial_save_issue") {
    const issue = normalizeEditorialIssue(body);
    if (!body.id) {
      const teams = await row(
        db
          .from("social_teams")
          .select("id,name,slug,website_path,active")
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
  if (action === "editorial_articles") {
    const articles = await row(db.from('editorial_articles').select('*').eq('issue_id',body.issueId).order('position').order('created_at'));
    return {articles:await Promise.all(articles.map((article: any)=>withArticleGalleries(db,article)))};
  }
  if (action === 'editorial_newsletter_source') {
    return {source:await loadNewsletterSource(db, body.sourceIssueId, body.sourceVersion)};
  }
  if (action === 'editorial_save_newsletter_selection') {
    const issue = await row(db.from('editorial_issues').select('*').eq('id', body.issueId).single());
    if (issue.kind !== 'newsletter') fail('Die Artikelauswahl ist nur für Newsletter verfügbar.');
    if (issue.version !== body.version) fail('Die Ausgabe wurde geändert. Bitte neu laden.');
    let selection = null;
    if (body.sourceIssueId != null) {
      if (!Number.isInteger(body.sourceVersion) || body.sourceVersion < 1) fail('Bitte das Heft erneut laden.');
      selection = newsletterSelection(await loadNewsletterSource(db, body.sourceIssueId, body.sourceVersion), body.articleIds);
    } else if (!Array.isArray(body.articleIds) || body.articleIds.length) fail('Bitte die Artikelauswahl prüfen.');
    const saved = await row(db.from('editorial_issues').update({newsletter_selection:selection})
      .eq('id', issue.id).eq('version', body.version).select().maybeSingle());
    if (!saved) fail('Die Ausgabe wurde geändert. Bitte neu laden.');
    return {issue:saved};
  }
  if (action === 'editorial_save_newsletter_settings') {
    const settings = normalizeNewsletterSettings(body.settings);
    const issue = await row(db.from('editorial_issues').select('*').eq('id', body.issueId).single());
    if (issue.kind !== 'newsletter') fail('Diese Angaben sind nur für Newsletter verfügbar.');
    if (issue.version !== body.version) fail('Die Ausgabe wurde geändert. Bitte neu laden.');
    const saved = await row(db.from('editorial_issues')
      .update({newsletter_settings: settings}).eq('id', issue.id).eq('version', body.version).select().maybeSingle());
    if (!saved) fail('Die Ausgabe wurde geändert. Bitte neu laden.');
    return {issue:saved};
  }
  if (action === 'editorial_save_cover_settings' || action === 'editorial_save_cover_defaults') {
    const settings = normalizeEditorialCoverSettings(body.settings);
    const issue = await row(db.from('editorial_issues').select('*').eq('id', body.issueId).single());
    if (issue.kind !== 'stadium') fail('Ein Titelblatt ist nur für Stadionhefte verfügbar.');
    if (issue.version !== body.version) fail('Die Ausgabe wurde geändert. Bitte neu laden.');
    const entries = await row(db.from('editorial_articles').select('id,kind').eq('issue_id', issue.id));
    const teams = await row(db.from('social_teams').select('slug,active'));
    if (settings.articles.some((item: any) => !entries.some((article: any) => article.id === item.id && article.kind !== 'sports')) || settings.teamSlugs.some((slug: string) => !teams.some((team: any) => team.slug === slug && (team.active !== false || /^(herren|frauen)-[12]$/.test(team.slug))))) fail('Die Auswahl enthält nicht verfügbare Beiträge oder Mannschaften. Bitte neu laden.');
    const saved = action === 'editorial_save_cover_defaults'
      ? await row(db.rpc('save_editorial_cover_defaults', {target:issue.id, expected_version:body.version, settings, actor:userId}))
      : await row(db.from('editorial_issues').update({cover_settings:settings}).eq('id',issue.id).eq('version',body.version).select().maybeSingle());
    if (!saved) fail('Die Ausgabe wurde geändert. Bitte neu laden.');
    return {issue: await withEditorialCover(db, saved)};
  }
  if (action === 'editorial_delete_article') {
    const article = await row(db.from('editorial_articles').select('*').eq('id', body.id).single());
    if (article.version !== body.version) changed();
    const team = article.kind === 'coach' && article.team_id
      ? await row(db.from('social_teams').select('slug').eq('id', article.team_id).single()) : null;
    if (!editorialCanDeleteArticle(article, team))
      fail('Nur weitere Beiträge können gelöscht werden. Feste Grußworte und Sportdaten bleiben im Inhaltsplan.');
    const removed = await row(db.from('editorial_articles').delete().eq('id', article.id)
      .eq('version', body.version).eq('kind', article.kind).select('id').maybeSingle());
    if (!removed) changed();
    // The delete trigger invalidates the issue preview; revisions cascade.
    // Keep immutable image files: published snapshots may still reference them.
    return { removed: true };
  }
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
    if (current?.status === 'waived') fail('Bitte zuerst den Verzicht aufheben, um den Beitrag zu bearbeiten.');
    if (body.status === 'waived') fail('Bitte den Verzicht-Button verwenden.');
    if (current?.automatic_sports) fail('Sportdaten werden automatisch erzeugt. Bitte über „Sportdaten aktualisieren“ neu laden.');
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
    const articleTitle = title(body.title);
    const preparedPeople = body.person_ids !== undefined
      ? await prepareEditorialPeople(db, issue.id, current || { kind: 'free' }, body.person_ids) : null;
    let preparedGalleries;
    try { preparedGalleries = body.gallery_groups !== undefined ? await prepareEditorialGalleries(db, issue.id, current || {kind:'free'}, body.gallery_groups) : null; }
    catch(error) { await preparedPeople?.cleanup(); throw error; }
    const galleryGroups = preparedGalleries?.galleries || current?.gallery_groups || [];
    const peopleSnapshot = preparedPeople?.people || current?.people_snapshot || [];
    const selectedAuthor = peopleSnapshot.length ? peopleSnapshot.map((person: any) => person.name).join(' & ') : author;
    const contentChanged = !current || content !== current.body;
    const metadataChanged =
      !current ||
      articleTitle !== current.title ||
      JSON.stringify(galleryGroups) !== JSON.stringify(current.gallery_groups || []) ||
      selectedAuthor !== current.author ||
      JSON.stringify(peopleSnapshot) !== JSON.stringify(current.people_snapshot || []) ||
      (body.department_id || null) !== current.department_id;
    if (
      status === "ready" &&
      (current?.status !== "ready" || contentChanged || metadataChanged)
    ) {
      await preparedPeople?.cleanup();
      await preparedGalleries?.cleanup();
      fail(
        "Bitte den Beitrag speichern und anschließend über den Freigabe-Button freigeben.",
      );
    }
    const needsRewrite =
      (current?.kind ?? "free") !== "sports" &&
      (contentChanged || body.rewrite === true) &&
      Boolean(content.trim());
    const payload = {
      title: articleTitle,
      body: content,
      original_body: contentChanged ? content : current.original_body,
      department_id: body.department_id || null,
      author: selectedAuthor,
      people_snapshot: peopleSnapshot,
      gallery_groups: galleryGroups,
      status:
        needsRewrite || ((contentChanged || metadataChanged) && content.trim())
          ? "review"
          : status,
      updated_by: userId,
    };
    let article;
    try { article = await row(
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
    } catch (error) { await preparedPeople?.cleanup(); await preparedGalleries?.cleanup(); throw error; }
    let warning = "";
    if (needsRewrite) {
      try {
        const revised = await rewriteEditorialText({
          text: content,
          title: article.title,
          kind: issue.kind,
          apiKey: Deno.env.get("GROQ_API_KEY"),
          model: Deno.env.get("EDITORIAL_GROQ_MODEL"),
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
    return { article: await withArticleGalleries(db, article), warning, rewritten: needsRewrite && !warning };
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
  if (action === 'editorial_prepare_sports') {
    const issue = await row(db.from('editorial_issues').select('id,kind').eq('id', body.issueId).single());
    if (issue.kind !== 'stadium') fail('Sportübersichten sind für Stadionhefte vorgesehen.');
    const teams = await row(db.from('social_teams').select('id,name,slug,website_path,active').order('sort_order'));
    const existing = await row(db.from('editorial_articles').select('team_id,template_key').eq('issue_id', issue.id).eq('kind', 'sports'));
    const missing = editorialSeeds('stadium', teams).filter((seed: any) => seed.kind === 'sports' && !existing.some((a: any) => a.team_id === seed.team_id));
    if (missing.length) await row(db.from('editorial_articles').upsert(missing.map((seed: any) => ({ ...seed, issue_id: issue.id, updated_by: userId })), { onConflict: 'issue_id,template_key', ignoreDuplicates: true }));
    const eligible = new Set(teams.filter((team: any) => editorialTeamProfile(team).included).map((team: any) => team.id));
    const articles = await row(db.from('editorial_articles').select('*').eq('issue_id', issue.id).eq('kind', 'sports').order('position'));
    return { articles: articles.filter((article: any) => eligible.has(article.team_id)) };
  }
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
    const gameFields = 'id,source_match_id,team_id,status,kickoff_at,home_team,away_team,home_score,away_score,competition';
    const [past, future] = await Promise.all([
      row(db.from('social_games').select(gameFields).eq('team_id', team.id).eq('status', 'finished').lte('kickoff_at', `${issue.publishes_on}T23:59:59Z`).order('kickoff_at', { ascending: false }).limit(10)),
      row(db.from('social_games').select(gameFields).eq('team_id', team.id).eq('status', 'scheduled').gte('kickoff_at', new Date(Date.parse(issue.publishes_on) - 86400000).toISOString()).order('kickoff_at').limit(30)),
    ]);
    const { body: content, snapshot } = await editorialSportsSnapshot({
      team,
      games: [...past, ...future],
      cutoff: issue.publishes_on,
      parseFont: opentype.parse,
    });
    // Keep the last good source intact if the upstream table fails.
    if ((snapshot.failedSources.table && article.source_snapshot?.table) || (snapshot.failedSources.matches && (article.source_snapshot?.upcoming?.length || article.source_snapshot?.lastMatches?.length || article.source_snapshot?.results)))
      return {
        article,
        warning: `Sportdaten unverändert: ${snapshot.warning}`,
      };
    const preparedPhoto = await prepareEditorialTeamPhoto(db, article.issue_id, snapshot.teamPhoto, article.source_snapshot?.teamPhoto);
    snapshot.teamPhoto = preparedPhoto.photo;
    if (preparedPhoto.warning) snapshot.warning = [snapshot.warning, preparedPhoto.warning].filter(Boolean).join(' ');
    let saved;
    try { saved = await row(
      db
        .from("editorial_articles")
        .update({
          body: content,
          original_body: content,
          source_snapshot: snapshot,
          automatic_sports: editorialTeamProfile(team).automaticSports,
          status: editorialTeamProfile(team).automaticSports ? (snapshot.autoApprovalEligible ? 'ready' : 'draft') : 'review',
          updated_by: userId,
        })
        .eq("id", article.id)
        .eq("version", body.version)
        .select()
        .maybeSingle(),
    );
    if (!saved) changed();
    } catch(error) { await preparedPhoto.cleanup(); throw error; }
    return { article: saved, warning: snapshot.warning };
  }
  fail("Unbekannte Redaktionsaktion.");
}
