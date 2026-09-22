import '../../scripts/build-stadium-reader.mjs';
import { editorialCanDeleteArticle } from '../../src/editorial.mjs';
const { renderEditorialMagazine } = await import('../../src/stadium-reader.mjs');
const { stadiumReaderAssets } = await import('../../src/stadium-reader-assets.mjs');
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const adminDir = resolve(scriptDir, '..');
const repoDir = resolve(adminDir, '..');
const distDir = resolve(repoDir, 'dist');
const previewDir = resolve(repoDir, '.preview');

const logo = await readFile(resolve(adminDir, 'assets/bsv-nordstern.png'));
const suiteLogo = await readFile(resolve(adminDir, 'assets/social-media-club-suite-icon.png'));
const suiteWordmark = await readFile(resolve(adminDir, 'assets/social-media-club-suite-wordmark.svg'));
const crestCutout = await readFile(resolve(adminDir, 'crest-cutout.js'), 'utf8');
const richTextEditor = await readFile(resolve(adminDir, 'rich-text-editor.mjs'), 'utf8');
const svgUpload = await readFile(resolve(repoDir, 'src/svg-upload.mjs'), 'utf8');
const visionOcr = await readFile(resolve(adminDir, 'vision-ocr.mjs'), 'utf8');
const tesseract = await readFile(resolve(repoDir, 'node_modules/tesseract.js/dist/tesseract.min.js'), 'utf8');
let html = await readFile(resolve(adminDir, 'admin-page.html'), 'utf8');
for (const [placeholder, source] of [
  ['__BSV_LOGO_DATA_URL__', `data:image/png;base64,${logo.toString('base64')}`],
  ['__SUITE_LOGO_DATA_URL__', `data:image/png;base64,${suiteLogo.toString('base64')}`],
  ['__SUITE_WORDMARK_DATA_URL__', `data:image/svg+xml;base64,${suiteWordmark.toString('base64')}`],
  ['__EDITORIAL_CALENDAR_SCRIPT__', await readFile(resolve(repoDir, 'src/editorial-calendar.mjs'), 'utf8')],
  ['__EDITORIAL_PUBLICATION_SCRIPT__', await readFile(resolve(repoDir, 'src/editorial-publication.mjs'), 'utf8')],
  ['__EDITORIAL_PEOPLE_SCRIPT__', await readFile(resolve(repoDir, 'src/editorial-people.mjs'), 'utf8')],
  ['__STADIUM_READER_ASSETS__', (await readFile(resolve(repoDir, 'src/stadium-reader-assets.mjs'), 'utf8')).replaceAll('</script', '<\\/script')],
  ['__STADIUM_READER_SCRIPT__', (await readFile(resolve(repoDir, 'src/stadium-reader.mjs'), 'utf8')).replace(/^import .*;\n/, '').replaceAll('</script', '<\\/script')],
  ['__EDITORIAL_DICTATION_SCRIPT__', await readFile(resolve(adminDir, 'editorial-dictation.mjs'), 'utf8')],
  ['__EDITORIAL_SCRIPT__', editorialCanDeleteArticle.toString() + '\n' + await readFile(resolve(adminDir, 'editorial.mjs'), 'utf8')],
  ['__EDITORIAL_CSS__', await readFile(resolve(adminDir, 'editorial.css'), 'utf8')],
  ['__CREST_CUTOUT_SCRIPT__', crestCutout],
  ['__RICH_TEXT_EDITOR_SCRIPT__', richTextEditor],
  ['__VISION_OCR_SCRIPT__', visionOcr],
  ['__SVG_UPLOAD_SCRIPT__', svgUpload],
  ['__TESSERACT_SCRIPT__', tesseract.replaceAll('</script', '<\\/script')],
]) {
  html = html.replaceAll(placeholder, () => source);
}
if ((html.match(/<!doctype html>/gi) ?? []).length !== 1 || /__[A-Z0-9_]+__/.test(html)) {
  throw new Error('Die Admin-Oberfläche wurde nicht korrekt eingebettet.');
}
const worker = `const html = ${JSON.stringify(html)};
const stadiumReaderAssets = ${JSON.stringify(stadiumReaderAssets)};
const renderEditorialMagazine = ${renderEditorialMagazine.toString()};

export default {
  async fetch(request) {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const match = new URL(request.url).pathname.match(/^\\/stadionheft\\/([0-9a-f-]{36})$/i);
    if (match) {
      try {
        const feed = await fetch('https://maejihwjzxkmthjavgnx.supabase.co/functions/v1/editorial-publications?id=' + match[1], {headers:{apikey:'sb_publishable_a3DnmtbBycRR4mWV4Jmz-w_RJobGli9'}});
        if (!feed.ok) return new Response(feed.status === 404 ? 'Diese Ausgabe ist noch nicht veröffentlicht.' : 'Die Ausgabe ist vorübergehend nicht verfügbar.', {status:feed.status,headers:{'cache-control':'no-store'}});
        return new Response(renderEditorialMagazine(await feed.json(),false),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https://maejihwjzxkmthjavgnx.supabase.co; base-uri 'none'; frame-ancestors 'none'\"}});
      } catch { return new Response('Die Ausgabe ist vorübergehend nicht verfügbar.',{status:503}); }
    }
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'self'; script-src 'unsafe-inline' 'wasm-unsafe-eval' https://esm.sh https://cdn.jsdelivr.net; connect-src 'self' https://maejihwjzxkmthjavgnx.supabase.co https://cdn.jsdelivr.net; worker-src blob:; frame-src blob:; img-src 'self' data: https://maejihwjzxkmthjavgnx.supabase.co https://gerinjo.github.io; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    });
  },
};
`;

await rm(distDir, { recursive: true, force: true });
await mkdir(previewDir, { recursive: true });
await mkdir(resolve(distDir, 'server'), { recursive: true });
await mkdir(resolve(distDir, '.openai'), { recursive: true });
await writeFile(resolve(previewDir, 'index.html'), html, 'utf8');
await writeFile(resolve(distDir, 'server/index.js'), worker, 'utf8');
await cp(resolve(adminDir, '.openai/hosting.json'), resolve(distDir, '.openai/hosting.json')); 
