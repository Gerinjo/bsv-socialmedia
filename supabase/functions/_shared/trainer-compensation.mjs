import {createCompensationPlan,validateCompensationPlan,compensationSeason} from '../../../src/trainer-compensation.mjs';
export async function compensationRpc(db,actor,payload){
 const {data,error}=await db.rpc('trainer_compensation_request',{actor,payload});
 if(error)throw Object.assign(new Error('Die Trainervergütung konnte nicht geladen oder gespeichert werden.'),{status:503});
 if(!data||data.error)throw Object.assign(new Error(data?.error||'Trainervergütung vorübergehend nicht verfügbar.'),{status:data?.status||503});
 return data;
}
export async function handleTrainerCompensation(db,actor,body){
 const action=String(body.action||'').replace(/^salary_/,''),season=compensationSeason(body.season);
 // The RPC checks the dedicated financial grant before exposing roster or plan.
 if(action==='list'){
  const data=await compensationRpc(db,actor,{action,season});
  const defaults=createCompensationPlan(data,season);
  data.plan=data.plan?validateCompensationPlan({...data.plan,teams:{...defaults.teams,...data.plan.teams}}):defaults;
  return data;
 }
 if(action==='save'){
  if(!Number.isSafeInteger(body.version)||body.version<0)throw new Error('Ungültiger Datenstand. Bitte neu laden.');
  const plan=validateCompensationPlan(body.plan);if(plan.season!==season)throw new Error('Die Saison der Planung stimmt nicht überein.');
  return compensationRpc(db,actor,{action,season,version:body.version,plan});
 }
 throw new Error('Unbekannte Vergütungsaktion.');
}
