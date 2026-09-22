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
