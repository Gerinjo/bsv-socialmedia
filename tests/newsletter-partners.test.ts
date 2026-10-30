import assert from 'node:assert/strict';
import {prepareNewsletterSponsors} from '../supabase/functions/_shared/newsletter-sponsors.ts';
function database(fail = false) {
 const calls:any[]=[];
 const rows:any={social_sponsors:[
  {id:'youth',name:'Jugendpartner',logo_transparent_path:'approved/youth.png',updated_at:'2026-10-30',website_url:'https://example.org'},
  {id:'stadium',name:'Nur Heft',logo_transparent_path:'approved/stadium.png'},
  {id:'club',name:'Vereinspartner',logo_transparent_path:'approved/club.png'},
 ],social_sponsor_website_assignments:[{sponsor_id:'youth',audience_id:'junior',sponsor_type_id:'team'},{sponsor_id:'stadium',audience_id:'club',sponsor_type_id:'stadium'}],social_post_audiences:[{id:'junior',audience_group:'youth_team'},{id:'club',audience_group:'club'}],social_sponsor_types:[{id:'stadium',slug:'stadionheft'},{id:'team',slug:'teamsponsor'}]};
 const db:any={from:(table:string)=>{const query:any=new Proxy({},{get:(_t,key)=>key==='then'?(resolve:any)=>resolve({data:rows[table],error:null}):(...args:any[])=>{calls.push([table,key,...args]);return query;}});return query;},storage:{from:(bucket:string)=>({copy:async(source:string,target:string,options:any)=>{calls.push(['copy',bucket,source,target,options]);return {error:fail?{statusCode:'503',message:'outage'}:null};},getPublicUrl:(path:string)=>({data:{publicUrl:'https://example.org/public/'+path}})})}};
 return {db,calls};
}
Deno.test('newsletter sponsor pools contain approved contract-valid partners, exclude stadium-only general partners and copy durable logos',async()=>{
 const {db,calls}=database();const issue={id:'issue',publishes_on:'2026-11-06'};
 const result=await prepareNewsletterSponsors(db,issue);
 assert.deepEqual(result.newsletterSponsors.general.map((p:any)=>p.id),['youth','club']);
 assert.deepEqual(result.newsletterSponsors.youth.map((p:any)=>p.id),['youth']);
 assert.ok(result.newsletterSponsors.youth[0].logo.startsWith('https://example.org/public/issue/sponsors/youth-'));
 assert.equal(calls.filter(c=>c[0]==='copy').length,2);
 assert.ok(calls.some(c=>c[1]==='eq'&&c[2]==='logo_status'&&c[3]==='approved'));
 assert.ok(calls.some(c=>c[1]==='or'&&c[2]==='contract_start_date.is.null,contract_start_date.lte.2026-11-06'));
 assert.ok(calls.some(c=>c[1]==='or'&&c[2]==='contract_end_date.is.null,contract_end_date.gte.2026-11-06'));
 const frozen=await prepareNewsletterSponsors({from:()=>{throw Error('must not redraw');}}, {...issue,advertising:result});
 assert.equal(frozen,result);
 const broken=database(true);await assert.rejects(()=>prepareNewsletterSponsors(broken.db,issue),/Logo von Jugendpartner/);
});
