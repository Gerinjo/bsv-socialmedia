import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEditorialGalleries, editorialPublicSnapshot} from '../src/editorial-publication.mjs';
import {editorialSeeds} from '../src/editorial.mjs';
import {renderEditorialMagazine} from '../src/stadium-reader.mjs';
const group={id:'group',title:'Fest',cover_id:'second',images:[{id:'first',alt:'Erstes Bild',photo_path:'untrusted/path'},{id:'second',alt:'Zweites Bild'}]};
test('galleries require a cover belonging to the group and unique bounded image identifiers',()=>{
 assert.equal(normalizeEditorialGalleries([group])[0].cover_id,'second');
 assert.equal(normalizeEditorialGalleries([group])[0].images[0].photo_path,undefined);
 for(const input of [[{...group,cover_id:'elsewhere'}],[{...group,images:[]}],[group,group],[{...group,images:[group.images[0],group.images[0]]}],Array(7).fill(group)])assert.throws(()=>normalizeEditorialGalleries(input));
});
test('A-youth receives automatic sports but no trainer greeting',()=>{
 const seeds=editorialSeeds('stadium',[{id:'a',slug:'u19-junioren',name:'A-Jugend'},{id:'adult',slug:'herren-1',name:'Herren I'}]);
 assert.ok(seeds.some(a=>a.team_id==='a'&&a.kind==='sports'&&a.automatic_sports));
 assert.ok(!seeds.some(a=>a.team_id==='a'&&a.kind==='coach'));
 assert.ok(seeds.some(a=>a.team_id==='adult'&&a.kind==='coach'));
});
test('legacy A-youth sports share the compact youth layout without changing approval',()=>{
 for (const identity of [{team_slug:'u19-junioren',title:'Sport · U19'}, {team_slug:'a-jugend',title:'Sport · A-Jugend'}, {title:'Sport · A-Junioren'}]) {
  const articles=[{id:'a',kind:'sports',body:'TABELLE\nPlatz | Mannschaft\n1 | BSV',status:'review',automatic_sports:false,...identity},
   {id:'b',kind:'sports',team_slug:'u17-junioren',title:'Sport kompakt · B-Jugend',body:'TABELLE\nPlatz | Mannschaft\n1 | BSV',status:'ready',automatic_sports:true}];
  const html=renderEditorialMagazine({id:'issue',title:'Heft',publishes_on:'2026-09-27',articles});
  const edition=JSON.parse(html.match(/const editions=(\[.*?\]);const editionSponsorships/s)[1])[0];
  assert.equal(edition.editorialPages.length,1);
  const page=edition.editorialPages[0];
  assert.deepEqual(page.articleIds,['a','b']);
  assert.equal(page.blocks[0].type,'youth-sports-grid');
  assert.ok(page.blocks[0].teams.every(team=>team.compact));
  assert.equal(page.approved,false);
  assert.equal(edition.articles[0].automaticSports,false);
 }
});
test('reader pairs coaches and orders free contributions between adults and youth independent of input order',()=>{
 const teams=['herren-1','herren-2','frauen-1','frauen-2','u19-junioren'].map(slug=>({id:slug,slug}));
 const base={body:'Willkommen',status:'ready',author:'Trainer'};
 const articles=[{...base,id:'free',kind:'free',title:'Fest',gallery_groups:[{...group,images:group.images.map(image=>({...image,photo_url:'https://example.org/photo.jpg'}))}]},
 ...teams.flatMap(team=>[{...base,id:'sport-'+team.id,title:team.slug,kind:'sports',team_id:team.id,automatic_sports:team.slug.startsWith('u')},...(!team.slug.startsWith('u')?[{...base,id:'coach-'+team.id,title:team.slug,kind:'coach',team_id:team.id}]:[])]),
 {...base,id:'youth',kind:'youth',title:'Jugendleitung'}];
 const html=renderEditorialMagazine(editorialPublicSnapshot({id:'issue',title:'Heft',publishes_on:'2026-09-27'},articles.reverse(),teams));
 const edition=JSON.parse(html.match(/const editions=(\[.*?\]);const editionSponsorships/s)[1])[0],pages=edition.editorialPages;
 assert.deepEqual(pages.map(p=>p.id),['coach-herren-1','sport-herren-1','coach-frauen-1','sport-frauen-1','free','youth','sport-u19-junioren']);
 assert.deepEqual(pages[0].articleIds,['coach-herren-1','coach-herren-2']);
 assert.equal(pages[4].blocks.at(-1).type,'editorial-gallery-row');assert.equal(pages[4].blocks.at(-1).galleries[0].coverId,'second');
});

test('gallery tiles form rows of at most three, with overflow introduced inside the text',()=>{
 for(const count of [1,2,3,4,5,6]) {
  const galleries=Array.from({length:count},(_,index)=>({id:'group-'+index,title:'Fotos '+index,cover_id:'cover-'+index,images:[{id:'cover-'+index,photo_url:'https://example.org/photo.jpg'}]}));
  const body='Ein Bericht aus unserem Verein. '.repeat(8);
  const html=renderEditorialMagazine({id:'issue',title:'Heft',publishes_on:'2026-09-27',articles:[{id:'free',kind:'free',body,title:'Fest',galleries}]});
  const blocks=JSON.parse(html.match(/const editions=(\[.*?\]);const editionSponsorships/s)[1])[0].articles[0].blocks;
  const rows=blocks.filter(b=>b.type==='editorial-gallery-row');
  assert.equal(rows.length,Math.ceil(count/3));assert.ok(rows.every(row=>row.galleries.length<=3));
  assert.deepEqual(rows.flatMap(row=>row.galleries.map(g=>g.id)),galleries.map(g=>g.id));
  assert.equal(blocks.filter(b=>b.type==='paragraph').map(b=>b.text).join(''),body);
  if(count>3){assert.equal(blocks[0].type,'paragraph');assert.equal(blocks[1].type,'editorial-gallery-row');assert.equal(blocks[2].type,'paragraph');}
  assert.equal(blocks.at(-1).type,'editorial-gallery-row');
 }
});
