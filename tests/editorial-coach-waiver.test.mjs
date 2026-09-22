import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialSeeds} from '../src/editorial.mjs';
import {editorialReleaseState, editorialPublicSnapshot} from '../src/editorial-publication.mjs';
import {renderEditorialMagazine} from '../src/stadium-reader.mjs';

const issue = {id:'issue',kind:'stadium',title:'Heft',publishes_on:'2026-09-27',version:5,previewed_version:5,cover_path:'cover.jpg'};
const teams = ['herren-1','herren-2','frauen-1','frauen-2'].map(slug=>({id:slug,slug,name:'SG Mannschaft',active:true}));
const coaches = teams.map(team=>({id:team.id,team_id:team.id,team_slug:team.slug,kind:'coach',status:'ready',title:team.slug,body:`Grußwort ${team.slug}`}));
const edition = snapshot => JSON.parse(renderEditorialMagazine(snapshot).match(/const editions=(\[.*?\]);const editionSponsorships/s)[1])[0];

test('both adult second teams have distinct coach inputs for new issues',()=>{
 const seeds=editorialSeeds('stadium',teams).filter(a=>a.kind==='coach');
 assert.deepEqual(seeds.map(a=>a.team_id),teams.map(t=>t.id));
 assert.equal(seeds[1].title,'Grußwort Trainer · 2. Herrenmannschaft');
 assert.equal(seeds[3].title,'Grußwort Trainer · 2. Frauenmannschaft');
});
test('a coach waiver completes its slot, but open coaches and all sports still block publication',()=>{
 const waived=coaches.map(a=>({...a,status:'waived',body:''}));
 assert.equal(editorialReleaseState(issue,waived).canPublish,true);
 for(const status of ['draft','review','ready']) {
  assert.equal(editorialReleaseState(issue,[...waived,{...coaches[0],body:'',status}]).pending,1);
 }
 for(const kind of ['free','sports','board','youth','event']) {
  assert.equal(editorialReleaseState(issue,[{...waived[0],kind}]).canPublish,false);
 }
 assert.equal(editorialReleaseState(issue,[{...waived[0],kind:'sports',automatic_sports:true}]).automaticPending,1);
});
test('only approved nonempty coach words enter snapshots and the reader, without placeholder sections',()=>{
 for(const status of ['draft','review','waived']) {
  const articles=coaches.map((a,index)=>index===0 || index===3 ? {...a,status,body:'PRIVATE UNSHARED WORDS',people:[{name:'PRIVATE PERSON'}]} : a);
  const snapshot=editorialPublicSnapshot(issue,articles,teams);
  assert.deepEqual(snapshot.articles.map(a=>a.id),['herren-2','frauen-1']);
  assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE/);
  // Guard old/direct snapshots too, independently of the snapshot projection.
  const rendered=edition({...issue,articles});
  assert.doesNotMatch(JSON.stringify(rendered),/PRIVATE|noch nicht eingereicht/);
  assert.deepEqual(rendered.editorialPages.map(p=>p.blocks[0].teams.map(t=>t.title)),[['2. Mannschaft'],['1. Mannschaft']]);
 }
 const empty=edition({...issue,articles:coaches.map(a=>({...a,body:' '}))});
 assert.equal(empty.editorialPages.length,0);
 const ready=edition({...issue,articles:coaches.toReversed()});
 assert.deepEqual(ready.editorialPages.map(p=>p.articleIds),[['herren-1','herren-2'],['frauen-1','frauen-2']]);
});
