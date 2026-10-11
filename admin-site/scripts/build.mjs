import '../../scripts/build-stadium-reader.mjs';
import './build-suite-brand.mjs';
import { renderNewsletterUnsubscribePage, NEWSLETTER_UNSUBSCRIBE_LINK } from '../../src/newsletter-unsubscribe.mjs';
import { editorialCanDeleteArticle } from '../../src/editorial.mjs';
import { cashbookManifest, cashbookOfflineHtml } from '../../src/cashbook-pwa.mjs';
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
const suiteLogo = await readFile(resolve(adminDir, 'assets/social-media-club-suite-icon.svg'));
const suiteWordmark = await readFile(resolve(adminDir, 'assets/social-media-club-suite-wordmark.svg'));
const crestCutout = await readFile(resolve(adminDir, 'crest-cutout.js'), 'utf8');
const richTextEditor = await readFile(resolve(adminDir, 'rich-text-editor.mjs'), 'utf8');
const svgUpload = await readFile(resolve(repoDir, 'src/svg-upload.mjs'), 'utf8');
const visionOcr = await readFile(resolve(adminDir, 'vision-ocr.mjs'), 'utf8');
const tesseract = await readFile(resolve(repoDir, 'node_modules/tesseract.js/dist/tesseract.min.js'), 'utf8');
let coachHtml = await readFile(resolve(adminDir, 'referee-coach.html'), 'utf8');
const brandAssets = {};
for(const key of ['football','christmas','easter','summer'])for(const version of [1,2])brandAssets[`/brand/themes/${key}-v${version}.png`]={type:'image/png',base64:true,body:(await readFile(resolve(adminDir,`assets/brand-themes/${key}-v${version}.png`))).toString('base64')};
const cashbookAssets = {
  ...brandAssets,
  '/kassenbuch/manifest.webmanifest': {type:'application/manifest+json',body:JSON.stringify(cashbookManifest)},
  '/suite-sw.js': {type:'application/javascript; charset=utf-8',body:await readFile(resolve(adminDir,'cashbook-sw.js'),'utf8')},
  '/kassenbuch/offline': {type:'text/html; charset=utf-8',body:cashbookOfflineHtml},
};
for (const size of [192,512]) cashbookAssets[`/kassenbuch/icon-${size}.png`] = {type:'image/png',base64:true,body:(await readFile(resolve(adminDir,`assets/cashbook-icon-${size}.png`))).toString('base64')};
let html = await readFile(resolve(adminDir, 'admin-page.html'), 'utf8');
for (const [placeholder, source] of [
  ['__BSV_LOGO_DATA_URL__', `data:image/png;base64,${logo.toString('base64')}`],
  ['__SUITE_LOGO_DATA_URL__', `data:image/svg+xml;base64,${suiteLogo.toString('base64')}`],
  ['__SUITE_WORDMARK_DATA_URL__', `data:image/svg+xml;base64,${suiteWordmark.toString('base64')}`],
  ['__EDITORIAL_CALENDAR_SCRIPT__', await readFile(resolve(repoDir, 'src/editorial-calendar.mjs'), 'utf8')],
  ['__EDITORIAL_PUBLICATION_SCRIPT__', await readFile(resolve(repoDir, 'src/editorial-publication.mjs'), 'utf8')],
  ['__EDITORIAL_PEOPLE_SCRIPT__', await readFile(resolve(repoDir, 'src/editorial-people.mjs'), 'utf8')],
  ['__STADIUM_READER_ASSETS__', (await readFile(resolve(repoDir, 'src/stadium-reader-assets.mjs'), 'utf8')).replaceAll('</script', '<\\/script')],
  ['__STADIUM_READER_SCRIPT__', (await readFile(resolve(repoDir, 'src/stadium-reader.mjs'), 'utf8')).replace(/^import .*;\n/gm, '').replaceAll('</script', '<\\/script')],
  ['__NEWSLETTER_SCRIPT__',
    'const NEWSLETTER_UNSUBSCRIBE_LINK = ' + JSON.stringify(NEWSLETTER_UNSUBSCRIBE_LINK) + ';\n' + (await readFile(resolve(repoDir, 'src/newsletter.mjs'), 'utf8')).replace(/^import .*;\n/gm, '') + '\nconst newsletterAssets = ' + JSON.stringify({
      template: await readFile(resolve(repoDir, 'templates/newsletter.html'), 'utf8'),
    }).replaceAll('<', '\\u003c') + ';'],
  ['__EDITORIAL_DICTATION_SCRIPT__', await readFile(resolve(adminDir, 'editorial-dictation.mjs'), 'utf8')],
  ['__EDITORIAL_SCRIPT__', editorialCanDeleteArticle.toString() + '\n' + await readFile(resolve(adminDir, 'editorial.mjs'), 'utf8')],
  ['__EXPENSE_MODEL__', await readFile(resolve(repoDir, 'src/referee-expenses.mjs'), 'utf8')],
  ['__RECEIPT_OCR__', await readFile(resolve(adminDir, 'receipt-ocr.mjs'), 'utf8')],
  ['__EXPENSE_SCRIPT__', await readFile(resolve(adminDir, 'referee-expenses.mjs'), 'utf8')],
  ['__REFEREE_MODEL__', await readFile(resolve(repoDir, 'src/referees.mjs'), 'utf8')],
  ['__CASHBOOK_MODEL__', await readFile(resolve(repoDir, 'src/cashbook.mjs'), 'utf8')],
  ['__SUITE_ACCESS_MODEL__', await readFile(resolve(repoDir,'src/suite-access.mjs'),'utf8')],
  ['__BRAND_THEMES_MODEL__', (await readFile(resolve(repoDir,'src/brand-theme-assets.mjs'),'utf8'))+'\n'+(await readFile(resolve(repoDir,'src/brand-themes.mjs'),'utf8')).replace(/^import .*;\n/gm,'')],
  ['__BRAND_PREVIEW_MODEL__', (await readFile(resolve(repoDir,'src/brand-preview.mjs'),'utf8')).replace(/^import .*;\n/gm,'')],
  ['__BRAND_PREVIEW_SCRIPT__', await readFile(resolve(adminDir,'brand-preview.mjs'),'utf8')],
  ['__BRAND_PREVIEW_CSS__', await readFile(resolve(adminDir,'brand-preview.css'),'utf8')],
  ['__SUITE_BRAND_MODEL__', await readFile(resolve(repoDir,'src/suite-brand.mjs'),'utf8')],
  ['__SUITE_USERS_SCRIPT__', await readFile(resolve(adminDir,'suite-users.mjs'),'utf8')],
  ['__SUITE_MEMBER_MODEL__', await readFile(resolve(repoDir, 'src/suite-members.mjs'), 'utf8')],
  ['__CASHBOOK_SCRIPT__', await readFile(resolve(adminDir, 'cashbook.mjs'), 'utf8')],
  ['__SUITE_INSTALL_SCRIPT__', (await readFile(resolve(adminDir, 'suite-install.mjs'), 'utf8')).replace(/^export /gm, '')],
  ['__SUITE_MOBILE_NAVIGATION_SCRIPT__', (await readFile(resolve(adminDir, 'suite-mobile-navigation.mjs'), 'utf8')).replace(/^export /gm, '')],
  ['__CASHBOOK_CSS__', await readFile(resolve(adminDir, 'cashbook.css'), 'utf8')],
  ['__REFEREE_SCRIPT__', await readFile(resolve(adminDir, 'referees.mjs'), 'utf8')],
  ['__REFEREE_CSS__', await readFile(resolve(adminDir, 'referees.css'), 'utf8')],
  ['__EDITORIAL_CSS__', await readFile(resolve(adminDir, 'editorial.css'), 'utf8')],
  ['__CREST_CUTOUT_SCRIPT__', crestCutout],
  ['__RICH_TEXT_EDITOR_SCRIPT__', richTextEditor],
  ['__VISION_OCR_SCRIPT__', visionOcr],
  ['__SVG_UPLOAD_SCRIPT__', svgUpload],
  ['__TESSERACT_SCRIPT__', tesseract.replaceAll('</script', '<\\/script')],
]) {
  html = html.replaceAll(placeholder, () => source);
  coachHtml = coachHtml.replaceAll(placeholder, () => source);
}
if ((html.match(/<!doctype html>/gi) ?? []).length !== 1 || /__[A-Z0-9_]+__/.test(html)) {
  throw new Error('Die Admin-Oberfläche wurde nicht korrekt eingebettet.');
}
if (/__[A-Z0-9_]+__/.test(coachHtml)) throw new Error('Die Traineransicht wurde nicht korrekt eingebettet.');
const unsubscribeHtml = renderNewsletterUnsubscribePage();
const worker = `const unsubscribeHtml = ${JSON.stringify(unsubscribeHtml)};
const html = ${JSON.stringify(html)};
const coachHtml = ${JSON.stringify(coachHtml)};
const cashbookAssets = ${JSON.stringify(cashbookAssets)};
const stadiumReaderAssets = ${JSON.stringify(stadiumReaderAssets)};
${(await readFile(resolve(repoDir,'src/suite-brand.mjs'),'utf8')).replace(/^export /gm,'')}
${(await readFile(resolve(repoDir,'src/brand-theme-assets.mjs'),'utf8')).replace(/^export /gm,'')}
${(await readFile(resolve(repoDir,'src/brand-themes.mjs'),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'')}
const renderEditorialMagazine = ${renderEditorialMagazine.toString()};

export default {
  async fetch(request) {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const path = new URL(request.url).pathname;
    if(path==='/suite-brand.json'){try{const result=await fetch('https://maejihwjzxkmthjavgnx.supabase.co/rest/v1/social_brand_settings?select=color_scheme,theme_key,updated_at&id=eq.true',{headers:{apikey:'sb_publishable_a3DnmtbBycRR4mWV4Jmz-w_RJobGli9'},signal:AbortSignal.timeout(5000)});if(!result.ok)throw new Error('Brand unavailable');const rows=await result.json();return Response.json(rows[0]||{},{headers:{'cache-control':'public,max-age=60'}})}catch{return Response.json({},{status:503})}}
    if (path === '/kassenbuch' || path === '/kassenbuch/') return Response.redirect(new URL('/?area=cashbook',request.url),302);
    const asset = cashbookAssets[path];
    if (asset) return new Response(asset.base64 ? Uint8Array.from(atob(asset.body),char=>char.charCodeAt(0)) : asset.body,{headers:{'content-type':asset.type,'cache-control':path.endsWith('.png')?'public, max-age=86400':'no-cache','x-content-type-options':'nosniff'}});
    if (new URL(request.url).pathname === '/newsletter/abmelden') return new Response(unsubscribeHtml,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src about:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}});
    const match = new URL(request.url).pathname.match(/^\\/stadionheft\\/([0-9a-f-]{36})$/i);
    if (match) {
      try {
        const version = new URL(request.url).searchParams.get('version');
        const feed = await fetch('https://maejihwjzxkmthjavgnx.supabase.co/functions/v1/editorial-publications?id=' + match[1] + (version === null ? '' : '&version=' + encodeURIComponent(version)), {headers:{apikey:'sb_publishable_a3DnmtbBycRR4mWV4Jmz-w_RJobGli9'}});
        if (!feed.ok) return new Response(feed.status === 404 ? 'Diese Ausgabe ist noch nicht veröffentlicht.' : 'Die Ausgabe ist vorübergehend nicht verfügbar.', {status:feed.status,headers:{'cache-control':'no-store'}});
        return new Response(renderEditorialMagazine(await feed.json(),false),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https://maejihwjzxkmthjavgnx.supabase.co; base-uri 'none'; frame-ancestors 'none'\"}});
      } catch { return new Response('Die Ausgabe ist vorübergehend nicht verfügbar.',{status:503}); }
    }
    return new Response(/^\\/schiedsrichter\\/?$/.test(path) ? coachHtml : html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://esm.sh https://cdn.jsdelivr.net; connect-src 'self' https://maejihwjzxkmthjavgnx.supabase.co https://cdn.jsdelivr.net; worker-src 'self' blob:; frame-src blob:; img-src 'self' data: https://maejihwjzxkmthjavgnx.supabase.co https://gerinjo.github.io https://bsvnordstern.de; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
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
await writeFile(resolve(previewDir, 'schiedsrichter.html'), coachHtml, 'utf8');
await writeFile(resolve(previewDir, 'cashbook-assets.json'), JSON.stringify(cashbookAssets), 'utf8');
await writeFile(resolve(distDir, 'server/index.js'), worker, 'utf8');
await cp(resolve(adminDir, '.openai/hosting.json'), resolve(distDir, '.openai/hosting.json')); 
