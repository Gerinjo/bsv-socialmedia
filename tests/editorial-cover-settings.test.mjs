import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialCoverTemplate,applyEditorialCoverTemplate,editorialCoverDefaults,normalizeEditorialCoverSettings,editorialPublicSnapshot} from '../src/editorial-publication.mjs';
import {renderEditorialMagazine} from '../src/stadium-reader.mjs';
const issue={id:'issue',title:'Heimspiel',kind:'stadium',publishes_on:'2026-09-27'};
const article={id:'report',title:'Unser Fest',kind:'free',body:'Bericht',status:'ready'};
const settings=()=>({...editorialCoverDefaults(issue,[article]),teamSlugs:['herren-1']});
const edition = snapshot=>JSON.parse(renderEditorialMagazine(snapshot).match(/const editions=(\[.*?\]);const editionSponsorships/s)[1])[0];
test('cover choices validate flags, lengths, identifiers and duplicates, and discard unknown fields',()=>{
 const valid=settings();assert.deepEqual(normalizeEditorialCoverSettings({...valid,privateNote:'secret'}),valid);
 for(const patch of [{showDate:'false'},{headline:'x'.repeat(181)},{articles:[{id:'foreign/path',alias:''}]},{articles:[valid.articles[0],valid.articles[0]]},{articles:[{id:'report',alias:'x'.repeat(101)}]},{teamSlugs:['u19-junioren']},{teamSlugs:['herren-1','herren-1']}])assert.throws(()=>normalizeEditorialCoverSettings({...valid,...patch}));
 assert.deepEqual(editorialCoverDefaults(issue,[article]).articles,[{id:'report',alias:''}]);
});
test('cover hides selected teams without removing their full sport pages, and supports aliases and empty selections',()=>{
 const teams=['herren-1','herren-2','frauen-1','frauen-2'].map(slug=>({id:slug,slug,active:true}));
 const articles=[article,...teams.map(t=>({...article,id:'sport-'+t.slug,kind:'sports',team_id:t.id,automatic_sports:true}))];
 const config={...settings(),number:'07',namePart1:'VEREINS',namePart2:'leben',articles:[{id:article.id,alias:'Ein schöner Nachmittag'}]};
 const snapshot=editorialPublicSnapshot({...issue,cover_settings:config},articles,teams);
 const result=edition(snapshot);assert.equal(result.number,'07');assert.deepEqual(result.coverMatches.map(m=>m.team),['Herren I']);
 assert.equal(result.editorialPages.filter(p=>p.blocks[0]?.type==='senior-sports-grid').length,2);
 assert.deepEqual(result.teaserIds,['report']);assert.equal(result.teaserAliases.report,'Ein schöner Nachmittag');
 const empty=edition({...snapshot,cover_settings:{...config,teamSlugs:[],articles:[]}});assert.deepEqual(empty.coverMatches,[]);assert.deepEqual(empty.teaserIds,[]);
 assert.equal(edition({...snapshot,cover_settings:null}).coverMatches.length,4);
});
test('cover names and aliases cannot inject scripts into the reader',()=>{
 const html=renderEditorialMagazine(editorialPublicSnapshot({...issue,cover_settings:{...settings(),namePart1:'</script><script>alert(1)</script>',articles:[{id:'report',alias:'<img src=x onerror=alert(1)>'}]}},[article]));
 assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
});

test('public cover settings omit aliases for deleted, empty or waived articles and keep an independent snapshot',()=>{
 const hidden={...article,id:'coach',kind:'coach',status:'waived'};
 const config={...settings(),articles:[{id:'report',alias:'Public'},{id:'coach',alias:'Private waived teaser'},{id:'deleted',alias:'Removed'}]};
 const snapshot=editorialPublicSnapshot({...issue,cover_settings:config},[article,hidden]);
 assert.deepEqual(snapshot.cover_settings.articles,[{id:'report',alias:'Public'}]);config.articles[0].alias='Changed';assert.equal(snapshot.cover_settings.articles[0].alias,'Public');
});

test('saved cover template remaps greetings to fresh IDs and copies independent settings',()=>{
 const old=[{id:'old-board',template_key:'board',kind:'board'},{id:'old-youth',template_key:'youth',kind:'youth'},article];
 const input={...settings(),articles:[{id:'old-board',alias:'Unser Vorstand'},{id:'old-youth',alias:''},{id:'report',alias:'Nur in diesem Heft'}]};
 const template=editorialCoverTemplate(input,old);
 assert.deepEqual(template.articles,[{template_key:'board',alias:'Unser Vorstand'},{template_key:'youth',alias:''}]);
 const next=applyEditorialCoverTemplate(template,[{id:'new-board',template_key:'board',kind:'board'}],[{slug:'herren-1',active:true}]);
 assert.deepEqual(next.articles,[{id:'new-board',alias:'Unser Vorstand'}]);
 assert.deepEqual(next.teamSlugs,['herren-1']);
 assert.equal(next.headline,input.headline);
 next.articles[0].alias='Geändert';next.teamSlugs.push('herren-2');
 assert.equal(template.articles[0].alias,'Unser Vorstand');assert.deepEqual(template.teamSlugs,['herren-1']);
 assert.deepEqual(applyEditorialCoverTemplate(template,[],[{slug:'herren-1',active:false}]).teamSlugs,[]);
 assert.equal(input.articles[0].id,'old-board');
});
