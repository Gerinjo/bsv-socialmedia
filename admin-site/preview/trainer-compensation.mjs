import {trainerPreviewApi} from '/preview-trainer-management.mjs';
import {createCompensationPlan,validateCompensationPlan,compensationSeason} from '/trainer-compensation-model.mjs';
const prefix='bsv-trainer-compensation-preview:';
function seasonCatalog(){const result=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;try{const season=compensationSeason(key.slice(prefix.length)),value=JSON.parse(localStorage.getItem(key));if(value?.plan?.season===season&&value.version>0)result.push(season);}catch{}}return result.sort().reverse();}
export async function compensationPreviewApi(body){
 const season=compensationSeason(body.season),key=prefix+season,roster=await trainerPreviewApi({action:'list'});let saved;try{saved=JSON.parse(localStorage.getItem(key)||'null');}catch{}
 if(body.action==='salary_list'){const defaults=createCompensationPlan(roster,season),plan=saved?.plan?validateCompensationPlan({...saved.plan,teams:{...defaults.teams,...saved.plan.teams}}):defaults;return {...roster,season,version:saved?.version||0,plan,seasons:seasonCatalog(),savedAt:saved?.savedAt||null};}
 if(body.action==='salary_save'){
  if(body.version!==(saved?.version||0))throw new Error('Die Planung wurde inzwischen geändert. Bitte neu laden.');
  const plan=validateCompensationPlan(body.plan);if(plan.season!==season)throw new Error('Die Saison der Planung stimmt nicht überein.');localStorage.setItem(key,JSON.stringify({version:body.version+1,plan,savedAt:new Date().toISOString()}));return {ok:true,version:body.version+1};
 }
 throw new Error('Unbekannte Vergütungsaktion.');
}
