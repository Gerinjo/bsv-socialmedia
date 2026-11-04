import assert from 'node:assert/strict';
import api from '../supabase/functions/social-media-admin-api/index.ts';
import {setResourceApiContext} from './support/resource-api-auth.ts';
import {createCompensationPlan} from '../src/trainer-compensation.mjs';
const roster={teams:[],people:[],assignments:[]};
function setup(areas=['trainer_compensation'],conflict=false){
 const calls:any[]=[];const member={role:'sm-team',is_active:true,is_blocked:false,access_areas:areas};
 const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:member})};
 setResourceApiContext({userClaims:{sub:'salary-actor'},supabaseAdmin:{from:()=>q,rpc:async(name:string,{actor,payload}:any)=>{assert.equal(name,'trainer_compensation_request');assert.equal(actor,'salary-actor');calls.push(payload);return {data:payload.action==='list'?{...roster,version:0,plan:null,seasons:['2024/2025','2025/2026'],savedAt:null}:conflict?{error:'Konflikt',status:409}:{ok:true,version:1}};}}});return calls;
}
const post=(action:string,body={})=>api.fetch(new Request('https://example.test/admin',{method:'POST',body:JSON.stringify({action,season:'2026/2027',...body})}));
Deno.test('actual API requires the dedicated salary right before reading financial data',async()=>{const calls=setup(['trainer_management']);const r=await post('salary_list');assert.equal(r.status,403);assert.deepEqual(calls,[]);});
Deno.test('actual API loads defaults and stores a validated salary plan through the authorized RPC',async()=>{const calls=setup();let r=await post('salary_list');assert.equal(r.status,200);const d=await r.json();assert.equal(d.plan.youthRates.d.licensed,10500);assert.deepEqual(d.seasons,['2024/2025','2025/2026']);assert.equal(d.savedAt,null);r=await post('salary_save',{version:0,plan:createCompensationPlan(roster)});assert.equal(r.status,200);assert.deepEqual(calls.map(c=>c.action),['list','save']);});
Deno.test('actual API rejects invalid salary amounts and retains optimistic concurrency conflicts',async()=>{const calls=setup(undefined,true);const p=createCompensationPlan(roster);p.youthRates.d.base=-1;let r=await post('salary_save',{version:0,plan:p});assert.equal(r.status,400);assert.deepEqual(calls,[]);r=await post('salary_save',{version:0,plan:createCompensationPlan(roster)});assert.equal(r.status,409);});
