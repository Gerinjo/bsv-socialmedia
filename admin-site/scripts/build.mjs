import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const adminDir = resolve(scriptDir, '..');
const repoDir = resolve(adminDir, '..');
const distDir = resolve(adminDir, 'dist');
const previewDir = resolve(repoDir, '.preview');

const logo = await readFile(resolve(adminDir, 'assets/bsv-nordstern.png'));
const crestCutout = await readFile(resolve(adminDir, 'crest-cutout.js'), 'utf8');
const richTextEditor = await readFile(resolve(adminDir, 'rich-text-editor.mjs'), 'utf8');
const html = (await readFile(resolve(adminDir, 'admin-page.html'), 'utf8'))
  .replaceAll('__BSV_LOGO_DATA_URL__', `data:image/png;base64,${logo.toString('base64')}`)
  .replaceAll('__CREST_CUTOUT_SCRIPT__', crestCutout)
  .replaceAll('__RICH_TEXT_EDITOR_SCRIPT__', richTextEditor);
const worker = `const html = ${JSON.stringify(html)};

export default {
  async fetch(request) {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'self'; script-src 'unsafe-inline' https://esm.sh; connect-src 'self' https://maejihwjzxkmthjavgnx.supabase.co; img-src 'self' data: https://maejihwjzxkmthjavgnx.supabase.co https://gerinjo.github.io; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
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
