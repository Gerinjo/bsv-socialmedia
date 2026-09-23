import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {paginateEditorialContacts} from '../src/stadium-magazine/editorial-layout.mjs';
import {renderEditorialMagazine} from '../src/stadium-reader.mjs';
const directory=JSON.parse(await readFile(new URL('../config/editorial-contacts.json',import.meta.url)));
test('the contact appendix keeps every group intact, continues on overflow and contains no ads',()=>{
 const groups=Array.from({length:5},(_,id)=>({title:String(id),people:[{name:'Person '+id}]}));
 const pages=paginateEditorialContacts({...directory,groups},p=>200+p.blocks[0].groups.length*550,12);
 assert.deepEqual(pages.map(p=>p.folio),[12,13,14]);
 assert.deepEqual(pages.flatMap(p=>p.blocks[0].groups),groups);
 assert.equal(new Set(pages.map(p=>p.id)).size,3);
 assert.ok(pages.every(p=>p.contactPage&&p.approved&&p.adSlots.length===0));
 const tall=paginateEditorialContacts({...directory,groups:groups.slice(0,1)},()=>1800);
 assert.equal(tall[0].paged,false);
 assert.deepEqual(paginateEditorialContacts({groups:[]},()=>0),[]);
});
test('person links target real name fragments and all adult/youth teams have their own website destination',()=>{
 for(const group of directory.groups)for(const person of group.people){
  assert.ok(person.name&&person.role);
  const url=new URL(person.websiteUrl);
  assert.equal(url.origin,'https://bsvnordstern.de');
  assert.equal(decodeURIComponent(url.hash),'#:~:text='+person.name);
 }
 const slugs=['herren-1','herren-2','frauen-1','frauen-2','u19-junioren','u17-junioren','u15-c1-junioren','u13-d1-junioren'];
 const html=renderEditorialMagazine({id:'issue',title:'Test',publishes_on:'2026-09-27',articles:slugs.map(slug=>({id:slug,team_slug:slug,title:slug,kind:'sports',status:'ready',body:'TABELLE'})),coverMatches:slugs.slice(0,4).map((slug,i)=>({team:['Herren I','Herren II','Frauen I','Frauen II'][i],articleId:slug}))});
 const edition=JSON.parse(html.match(/const editions=(\[.*?\]);const editionSponsorships/s)[1])[0];
 for(const article of edition.articles)assert.equal(article.websiteUrl,directory.teams[article.teamSlug]);
 for(const team of edition.editorialPages.flatMap(p=>p.blocks[0].teams||[]))assert.ok(team.websiteUrl.startsWith(directory.sourceUrl));
 assert.equal(edition.contacts.groups.length,9);
 assert.equal(edition.coverMatches[1].websiteUrl,directory.teams['herren-2']);
});
test('website icons reject unsafe destinations and escape untrusted labels',async()=>{
 const source=await readFile(new URL('../admin-site/stadium-reader/app.js',import.meta.url),'utf8');
 const helper=source.slice(source.indexOf('function clubWebsiteLink('),source.indexOf('function contactDirectoryMarkup('));
 const context=vm.createContext({URL,esc:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
 vm.runInContext(helper,context);
 for(const url of ['javascript:alert(1)','https://bsvnordstern.de.evil.example','//evil.example','https://evil.example','http://bsvnordstern.de/'])assert.equal(context.clubWebsiteLink(url,'Test'),'');
 const html=context.clubWebsiteLink(directory.teams['herren-1'],'<img src=x onerror="alert(1)">');
 assert.doesNotMatch(html,/<img/);assert.match(html,/rel="noopener noreferrer"/);assert.match(html,/target="_blank"/);
});
