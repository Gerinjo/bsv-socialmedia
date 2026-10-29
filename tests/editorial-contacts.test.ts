import assert from 'node:assert/strict';
import {withEditorialContacts} from '../supabase/functions/_shared/editorial-contacts.ts';
Deno.test('every stadium retrieval resolves current configuration without altering the published snapshot',async()=>{
 let name='Aktueller Vorstand';let failed=false;const calls:string[]=[];
 const db={rpc:async(action:string)=>{calls.push(action);return {data:action==='website_employee_groups'?{assignments:[{groupKey:'executive',personId:'person',name,role:'Vorstand'}]}:{teams:[]},error:failed?true:null};},from:(table:string)=>{assert.equal(table,'social_teams');const q:any={select(){return q;},order(){return q;},then(resolve:any){resolve({data:[],error:null});}};return q;}};
 const snapshot={kind:'stadium',version:3,articles:[{body:'Veröffentlicht'}],contacts:{groups:[{people:[{name:'ALT'}]}]}};
 const first=await withEditorialContacts(db,snapshot);assert.equal(first.contacts.groups[0].people[0].name,name);
 name='Neuer Vorstand';const second=await withEditorialContacts(db,snapshot);assert.equal(second.contacts.groups[0].people[0].name,name);
 assert.equal(snapshot.contacts.groups[0].people[0].name,'ALT');assert.equal(first.articles,snapshot.articles);assert.equal(second.version,3);
 failed=true;await assert.rejects(()=>withEditorialContacts(db,snapshot),/Kontaktübersicht konnte nicht geladen/);
 const count=calls.length;const newsletter={kind:'newsletter'};assert.equal(await withEditorialContacts(db,newsletter),newsletter);assert.equal(calls.length,count);
});
