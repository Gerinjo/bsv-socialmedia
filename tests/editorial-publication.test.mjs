import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialReleaseState,editorialPublicSnapshot,editorialCoverMatches,normalizeEditorialEvent,decodeEditorialCover} from '../src/editorial-publication.mjs';
import {renderEditorialMagazine} from '../src/stadium-reader.mjs';
const issue={id:'issue',kind:'stadium',title:'Heft',version:5,publishes_on:'2026-09-27',cover_path:'private/cover.jpg'};
const article={id:'article',kind:'free',title:'Artikel',status:'ready',body:'Geprüfter Text',author:'Redaktion'};
test('cover includes each active adult team and its earliest scheduled match on or after publication',()=>{
  const teams=[{id:'women',slug:'frauen-1',sort_order:20},{id:'men',slug:'herren-1',sort_order:10},
    {id:'youth',slug:'a-jugend'},{id:'disabled',slug:'herren-3',active:false},{id:'men2',slug:'herren-2',sort_order:11}];
  const match={date:'2026-09-27',time:'15:00',scheduled:true,finished:false,home:'Gastgeber',away:'BSV Nordstern'};
  const articles=[{...article,kind:'sports',team_id:'men',source_snapshot:{fetchedAt:'2026-09-20',secret:'PRIVATE',upcoming:[
    {...match,date:'2026-10-04'}, {...match,date:'2026-09-26'}, {...match,time:'12:00',scheduled:false},
    {...match,time:'13:00',finished:true}, match, {...match,time:'14:00'},
  ]}}, {...article,id:'women-article',kind:'sports',team_id:'women',source_snapshot:{fetchedAt:'2026-09-20',upcoming:[]}}];
  const result=editorialCoverMatches(issue,articles,teams);
  assert.deepEqual(result.map(m=>[m.team,m.state]),[['Herren I','scheduled'],['Herren II','pending'],['Frauen I','unavailable']]);
  assert.deepEqual(result[0],{team:'Herren I',articleId:'article',date:'2026-09-27',time:'14:00',home:'Gastgeber',away:'BSV Nordstern',state:'scheduled'});
  const frozen=editorialPublicSnapshot(issue,articles,teams);
  articles[0].source_snapshot.upcoming.at(-1).away='Geändert';
  assert.equal(frozen.coverMatches[0].away,'BSV Nordstern');
  assert.doesNotMatch(JSON.stringify(frozen),/PRIVATE/);
});
test('automatic sports are excluded from manual approval counts but missing data still blocks publication',()=>{
  const automatic={...article,kind:'sports',automatic_sports:true};
  const prepared={...issue,previewed_version:5};
  assert.equal(editorialReleaseState(prepared,[article,automatic]).canPublish,true);
  const pending=editorialReleaseState(prepared,[article,{...automatic,status:'draft'}]);
  assert.equal(pending.pending,0);
  assert.equal(pending.automaticPending,1);
  assert.equal(pending.canPublish,false);
});
test('approval alone does not publish; the current preview and a cover are required',()=>{
  assert.equal(editorialReleaseState(issue,[article]).canPublish,false);
  assert.equal(editorialReleaseState({...issue,previewed_version:5},[article]).canPublish,true);
  assert.equal(editorialReleaseState({...issue,cover_path:null,previewed_version:5},[article]).canPublish,false);
  assert.equal(editorialReleaseState({...issue,previewed_version:4},[article]).canPublish,false);
  assert.equal(editorialReleaseState({...issue,previewed_version:5},[]).canPublish,false);
  assert.equal(editorialReleaseState({...issue,previewed_version:5},[{...article,status:'review'}]).canPublish,false);
  assert.equal(editorialReleaseState({...issue,previewed_version:5,published_version:5},[article]).canPublish,false);
});
test('publication projection excludes originals, audit data and unedited event descriptions',()=>{
  const result=editorialPublicSnapshot(issue,[{...article,original_body:'SECRET',updated_by:'PRIVATE USER',event_snapshot:{description:'UNEDITED',source_id:'PRIVATE SOURCE',date:'2026-10-01',time:'14:00',location:'Sportplatz'}}]);
  assert.doesNotMatch(JSON.stringify(result),/SECRET|PRIVATE|UNEDITED/);
  assert.equal(result.articles[0].event.location,'Sportplatz');
});
test('events require a real date and description; date/time are snapshot values',()=>{
  assert.equal(normalizeEditorialEvent({title:'Fest',description:'Programm',date:'2026-10-01',time:'14:00'}).date,'2026-10-01');
  for(const patch of [{date:'2026-02-30'},{time:'25:99'},{description:''}])assert.throws(()=>normalizeEditorialEvent({title:'Fest',description:'Programm',date:'2026-10-01',...patch}));
});
test('cover uploads reject SVG and image MIME spoofing',()=>{
  assert.throws(()=>decodeEditorialCover('data:image/svg+xml;base64,PHN2Zz4='));
  assert.throws(()=>decodeEditorialCover('data:image/png;base64,aGVsbG8='));
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII=';
  assert.equal(decodeEditorialCover(png).mimeType,'image/png');
});
test('the real reader receives only escaped editorial data and preserves paragraph breaks',()=>{
  const html=renderEditorialMagazine(editorialPublicSnapshot({...issue,title:'</script><script>alert(1)</script>'},[{...article,title:'<img src=x onerror=alert(1)>',body:'Absatz 1\n\nAbsatz 2'}]));
  assert.ok(html.includes('id="cover-title"'));
  assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
  assert.ok(html.includes('Absatz 1'));assert.ok(html.includes('Absatz 2'));
});

test('active teams share a full page with first team left, second right; empty drafts create no sheets',()=>{
 const sports=[{...article,id:'second',kind:'sports',automatic_sports:true,body:'Second table'},{...article,id:'first',kind:'sports',automatic_sports:true,body:'First table'}, {...article,id:'empty',body:''}];
 const snapshot=editorialPublicSnapshot(issue,sports);
 snapshot.coverMatches=[{team:'Herren II',articleId:'second'},{team:'Herren I',articleId:'first'}];
 const html=renderEditorialMagazine(snapshot);
 const edition=JSON.parse(html.match(/const editions=(\[.*?\]);const editionSponsorships/s)[1])[0];
 assert.equal(edition.editorialPages.length,1);
 assert.equal(edition.editorialPages[0].fullPage,true);
 assert.deepEqual(edition.editorialPages[0].articleIds,['first','second']);
 assert.deepEqual(edition.editorialPages[0].blocks[0].teams.map(team=>team.text),['First table','Second table']);
});
