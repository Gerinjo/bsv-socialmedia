#!/usr/bin/env node
import { renderNewsletterUnsubscribePage } from "../src/newsletter-unsubscribe.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const port = Number(process.env.PREVIEW_PORT || 4173);
async function previewHtml() {
  let html = await readFile(new URL(".preview/index.html", root), "utf8");
  const sdkImport =
    "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';";
  const apiFunction =
    /    async function api\(method='GET', body\)\{[\s\S]*?\n    \}/;
  if (!html.includes(sdkImport) || !apiFunction.test(html))
    throw new Error(
      "Die Vorschau muss an den geänderten App-Einstieg angepasst werden.",
    );
  html = html
    .replace(
      sdkImport,
      "import { createClient, editorialPreviewApi } from '/preview-api.mjs';",
    )
    .replace(
      apiFunction,
      "    async function api(method='GET', body){ return editorialPreviewApi(method, body); }",
    )
    .replace(
      "<main>",
      '<div style="margin:0 auto 16px;padding:12px 18px;max-width:1648px;background:#fef3d5;color:#6b4400;border-radius:12px;font-size:14px" role="note"><strong>Lokale Vorschau mit Beispieldaten</strong> · Änderungen bleiben in diesem Browser gespeichert. KI und Live-Sportdaten sind hier deaktiviert.</div><main>',
    );
  return html;
}
const files = new Map([
  ["/newsletter-unsubscribe.mjs", "src/newsletter-unsubscribe.mjs"],
  ["/newsletter.mjs", "src/newsletter.mjs"],
  ["/preview-team-photos.mjs", "admin-site/preview/team-photos.mjs"],
  ["/preview-people.mjs", "admin-site/preview/people.mjs"],
  ["/editorial-people.mjs", "src/editorial-people.mjs"],
  ["/preview-sponsors.mjs", "admin-site/preview/sponsors.mjs"],
  ["/preview-sports.mjs", "admin-site/preview/sports.mjs"],
  ["/editorial-sports-format.mjs", "src/editorial-sports-format.mjs"],
  ["/preview-api.mjs", "admin-site/preview/api.mjs"],
  ["/editorial-publication.mjs", "src/editorial-publication.mjs"],
  ["/stadium-reader.mjs", "src/stadium-reader.mjs"],
  ["/stadium-reader-assets.mjs", "src/stadium-reader-assets.mjs"],
  ["/editorial-model.mjs", "src/editorial.mjs"],
  ["/editorial-calendar.mjs", "src/editorial-calendar.mjs"],
]);
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: http://localhost:${port} http://127.0.0.1:${port} https://bsvnordstern.de https://gerinjo.github.io; connect-src 'none'; frame-src blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
  );
  if (request.method !== "GET") {
    response.writeHead(405);
    response.end();
    return;
  }
  const path = new URL(request.url, "http://localhost").pathname;
  try {
    if (path === '/newsletter/abmelden') {
      response.setHeader('Content-Type','text/html; charset=utf-8');
      response.setHeader('Referrer-Policy','no-referrer');
      response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src about:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
      response.end(renderNewsletterUnsubscribePage());
      return;
    }
    if (/^\/preview-team-photos\/[a-z0-9-]+\.(png|jpe?g|webp)$/.test(path)) {
      const extension=path.split('.').pop();
      response.setHeader('Content-Type',extension==='jpg'||extension==='jpeg'?'image/jpeg':'image/'+extension);
      response.end(await readFile(new URL('admin-site/preview/team-photos/'+path.split('/').pop(),root)));
      return;
    }
    if (/^\/preview-people\/[a-z0-9-]+\.(png|jpe?g|webp)$/.test(path)) {
      const extension = path.split('.').pop();
      response.setHeader('Content-Type', extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : 'image/' + extension);
      response.end(await readFile(new URL('admin-site/preview/people/' + path.split('/').pop(), root)));
      return;
    }
    if (/^\/preview-artwork\/[a-z0-9-]+-[a-f0-9]{12}\.svg$/.test(path)) {
      response.setHeader('Content-Type', 'image/svg+xml');
      response.end(await readFile(new URL('supabase/functions/_shared/sponsor-artwork/' + path.split('/').pop(), root)));
      return;
    }
    if (/^\/preview-sponsors\/[a-z0-9-]+\.png$/.test(path)) {
      response.setHeader('Content-Type', 'image/png');
      response.end(await readFile(new URL('admin-site/preview/sponsors/' + path.split('/').pop(), root)));
      return;
    }
    if (/^\/stadionheft\/[a-z0-9-]+$/.test(path)) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        `<!doctype html><html lang="de"><meta charset="utf-8"><title>Stadionheft</title><body><p id="message">Ausgabe wird geladen …</p><script type="module">import {editorialPreviewPublication} from '/preview-api.mjs';import {renderEditorialMagazine} from '/stadium-reader.mjs';try{const html=renderEditorialMagazine(await editorialPreviewPublication(location.pathname.split('/').pop(),new URLSearchParams(location.search).get('version')),false);document.open();document.write(html);document.close();}catch(error){document.querySelector('#message').textContent=error.message;}</script></body></html>`,
      );
      return;
    }
    if (path === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(await previewHtml());
      return;
    }
    const file = files.get(path);
    if (!file) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.setHeader("Content-Type", "application/javascript; charset=utf-8");
    response.end(await readFile(new URL(file, root)));
  } catch (error) {
    response.writeHead(500);
    response.end("Die Vorschau konnte nicht geladen werden.");
    console.error(error.message);
  }
});
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} ist bereits belegt. Nutze PREVIEW_PORT=4174 npm run preview.`
      : error.message,
  );
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Redaktionsvorschau: http://localhost:${port}\nBeispieldaten werden lokal im Browser gespeichert. Beenden mit Strg+C.`,
  ),
);
