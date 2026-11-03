import {compensationSeason,createCompensationPlan,validateCompensationPlan} from '../../../src/trainer-compensation.mjs';
import {financialDirectoryPhotos} from './trainer-financial-photos.mjs';
export async function handleTrainerFinances(db,actor,body){
 if(body.action!=='finance_list')throw new Error('Unbekannte Finanz-Auswertung.');const season=compensationSeason(body.season),{data,error}=await db.rpc('trainer_finances_request',{actor,payload:{action:'list',season}});
 if(error)throw Object.assign(new Error('Die Finanzübersicht konnte nicht geladen werden.'),{status:503});if(!data||data.error)throw Object.assign(new Error(data?.error||'Finanzübersicht vorübergehend nicht verfügbar.'),{status:data?.status||503});
 // Defense in depth: ordinary salary rights never receive contract decision data.
 if(data.canViewDecisions!==true)data.contracts=[];
 const defaults=createCompensationPlan(data,season);data.plan=data.plan?validateCompensationPlan({...data.plan,teams:{...defaults.teams,...data.plan.teams}}):defaults;return financialDirectoryPhotos(db,data);
}
