import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const logo = await readFile('assets/bsv-nordstern.png');
const crestCutout = await readFile('crest-cutout.js', 'utf8');
const html = (await readFile('admin-page.html', 'utf8'))
  .replace('__BSV_LOGO_DATA_URL__', `data:image/png;base64,${logo.toString('base64')}`)
  .replace('__CREST_CUTOUT_SCRIPT__', crestCutout);
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

await rm('dist', { recursive: true, force: true });
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await writeFile('dist/server/index.js', worker, 'utf8');
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
