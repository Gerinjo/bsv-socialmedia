import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SUITE_BRAND_DEFAULT,SUITE_BRAND_PALETTES,SUITE_PRIDE_RIBBON,suiteBrandColors,suiteBrandPalette,suiteBrandRibbon,suiteBrandVariables} from '../src/suite-brand.mjs';
import {BRAND_PREVIEWS,brandPreviewSvg,brandLetterHtml} from '../src/brand-preview.mjs';
import {renderEditorialNewsletter} from '../src/newsletter.mjs';
import {renderEditorialMagazine} from '../src/stadium-reader.mjs';
const template=await readFile(new URL('../templates/newsletter.html',import.meta.url),'utf8');
test('five event suggestions and the original BSV scheme provide validated colors with readable text pairs',()=>{
 assert.equal(SUITE_BRAND_PALETTES.length,6);assert.equal(new Set(SUITE_BRAND_PALETTES.map(p=>p.key)).size,6);
 assert.deepEqual(SUITE_BRAND_PALETTES.find(p=>p.key==='bsv').colors,SUITE_BRAND_DEFAULT);
 const luminance=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 for(const palette of SUITE_BRAND_PALETTES){
  const colors=suiteBrandColors(palette.colors);assert.equal(suiteBrandPalette(colors)?.key,palette.key);
  for(const [fg,bg] of [['surface','panel'],['ink','surface'],['ink','primary'],['ink','accent'],['muted','panel']]){
   const levels=[luminance(colors[fg]),luminance(colors[bg])].sort((a,b)=>a-b);assert.ok((levels[1]+.05)/(levels[0]+.05)>=4.5,`${palette.key}: ${fg}/${bg}`);
  }
  for(const media of BRAND_PREVIEWS)assert.ok(brandPreviewSvg(media.key,colors).includes(colors.panel));
 }
 const draft={...SUITE_BRAND_PALETTES[1].colors,panel:'#123456'};assert.equal(suiteBrandPalette(draft),null);assert.notEqual(SUITE_BRAND_PALETTES[1].colors.panel,draft.panel);
});
test('CSD rainbow is retained by all preview and download formats and by frozen newsletter and magazine colors',()=>{
 const colors=SUITE_BRAND_PALETTES.find(p=>p.key==='pride').colors;
 assert.deepEqual(suiteBrandRibbon(colors),SUITE_PRIDE_RIBBON);assert.match(suiteBrandVariables(colors)['--brand-ribbon'],/linear-gradient/);
 const snapshot={kind:'newsletter',title:'Vielfalt im Verein',publishes_on:'2027-06-01',brand:{color_scheme:colors,theme_key:'football'},articles:[{title:'Gemeinsam',body:'Alle sind willkommen.',status:'ready'}]};
 const mail=renderEditorialNewsletter(snapshot,template,{preview:false});
 const magazine=renderEditorialMagazine({...snapshot,id:'pride-test',kind:'stadium'},false);
 const outputs=[...BRAND_PREVIEWS.map(media=>brandPreviewSvg(media.key,colors)),brandLetterHtml(colors),mail.html,magazine];
 for(const output of outputs)for(const color of SUITE_PRIDE_RIBBON)assert.ok(output.includes(color),color);
 assert.match(mail.html,/data-brand-ribbon/);assert.doesNotMatch(mail.html,/<svg|<script|data:image/);
 assert.equal(suiteBrandVariables(SUITE_BRAND_DEFAULT)['--brand-ribbon-height'],'0px');
 assert.deepEqual(suiteBrandRibbon({...colors,accent:'#ffffff'}),[]);
 assert.doesNotMatch(renderEditorialNewsletter({...snapshot,brand:{color_scheme:SUITE_BRAND_DEFAULT}},template,{preview:false}).html,/data-brand-ribbon/);
});
