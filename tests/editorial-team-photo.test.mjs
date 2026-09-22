import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverEditorialTeamPhoto} from '../src/editorial-team-photo.mjs';
import {editorialPublicSnapshot} from '../src/editorial-publication.mjs';
import {renderEditorialMagazine} from '../src/stadium-reader.mjs';
const hero=src=>`<section class="page-hero girls-team-hero"><div class="hero-image"><img alt="Mannschaftsbild Erste" src="${src}"></div></section>`;
test('team photograph discovery uses only the actual team hero and rejects placeholders and external images',()=>{
 const page='https://bsvnordstern.de/jugend/u19/';
 const nav='<img src="/images/another-team.jpg">';
 assert.deepEqual(discoverEditorialTeamPhoto(nav+hero('/images/team.jpg'),page),{source_url:'https://bsvnordstern.de/images/team.jpg',alt:'Mannschaftsbild Erste'});
 assert.equal(discoverEditorialTeamPhoto(nav+'<section class="girls-team-hero"><div class="team-image-placeholder">Teambild folgt</div></section>',page),null);
 for(const src of ['https://evil.example/image.jpg','http://bsvnordstern.de/images/team.jpg','/images/platzhalter.jpg','/private/image.jpg'])assert.equal(discoverEditorialTeamPhoto(hero(src),page),null);
});
test('paired and standalone sports keep each photograph with its own team and omit private source metadata',()=>{
 const articles=['first','second','youth','standalone'].map((id,index)=>({id,title:id,kind:'sports',body:(id==='youth'?'SPORT KOMPAKT · Jugend\n\n':'')+'TABELLE\nPlatz | Team\n1 | BSV',automatic_sports:true,source_snapshot:index===1?{}:{teamPhoto:{source_url:'PRIVATE SOURCE',hash:'PRIVATE HASH',photo_url:`https://example.org/${id}.jpg`,alt:id,photo_path:'private-path'}}}));
 const snapshot=editorialPublicSnapshot({id:'issue',title:'Heft',publishes_on:'2026-09-27'},articles);
 assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE/);
 snapshot.coverMatches=[{team:'Herren I',articleId:'first'},{team:'Herren II',articleId:'second'}];
 const html=renderEditorialMagazine(snapshot),edition=JSON.parse(html.match(/const editions=(\[.*?\]);const editionSponsorships/s)[1])[0];
 const pair=edition.editorialPages.find(page=>page.id==='first').blocks[0];assert.equal(pair.teams[0].photo.src,'https://example.org/first.jpg');assert.equal(pair.teams[1].photo,undefined);
 assert.equal(edition.editorialPages.find(p=>p.id==='youth').blocks[0].teams[0].photo.alt,'youth');
 assert.equal(edition.editorialPages.find(p=>p.id==='standalone').blocks[0].photo.alt,'standalone');
});
test('the first mens and womens team pictures introduce their own coaching and sports blocks',()=>{
 const teams=['herren-1','herren-2','frauen-1','frauen-2'].map(slug=>({id:slug,slug}));
 const articles=teams.flatMap(team=>['sports','coach'].map(kind=>({id:kind+'-'+team.id,team_id:team.id,kind,title:team.slug,body:'Beitrag',status:'ready',source_snapshot:kind==='sports'?{teamPhoto:{photo_url:'https://example.org/'+team.slug+'.jpg',alt:team.slug}}:null})));
 const snapshot=editorialPublicSnapshot({id:'issue',title:'Heft',publishes_on:'2026-09-27'},articles,teams);
 const html=renderEditorialMagazine(snapshot),edition=JSON.parse(html.match(/const editions=(\[.*?\]);const editionSponsorships/s)[1])[0];
 assert.deepEqual(edition.editorialPages.map(page=>page.id),['team-photo-herren','coach-herren-1','sports-herren-1','team-photo-frauen','coach-frauen-1','sports-frauen-1']);
 for(const group of ['herren','frauen']){
  const page=edition.editorialPages.find(p=>p.id==='team-photo-'+group);assert.ok(page.fullPage&&page.keepWithNext);
  assert.equal(page.blocks[0].photo.src,'https://example.org/'+group+'-1.jpg');
 }
});
