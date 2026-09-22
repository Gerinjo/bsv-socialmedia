import { withEditorialTeamPhotos } from '../_shared/editorial-team-photo.ts';
import { withEditorialGalleries, withArticleGalleries } from '../_shared/editorial-galleries.ts';
import { withEditorialPeople } from '../_shared/editorial-people.ts';
import {
  decodeEditorialCover,
  normalizeEditorialEvent,
} from "../../../src/editorial-publication.mjs";
import { prepareEditorialAdvertising, withEditorialAdvertising } from "../_shared/editorial-advertising.ts";
const bucket = "editorial-covers";
async function row(query: any) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
export async function withEditorialCover(db: any, issue: any) {
  if (!issue.cover_path) return { ...issue, cover_url: null };
  const { data, error } = await db.storage
    .from(bucket)
    .createSignedUrl(issue.cover_path, 3600);
  if (error) throw error;
  return { ...issue, cover_url: data.signedUrl };
}
export async function handleEditorialPublication(
  db: any,
  userId: string,
  body: any,
) {
  if (body.action === 'editorial_waive_article') {
    const article = await row(db.from('editorial_articles').select('*').eq('id', body.id).single());
    if (article.kind !== 'coach' || article.automatic_sports) throw new Error('Verzicht ist nur für Trainergrußworte möglich.');
    if (typeof body.waived !== 'boolean') throw new Error('Bitte Verzicht auswählen oder aufheben.');
    if (article.version !== body.version) throw new Error('Der Beitrag wurde geändert. Bitte neu öffnen und erneut prüfen.');
    if ((article.status === 'waived') === body.waived) return {article: await withArticleGalleries(db, article)};
    const saved = await row(db.from('editorial_articles').update({
      status: body.waived ? 'waived' : article.body.trim() ? 'review' : 'draft',
      approved_at: null, approved_by: null, updated_by: userId,
    }).eq('id', body.id).eq('version', body.version).select().maybeSingle());
    if (!saved) throw new Error('Der Beitrag wurde geändert. Bitte neu öffnen und erneut prüfen.');
    return {article: await withArticleGalleries(db, saved)};
  }
  if (body.action === "editorial_approve_article") {
    const article = await row(
      db.from("editorial_articles").select("*").eq("id", body.id).single(),
    );
    if (article.automatic_sports) throw new Error('Sportdaten werden beim Abruf automatisch freigegeben.');
    if (article.status === 'waived') throw new Error('Bitte zuerst den Verzicht aufheben und den Beitrag prüfen.');
    if (!article.body.trim())
      throw new Error("Ein leerer Beitrag kann nicht freigegeben werden.");
    const saved = await row(
      db
        .from("editorial_articles")
        .update({
          status: "ready",
          approved_at: new Date().toISOString(),
          approved_by: userId,
          updated_by: userId,
        })
        .eq("id", body.id)
        .eq("version", body.version)
        .select()
        .maybeSingle(),
    );
    if (!saved)
      throw new Error(
        "Der Beitrag wurde geändert. Bitte neu öffnen und erneut prüfen.",
      );
    return { article: await withArticleGalleries(db, saved) };
  }
  if (body.action === "editorial_cover") {
    const issue = await row(
      db.from("editorial_issues").select("*").eq("id", body.issueId).single(),
    );
    if (issue.version !== body.version)
      throw new Error("Die Ausgabe wurde geändert. Bitte neu laden.");
    const alt = String(body.alt || issue.title).trim(),
      credit = String(body.credit || "").trim();
    if (alt.length > 300 || credit.length > 300)
      throw new Error(
        "Bildbeschreibung und Bildnachweis dürfen höchstens 300 Zeichen enthalten.",
      );
    if (body.dataUrl == null) {
      if (!issue.cover_path) throw new Error('Bitte zuerst ein Titelbild auswählen.');
      const saved = await row(db.from('editorial_issues')
        .update({cover_alt: alt, cover_credit: credit})
        .eq('id', issue.id).eq('version', body.version).select().maybeSingle());
      if (!saved) throw new Error('Die Ausgabe wurde geändert. Bitte neu laden.');
      return {issue: await withEditorialCover(db, saved)};
    }
    const { bytes, mimeType, extension } = decodeEditorialCover(body.dataUrl);
    const path = `${issue.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await db.storage
      .from(bucket)
      .upload(path, bytes, { contentType: mimeType, upsert: false });
    if (error) throw error;
    let saved;
    try {
      saved = await row(
        db
          .from("editorial_issues")
          .update({ cover_path: path, cover_alt: alt, cover_credit: credit })
          .eq("id", issue.id)
          .eq("version", body.version)
          .select()
          .maybeSingle(),
      );
      if (!saved)
        throw new Error(
          "Die Ausgabe wurde inzwischen geändert. Bitte den Upload wiederholen.",
        );
    } catch (error) {
      await db.storage.from(bucket).remove([path]);
      throw error;
    }
    // Once referenced by the issue, the image must survive a signing outage.
    return { issue: await withEditorialCover(db, saved) };
  }
  if (body.action === "editorial_remove_event") {
    const removed = await row(
      db
        .from("editorial_articles")
        .delete()
        .eq("id", body.id)
        .eq("kind", "event")
        .eq("version", body.version)
        .select("id")
        .maybeSingle(),
    );
    if (!removed)
      throw new Error("Die Veranstaltung wurde geändert. Bitte neu laden.");
    return { removed: true };
  }
  if (body.action === "editorial_events") {
    const stories = await row(
      db
        .from("social_independent_stories")
        .select("id,title,motivation,activity,event_at,schedule_kind")
        .eq("enabled", true)
        .order("event_at", { ascending: false })
        .limit(100),
    );
    return {
      events: stories.map((story: any) => ({
        source_id: story.id,
        title: story.title,
        description: [story.motivation, story.activity]
          .filter(Boolean)
          .join("\n\n"),
        date: new Date(story.event_at).toLocaleDateString("sv-SE", {
          timeZone: "Europe/Berlin",
        }),
        time: new Date(story.event_at).toLocaleTimeString("de-DE", {
          timeZone: "Europe/Berlin",
          hour: "2-digit",
          minute: "2-digit",
        }),
        location: "",
        recurring: story.schedule_kind === "weekly",
      })),
    };
  }
  if (body.action === "editorial_add_event") {
    await row(
      db.from("editorial_issues").select("id").eq("id", body.issueId).single(),
    );
    // The form deliberately snapshots date and description; later story edits cannot change a reviewed issue.
    const event = normalizeEditorialEvent(body.event);
    const article = await row(
      db
        .from("editorial_articles")
        .insert({
          issue_id: body.issueId,
          title: event.title,
          body: event.description,
          original_body: event.description,
          kind: "event",
          status: "review",
          template_key: event.source_id
            ? `event:${event.source_id}:${event.date}`
            : null,
          event_snapshot: event,
          position: 2000,
          updated_by: userId,
        })
        .select()
        .single(),
    );
    return { article };
  }
  if (body.action === "editorial_preview_issue") {
    let version = body.version;
    const issue = await row(db.from('editorial_issues').select('*').eq('id', body.issueId).single());
    if (issue.version !== version) throw new Error('Die Ausgabe wurde geändert. Bitte neu laden.');
    if (issue.kind === 'stadium') {
      const prepared = await prepareEditorialAdvertising(db, issue);
      let saved;
      try {
        saved = await row(db.from('editorial_issues').update({ advertising: prepared.snapshot }).eq('id', issue.id).eq('version', version).select().maybeSingle());
        if (!saved) throw new Error('Die Ausgabe wurde während des Anzeigenabrufs geändert. Bitte erneut öffnen.');
      } catch (error) {
        await prepared.cleanup();
        throw error;
      }
      version = saved.version;
    }
    const snapshot = await row(
      db.rpc("preview_editorial_issue", {
        target: body.issueId,
        expected_version: version,
      }),
    );
    return { snapshot: await withEditorialTeamPhotos(db, await withEditorialGalleries(db, await withEditorialPeople(db, await withEditorialAdvertising(db, await withEditorialCover(db, snapshot))))) };
  }
  if (body.action === "editorial_publish_issue") {
    const issue = await row(
      db.rpc("publish_editorial_issue", {
        target: body.issueId,
        expected_version: body.version,
        actor: userId,
      }),
    );
    return {
      issue: await withEditorialCover(db, issue),
      url: `/stadionheft/${issue.id}`,
    };
  }
  throw new Error("Unbekannte Aktion.");
}
