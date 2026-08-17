import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const adminDir = resolve(scriptDir, '..');
const repoDir = resolve(adminDir, '..');
const distDir = resolve(repoDir, 'dist');
const previewDir = resolve(repoDir, '.preview');

const logo = await readFile(resolve(adminDir, 'assets/bsv-nordstern.png'));
const crestCutout = await readFile(resolve(adminDir, 'crest-cutout.js'), 'utf8');
const richTextEditor = await readFile(resolve(adminDir, 'rich-text-editor.mjs'), 'utf8');
const visionOcr = await readFile(resolve(adminDir, 'vision-ocr.mjs'), 'utf8');
const tesseract = await readFile(resolve(repoDir, 'node_modules/tesseract.js/dist/tesseract.min.js'), 'utf8');
let html = await readFile(resolve(adminDir, 'admin-page.html'), 'utf8');
for (const [placeholder, source] of [
  ['__BSV_LOGO_DATA_URL__', `data:image/png;base64,${logo.toString('base64')}`],
  ['__CREST_CUTOUT_SCRIPT__', crestCutout],
  ['__RICH_TEXT_EDITOR_SCRIPT__', richTextEditor],
  ['__VISION_OCR_SCRIPT__', visionOcr],
  ['__TESSERACT_SCRIPT__', tesseract.replaceAll('</script', '<\\/script')],
]) {
  html = html.replaceAll(placeholder, () => source);
}
if ((html.match(/<!doctype html>/gi) ?? []).length !== 1 || /__[A-Z0-9_]+__/.test(html)) {
  throw new Error('Die Admin-Oberfläche wurde nicht korrekt eingebettet.');
}
const worker = `const html = ${JSON.stringify(html)};

export default {
  async fetch(request) {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'self'; script-src 'unsafe-inline' 'wasm-unsafe-eval' https://esm.sh https://cdn.jsdelivr.net; connect-src 'self' https://maejihwjzxkmthjavgnx.supabase.co https://cdn.jsdelivr.net; worker-src blob:; img-src 'self' data: https://maejihwjzxkmthjavgnx.supabase.co https://gerinjo.github.io; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
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
