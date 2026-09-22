import { withEditorialTeamPhotos } from '../_shared/editorial-team-photo.ts';
import { withEditorialGalleries } from '../_shared/editorial-galleries.ts';
import { withEditorialPeople } from '../_shared/editorial-people.ts';
import { withSupabase } from "npm:@supabase/server@1.4.1";
import { withEditorialAdvertising } from '../_shared/editorial-advertising.ts';
const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "apikey, authorization, content-type",
  "cache-control": "no-store",
};
const handler = withSupabase(
  { auth: "publishable" },
  async (request, context) => {
    if (request.method !== "GET")
      return Response.json(
        { error: "method_not_allowed" },
        { status: 405, headers },
      );
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!/^[0-9a-f-]{36}$/i.test(id))
      return Response.json({ error: "not_found" }, { status: 404, headers });
    const { data, error } = await context.supabaseAdmin
      .from("editorial_publications")
      .select("snapshot")
      .eq("issue_id", id)
      .order("issue_version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error)
      return Response.json(
        { error: "publication_unavailable" },
        { status: 503, headers },
      );
    if (!data)
      return Response.json({ error: "not_found" }, { status: 404, headers });
    const publication = data as {
      snapshot: { cover_path: string; [key: string]: unknown };
    };
    const { cover_path, ...snapshot } = publication.snapshot;
    const { data: cover, error: coverError } =
      await context.supabaseAdmin.storage
        .from("editorial-covers")
        .createSignedUrl(cover_path, 3600);
    if (coverError)
      return Response.json(
        { error: "cover_unavailable" },
        { status: 503, headers },
      );
    try {
      return Response.json(
        await withEditorialTeamPhotos(context.supabaseAdmin, await withEditorialGalleries(context.supabaseAdmin, await withEditorialPeople(context.supabaseAdmin, await withEditorialAdvertising(context.supabaseAdmin, { ...snapshot, cover_url: cover.signedUrl })))),
        { headers },
      );
    } catch {
      return Response.json({ error: 'advertising_unavailable' }, { status: 503, headers });
    }
  },
);
export default {
  fetch: (request: Request) =>
    request.method === "OPTIONS"
      ? new Response(null, { status: 204, headers })
      : handler(request),
};
