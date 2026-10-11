import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BSV_THEMES,suiteBrandTheme,brandThemeSvg} from '../src/brand-themes.mjs';
import {BRAND_PREVIEWS,brandPreviewSvg,brandLetterHtml} from '../src/brand-preview.mjs';
import {SUITE_BRAND_DEFAULT} from '../src/suite-brand.mjs';
import {renderEditorialNewsletter} from '../src/newsletter.mjs';
import {renderEditorialMagazine} from '../src/stadium-reader.mjs';
const colors={...SUITE_BRAND_DEFAULT,panel:'#204870',accent:'#dfab23',surface:'#fefcfa'};
test('themes reject URLs and injected SVG or CSS',()=>{
 assert.throws(()=>suiteBrandTheme('<img src=x>'));
 assert.throws(()=>brandThemeSvg('christmas',{panel:'red" onload="alert(1)'}));
 assert.throws(()=>brandPreviewSvg('homepage',{...colors,panel:'var(--x)'}));
 for(const theme of BSV_THEMES){
  const svg=brandThemeSvg(theme.key,colors);
  assert.match(svg,/<svg[^>]*viewBox="0 0 320 320"/);
  // SVG downloads and images must not depend on an external raster request.
  assert.match(svg,/<image href="data:image\/webp;base64,[A-Za-z0-9+/=]+"/);
  assert.doesNotMatch(svg,/href="https?:/);
 }
});
test('all four examples reflect the draft palette without mutating it',()=>{
 const before=JSON.stringify(colors);
 for(const media of BRAND_PREVIEWS){const svg=brandPreviewSvg(media.key,colors,'easter');assert.match(svg,/#204870/);assert.match(svg,/#dfab23/);assert.match(svg,/Beispielvorschau/);}
 assert.equal(JSON.stringify(colors),before);
 const html=brandLetterHtml(colors,'summer');assert.match(html,/@page\{size:A4/);assert.match(html,/<header>/);assert.match(html,/<footer>/);assert.match(html,/contenteditable="true"/);
});
test('email uses the snapshot palette and a durable PNG seasonal motif, keeping text untouched',async()=>{
 const snapshot={kind:'newsletter',title:'Farbe #092f20',publishes_on:'2026-12-01',brand:{color_scheme:colors,theme_key:'christmas'},articles:[{title:'Weihnachten',body:'Unser Text nennt #17613a.',status:'ready'}]};
 const mail=renderEditorialNewsletter(snapshot,await readFile(new URL('../templates/newsletter.html',import.meta.url),'utf8'),{preview:false});
 assert.match(mail.html,/christmas-v2\.png/);assert.match(mail.html,/background-color:#204870|border:4px solid #204870/);assert.match(mail.html,/Unser Text nennt #17613a\./);assert.match(mail.html,/Farbe #092f20/);assert.match(mail.html,/RESEND_UNSUBSCRIBE_URL/);assert.doesNotMatch(mail.html,/data:image|<svg|<script/);
});
test('magazine renders frozen brand without relying on the live feed',()=>{
 const html=renderEditorialMagazine({id:'design-test',title:'Weihnachtsausgabe',publishes_on:'2026-12-01',brand:{color_scheme:colors,theme_key:'christmas'},articles:[]},false);
 assert.match(html,/--green:#204870/);assert.match(html,/--yellow:#dfab23/);assert.match(html,/cover-photo-wrap::after/);assert.doesNotMatch(html,/social_brand_settings/);
});
