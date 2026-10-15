import test from 'node:test';
import assert from 'node:assert/strict';
import { editorialPersonCandidates, selectEditorialPeople } from '../src/editorial-people.mjs';
import { editorialPublicSnapshot } from '../src/editorial-publication.mjs';
const people=[{id:'chair',display_name:'Vorstand',roles:['1. Vorstand']},{id:'vice',display_name:'Vertretung',roles:['2. Vorstand']},
 {id:'youth',display_name:'Jugend',roles:['Stellvertretender Jugendleiter']},
 {id:'coach',display_name:'Trainer',roles:['Trainer'],teams:[{team_id:'first',role:'Co-Trainer'}]},
 {id:'other',display_name:'Anderes Team',teams:[{team_id:'second',role:'Trainer'}]}];
test('candidates follow office and the coaching role within the exact team',()=>{
 assert.deepEqual(editorialPersonCandidates({kind:'board'},people).map(p=>p.id),['chair','vice']);
 assert.deepEqual(editorialPersonCandidates({kind:'youth'},people).map(p=>p.id),['youth']);
 assert.deepEqual(editorialPersonCandidates({kind:'coach',team_id:'first'},people).map(p=>p.id),['coach']);
 assert.throws(()=>selectEditorialPeople({kind:'coach',team_id:'first'},people,['other']),/Funktion/);
 assert.equal(selectEditorialPeople({kind:'board'},people,['chair','vice']).length,2);
});
test('public people contain no internal IDs or source data and cannot mutate saved portraits',()=>{
 const original={person_id:'PRIVATE',source_photo_url:'PRIVATE SOURCE',name:'Vorstand',role:'1. Vorstand',photo_path:'frozen/photo.jpg'};
 const snapshot=editorialPublicSnapshot({kind:'stadium'},[{people_snapshot:[original]}]);
 original.name='Changed';
 assert.equal(snapshot.articles[0].people[0].name,'Vorstand');
 assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE/);
});

test('free contributions can choose active people and greetings keep their matching role portrait',()=>{
 const person={id:'shared',display_name:'Anna',roles:['1. Vorstand','Jugendleiter'],photo_source:{path:'default'},role_photos:[{role:'1. Vorstand',photo_source:{path:'board'}},{role:'Jugendleiter',photo_source:{path:'youth'}}],teams:[{team_id:'first',role:'Trainer',photo_source:{path:'trainer'}}]};
 assert.equal(selectEditorialPeople({kind:'board'},[person],['shared'])[0].photo_source.path,'board');
 assert.equal(selectEditorialPeople({kind:'youth'},[person],['shared'])[0].photo_source.path,'youth');
 assert.equal(selectEditorialPeople({kind:'coach',team_id:'first'},[person],['shared'])[0].photo_source.path,'trainer');
 assert.equal(selectEditorialPeople({kind:'free'},[person],['shared']).length,1);
 assert.equal(selectEditorialPeople({kind:'free'},[person],['shared'])[0].photo_source.path,'default');
 assert.equal(editorialPersonCandidates({kind:'free'},[{id:'member',display_name:'Mitglied',roles:[]}])[0].role,'Vereinsmitglied');
 assert.deepEqual(editorialPersonCandidates({kind:'free'},[{...person,active:false}]),[]);
});

test('the same youth role on the board never replaces the youth departments own portrait',()=>{
 const person={id:'shared',display_name:'Anna',roles:['Jugendleiter'],role_photos:[{group:'board',role:'Jugendleiter',photo_source:{path:'board'}},{group:'youth',role:'Jugendleiter',photo_source:{path:'youth'}}]};
 assert.equal(selectEditorialPeople({kind:'youth'},[person],['shared'])[0].photo_source.path,'youth');
 assert.deepEqual(editorialPersonCandidates({kind:'youth'},[{...person,role_photos:person.role_photos.slice(0,1)}]),[]);
});
