import assert from 'node:assert/strict';
import {prepareEditorialPeople,publicEditorialPeople,refreshEditorialPeople,withEditorialPeople} from '../supabase/functions/_shared/editorial-people.ts';
const id='00000000-0000-4000-8000-000000000001';
const rolePath=id+'/'+'b'.repeat(64)+'.png',trainerPath=id+'/'+'c'.repeat(64)+'.png';
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
const catalog=[{id,display_name:'Anna Beispiel',active:true,roles:['Jugendleiter','1. Vorstand'],photo_source:{bucket:'trainer-portraits',path:trainerPath},role_photos:[{role:'Jugendleiter',photo_source:{bucket:'employee-portraits',path:rolePath}}],teams:[{team_id:'first',role:'Trainer',photo_source:{bucket:'trainer-portraits',path:trainerPath}}]}];
function portraitDb(){
 const downloads:string[]=[],uploads:string[]=[],removed:string[]=[],copies:string[]=[];let copyError:any=null;
 const db={rpc:async(name:string)=>{assert.equal(name,'editorial_people_catalog');return {data:catalog,error:null};},storage:{from(bucket:string){return {
  download:async(path:string)=>{downloads.push(bucket+'/'+path);return {data:new Blob([png],{type:'image/png'}),error:null};},
  upload:async(path:string)=>{assert.equal(bucket,'editorial-portraits');uploads.push(path);return {error:null};},
  remove:async(paths:string[])=>{removed.push(...paths);return {error:null};},
  copy:async(from:string,to:string,options:any)=>{assert.equal(bucket,'editorial-portraits');assert.equal(from,to);assert.equal(options.destinationBucket,'editorial-public-images');copies.push(from);return {error:copyError};},
  getPublicUrl:(path:string)=>{assert.equal(bucket,'editorial-public-images');return {data:{publicUrl:'https://example.org/storage/v1/object/public/'+bucket+'/'+path}};},
  createSignedUrl:async(path:string)=>({data:{signedUrl:'https://example.org/storage/v1/object/sign/'+bucket+'/'+path+'?token=temporary'},error:null}),
 };}}};
 return {db,downloads,uploads,removed,copies,setCopyError:(error:any)=>{copyError=error;}};
}
Deno.test('editorial portraits use the current role or trainer source and reuse only matching archived identities',async()=>{
 const state=portraitDb(),{db}=state;
 const youth=await prepareEditorialPeople(db,'issue',{kind:'youth'},[id],()=>{throw new Error('must not fetch old website');});
 const coach=await prepareEditorialPeople(db,'issue',{kind:'coach',team_id:'first'},[id]);
 assert.deepEqual(state.downloads,['employee-portraits/'+rolePath,'trainer-portraits/'+trainerPath]);
 assert.equal(youth.people[0].source_photo_url,'employee-portraits/'+rolePath);
 await prepareEditorialPeople(db,'issue',{kind:'youth',people_snapshot:youth.people},[id]);
 assert.equal(state.uploads.length,2);assert.equal(state.downloads.length,2);
 const changed=await prepareEditorialPeople(db,'issue',{kind:'youth',people_snapshot:coach.people},[id]);
 assert.notEqual(changed.people[0].photo_path,coach.people[0].photo_path);
 await changed.cleanup();assert.deepEqual(state.removed,[changed.people[0].photo_path]);
 const visible=await publicEditorialPeople(db,catalog);
 assert.equal(visible[0].has_photo,true);assert.equal(visible[0].photo_url,null);assert.ok(!JSON.stringify({...visible[0],photo_url:null}).includes(trainerPath));
 assert.equal(visible[0].photo_source,undefined);assert.equal(visible[0].teams[0].photo_source,undefined);
});
Deno.test('newsletter portraits get permanent copies of the frozen archive, including magazine imports',async()=>{
 const state=portraitDb(),{db}=state;
 const snapshot={kind:'newsletter',articles:[{people:[{name:'Anna',role:'Vorstand',photo_path:'old-issue/frozen.png'},{name:'Ohne Bild',photo_path:null}]}]};
 const mail=await withEditorialPeople(db,snapshot,{permanent:true});
 assert.deepEqual(state.copies,['old-issue/frozen.png']);
 assert.ok(mail.articles[0].people[0].photo_url.includes('/object/public/editorial-public-images/old-issue/frozen.png'));
 assert.equal(mail.articles[0].people[0].photo_path,undefined);assert.equal(mail.articles[0].people[1].photo_url,null);
 assert.equal(state.downloads.length,0);
 state.setCopyError({statusCode:'409',message:'already exists'});
 const imported=await withEditorialPeople(db,{...snapshot,kind:'stadium'},{permanent:true});
 assert.equal(imported.articles[0].people[0].photo_url,mail.articles[0].people[0].photo_url);
 const stadium=await withEditorialPeople(db,{...snapshot,kind:'stadium'});
 assert.ok(stadium.articles[0].people[0].photo_url.includes('/object/sign/'));
 state.setCopyError({statusCode:'503',message:'unavailable'});
 await assert.rejects(()=>withEditorialPeople(db,snapshot,{permanent:true}),/Newsletter nicht verfügbar/);
});
Deno.test('draft portrait refresh guards article versions, bumps the issue version and cleans a failed replacement',async()=>{
 const state=portraitDb(),queries:any[]=[];
 const old={id:'article',kind:'youth',status:'ready',version:4,people_snapshot:[{person_id:id,name:'Anna Beispiel',role:'Jugendleiter',source_photo_url:'old',photo_path:'issue/old.png'}]};
 let succeed=true;
 const db={...state.db,from(table:string){assert.equal(table,'editorial_articles');const call:any={filters:[]};queries.push(call);const q:any={select(){return q;},eq(key:string,value:any){call.filters.push([key,value]);return q;},update(value:any){call.update=value;return q;},maybeSingle(){return Promise.resolve({data:succeed?{id:'article'}:null,error:null});},then(resolve:any){resolve({data:[old],error:null});}};return q;}};
 const version=await refreshEditorialPeople(db,{id:'issue',version:7},'actor');
 assert.equal(version,8);assert.ok(queries[1].filters.some(([key,value]:any[])=>key==='version'&&value===4));
 assert.equal(queries[1].update.updated_by,'actor');assert.equal(old.people_snapshot[0].photo_path,'issue/old.png');
 old.people_snapshot=queries[1].update.people_snapshot;
 assert.equal(await refreshEditorialPeople(db,{id:'issue',version:8},'actor'),8);
 old.people_snapshot=[{...old.people_snapshot[0],source_photo_url:'changed'}];succeed=false;
 await assert.rejects(()=>refreshEditorialPeople(db,{id:'issue',version:8},'actor'),/während der Bildaktualisierung/);
 assert.equal(state.removed.length,1);assert.equal(state.removed[0],state.uploads.at(-1));
});
