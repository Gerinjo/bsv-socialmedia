import test from 'node:test';
import assert from 'node:assert/strict';
import {trainerOnlyTeam,trainerSlotLabels,trainerAssignmentRole,trainerPublicRole} from '../src/trainer-team-roles.mjs';
import {createCompensationPlan,compensationReport} from '../src/trainer-compensation.mjs';
const teamId='00000000-0000-4000-8000-000000000001';
test('G/F/E have only Trainer roles across Suite slugs and homepage paths; D and older retain Co-Trainer',()=>{
 for(const slug of ['u6-spielgruppe','u7-bambinis','u8-f-junioren','u9-f-junioren','u11-e1-junioren']){
  const t={slug};assert.equal(trainerOnlyTeam(t),true);assert.doesNotMatch(Object.values(trainerSlotLabels(t)).join(' '),/Co-Trainer/);
  for(const slot of ['trainer','co1','co2','extra-1'])assert.equal(trainerAssignmentRole(t,{slot,websiteRole:'Co-Trainerin'}),'Trainer');
 }
 assert.equal(trainerOnlyTeam({path:'jugend/u11-e2'}),true);assert.equal(trainerPublicRole({path:'jugend/u7-g'},'Co-Trainerin'),'Trainer');
 for(const slug of ['u13-d1-junioren','u15-c1-junioren','u17-juniorinnen','herren-1','frauen-2']){assert.equal(trainerOnlyTeam({slug}),false);assert.equal(trainerSlotLabels({slug}).co1,'Co-Trainer 1');}
 assert.equal(trainerAssignmentRole({slug:'u9-f-junioren'},{slot:'betreuer',websiteRole:'Betreuer'}),'Betreuer');
});
test('all G/F/E trainer positions receive their trainer rate and individual license range; no extra Co vacancy',()=>{
 for(const slug of ['u7-bambinis','u9-f-junioren','u11-e1-junioren']){
  const roster={teams:[{id:teamId,slug,name:'BSV'}],people:[{id:'a',name:'A',active:true},{id:'b',name:'B',active:true}],assignments:[{teamId,personId:'a',slot:'trainer'},{teamId,personId:'b',slot:'co1',websiteRole:'Co-Trainer'}]};
  const plan=createCompensationPlan(roster),report=compensationReport(roster,plan),rate=plan.youthRates[plan.teams[teamId].age];assert.equal(report.totals.seasonMin,rate.base*20);assert.equal(report.totals.seasonMax,rate.licensed*20);assert.equal(report.totals.uncertain,2);assert.equal(report.teams[0].rows[1].role,'trainer');assert.equal(report.teams[0].rows[1].websiteRole,'Trainer');
  roster.assignments=roster.assignments.slice(0,1);assert.equal(compensationReport(roster,plan).teams[0].rows.length,1);
 }
});
