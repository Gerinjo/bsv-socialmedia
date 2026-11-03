import test from 'node:test';
import assert from 'node:assert/strict';
import {COMPENSATION_RATES,compensationAge,createCompensationPlan,validateCompensationPlan,compensationReport,compensationCsv,compensationKey} from '../src/trainer-compensation.mjs';
import {handleTrainerCompensation} from '../supabase/functions/_shared/trainer-compensation.mjs';
import {SUITE_AREAS,SUITE_ROLE_SEEDS,suiteNavigationAreas} from '../src/suite-access.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const roster={teams:[{id:id(1),slug:'u13-d1-junioren',name:'BSV D1',active:false},{id:id(2),slug:'frauen-2',name:'SG Frauen 2',active:false}],people:[{id:id(10),name:'Anna Trainer',active:true},{id:id(11),name:'Bea Co',active:true},{id:id(12),name:'Clara',active:true}],assignments:[{teamId:id(1),personId:id(10),slot:'trainer'},{teamId:id(1),personId:id(11),slot:'co1'},{teamId:id(2),personId:id(12),slot:'trainer'}]};
test('photo rates, age classes, ten payments and inactive senior teams are included',()=>{
 assert.deepEqual(Object.values(COMPENSATION_RATES).map(r=>[r.base,r.licensed,r.co]),[[3000,5000,0],[5000,7500,0],[5000,7500,0],[7000,10500,3500],[9000,13500,4500],[10000,15000,5000],[10000,15000,5000]]);
 assert.equal(compensationAge({slug:'u19-junioren'}),'a');assert.equal(compensationAge({slug:'u17-juniorinnen'}),'b');assert.equal(compensationAge({slug:'u15-c1-junioren'}),'c');assert.equal(compensationAge({slug:'u7-bambinis'}),'bambini');
 const p=createCompensationPlan(roster);assert.equal(p.teams[id(2)].payments,10);assert.equal(p.teams[id(2)].included,true);assert.equal(p.teams[id(2)].share,null);assert.equal(p.teams[id(1)].share,100);assert.equal(validateCompensationPlan(p).season,'2026/2027');
});
test('forecast uses a license range, reports missing active rates and SG shares, then exact monthly-cent-rounded shares',()=>{
 const p=createCompensationPlan(roster);let report=compensationReport(roster,p);assert.equal(report.totals.seasonMin,105000);assert.equal(report.totals.seasonMax,140000);assert.equal(report.totals.uncertain,1);assert.equal(report.totals.incomplete,1);
 p.assignments[compensationKey(roster.assignments[0])]={license:'valid',monthly:null,payments:null};p.teams[id(2)].head=100000;p.teams[id(2)].share=33.33;report=compensationReport(roster,p);
 assert.equal(report.totals.seasonMin,473300);assert.equal(report.totals.seasonMax,473300);assert.equal(report.totals.incomplete,0);assert.equal(report.totals.positions,3);
 p.teams[id(1)].share=33.33;p.assignments[compensationKey(roster.assignments[0])]={license:'none',monthly:7000,payments:7};const r=compensationReport(roster,p).teams[0].rows[0];assert.equal(r.monthlyMin,2333);assert.equal(r.seasonMin,16331);
});
test('vacancies are explicit reserves, inactive people and excluded teams do not inflate the budget',()=>{
 const p=createCompensationPlan(roster);p.teams[id(2)].head=100000;p.teams[id(2)].co=50000;p.teams[id(2)].share=50;p.teams[id(2)].reserveVacancies=true;
 const report=compensationReport(roster,p);assert.equal(report.teams[1].rows.find(r=>r.vacant).seasonMax,250000);
 p.teams[id(2)].included=false;const passive={...roster,people:roster.people.map(p=>({...p,active:false}))};assert.equal(compensationReport(passive,p).totals.seasonMax,0);
});
test('invalid money, payment counts, fractional cents, dates, percentages and injected roles are rejected',()=>{
 for(const edit of [p=>p.youthRates.d.base=-1,p=>p.youthRates.d.base=70.5,p=>p.teams[id(1)].share=101,p=>p.teams[id(1)].payments=13,p=>p.season='2026/2028',p=>p.youthRates.d.licensed=500,p=>p.assignments['<script>']={license:'valid',monthly:0,payments:1}]){const p=createCompensationPlan(roster);edit(p);assert.throws(()=>validateCompensationPlan(p));}
});
test('only the dedicated right opens compensation; employee grants alone do not include salaries',()=>{
 assert.ok(SUITE_AREAS.includes('trainer_compensation'));assert.ok(suiteNavigationAreas(['trainer_compensation']).includes('trainer_compensation'));
 for(const role of SUITE_ROLE_SEEDS.filter(r=>r.key!=='admin'))assert.ok(!role.access_areas.includes('trainer_compensation'));
});
test('API keeps financial permission errors and conflicts, validates before writing, and seeds current roster defaults',async()=>{
 const calls=[];const db={rpc:async(name,{actor,payload})=>{calls.push(payload);if(actor==='denied')return {data:{error:'Keine Berechtigung',status:403}};return {data:payload.action==='list'?{...roster,version:0,plan:null}:{error:'Konflikt',status:409}};}};
 await assert.rejects(()=>handleTrainerCompensation(db,'denied',{action:'salary_list',season:'2026/2027'}),e=>e.status===403);
 const data=await handleTrainerCompensation(db,'admin',{action:'salary_list',season:'2026/2027'});assert.equal(data.plan.teams[id(2)].payments,10);
 await assert.rejects(()=>handleTrainerCompensation(db,'admin',{action:'salary_save',season:'2026/2027',version:0,plan:data.plan}),e=>e.status===409);
 const count=calls.length;await assert.rejects(()=>handleTrainerCompensation(db,'admin',{action:'salary_save',season:'2026/2027',version:-1,plan:data.plan}));assert.equal(calls.length,count);
});
test('CSV includes open fields and neutralizes spreadsheet formulas in names',()=>{
 const data={...roster,people:roster.people.map(p=>({...p,name:'=1+1'}))};const csv=compensationCsv(compensationReport(data,createCompensationPlan(data)));assert.match(csv,/"'=1\+1"/);assert.match(csv,/BSV Saison max EUR/);assert.match(csv,/Monatsbetrag fehlt/);assert.ok(csv.startsWith('\ufeff'));
});
