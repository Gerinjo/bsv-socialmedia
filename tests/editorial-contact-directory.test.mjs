import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialContactDirectory} from '../src/editorial-contacts.mjs';
const data={assignments:[{groupKey:'executive',personId:'chair',name:'Aktueller Vorstand',role:'1. Vorstand',email:'PRIVATE',photoSource:{path:'PRIVATE'}},{groupKey:'executive',personId:'chair',name:'Aktueller Vorstand',role:'Verantwortlich'},{groupKey:'youth',personId:null,role:'Jugendleitung'},{groupKey:'board',personId:'removed',name:'ENTFERNT',role:'Alt',active:false},{groupKey:'supporters',personId:'supporter',name:'Förderverein neu',role:'Vorstand'}],teams:[{name:'Erste Herren',slug:'herren-1',website_path:'fussball/herren/bezirksliga'},{name:'U13',slug:'u13',website_path:'jugend/u13/'}],trainerTeams:[{path:'/fussball/herren/bezirksliga/',coaches:[{name:'Aktueller Trainer',role:'Trainer',email:'PRIVATE',phone:'PRIVATE',photoSource:'PRIVATE'}]},{path:'jugend/u13',coaches:[{name:'Jugendtrainer',role:'Co-Trainer'}]}]};
test('contact directory follows current employee roles, vacancies, all visible trainer teams and supporter assignments',()=>{
 const result=editorialContactDirectory(data,{now:'2026-10-14T23:00:00Z'});
 assert.equal(result.verifiedAt,'2026-10-15');assert.equal(result.source,'suite');
 assert.deepEqual(result.groups.map(group=>group.title),['Geschäftsvorstandschaft','Jugendausschuss','Trainerteam · Erste Herren','Trainerteam · U13','Förderverein']);
 assert.equal(result.groups[0].people[0].role,'1. Vorstand · Verantwortlich');assert.equal(result.groups[0].people.length,1);
 assert.equal(result.groups[1].people[0].name,'Aktuell vakant');assert.equal(result.groups[1].people[0].websiteUrl,null);
 assert.equal(new URL(result.groups[3].people[0].websiteUrl).origin,'https://bsvnordstern.de');
 assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(!JSON.stringify(result).includes('ENTFERNT'));
});
test('configuration changes replace contacts without changing the old directory, and an empty configuration stays empty',()=>{
 const first=editorialContactDirectory(data);
 const changed=structuredClone(data);changed.assignments[0].name='Neuer Vorstand';changed.assignments[1].name='Neuer Vorstand';changed.trainerTeams[0].coaches=[];
 const second=editorialContactDirectory(changed);
 assert.equal(second.groups[0].people[0].name,'Neuer Vorstand');assert.equal(first.groups[0].people[0].name,'Aktueller Vorstand');
 assert.ok(!second.groups.some(group=>group.teamSlug==='herren-1'));
 assert.deepEqual(editorialContactDirectory({assignments:[],trainerTeams:[],teams:[]}).groups,[]);
 assert.throws(()=>editorialContactDirectory({...data,assignments:null}),/unvollständig/);
 const invalid=editorialContactDirectory({...data,teams:[{name:'Bad',slug:'bad',website_path:'https://evil.example/'}]});
 assert.deepEqual(invalid.teams,{});
});
