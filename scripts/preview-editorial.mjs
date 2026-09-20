#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const port = Number(process.env.PREVIEW_PORT || 4173);
let html = await readFile(new URL('.preview/index.html', root), 'utf8');
const sdkImport = "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';";
const apiFunction = /    async function api\(method='GET', body\)\{[\s\S]*?\n    \}/;
if (!html.includes(sdkImport) || !apiFunction.test(html)) throw new Error('Die Vorschau muss an den geänderten App-Einstieg angepasst werden.');
html = html.replace(sdkImport, "import { createClient, editorialPreviewApi } from '/preview-api.mjs';")
  .replace(apiFunction, "    async function api(method='GET', body){ return editorialPreviewApi(method, body); }")
  .replace('<main>', '<div style="margin:0 auto 16px;padding:12px 18px;max-width:1648px;background:#fef3d5;color:#6b4400;border-radius:12px;font-size:14px" role="note"><strong>Lokale Vorschau mit Beispieldaten</strong> · Änderungen bleiben in diesem Browser gespeichert. KI und Live-Sportdaten sind hier deaktiviert.</div><main>');
const files = new Map([
  ['/preview-api.mjs', 'admin-site/preview/api.mjs'],
  ['/editorial-model.mjs', 'src/editorial.mjs'],
  ['/editorial-calendar.mjs', 'src/editorial-calendar.mjs'],
]);
const server = createServer(async (request,response) => {
  response.setHeader('Cache-Control','no-store');
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  if (request.method !== 'GET') {response.writeHead(405);response.end();return;}
  const path = new URL(request.url,'http://localhost').pathname;
  try {
    if (path === '/') {response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);return;}
    const file = files.get(path);
    if (!file) {response.writeHead(404);response.end('Not found');return;}
    response.setHeader('Content-Type','application/javascript; charset=utf-8');
    response.end(await readFile(new URL(file,root)));
  } catch(error) {response.writeHead(500);response.end('Die Vorschau konnte nicht geladen werden.');console.error(error.message);}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} ist bereits belegt. Nutze PREVIEW_PORT=4174 npm run preview.`:error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Redaktionsvorschau: http://localhost:${port}\nBeispieldaten werden lokal im Browser gespeichert. Beenden mit Strg+C.`));
