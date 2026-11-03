import {trainerPreviewApi} from '/preview-trainer-management.mjs';
import {createCompensationPlan,validateCompensationPlan,compensationSeason} from '/trainer-compensation-model.mjs';
export async function compensationPreviewApi(body){
 const season=compensationSeason(body.season),key='bsv-trainer-compensation-preview:'+season,roster=await trainerPreviewApi({action:'list'});let saved;try{saved=JSON.parse(localStorage.getItem(key)||'null');}catch{}
 if(body.action==='salary_list')return {...roster,season,version:saved?.version||0,plan:saved?.plan||createCompensationPlan(roster,season)};
 if(body.action==='salary_save'){
  if(body.version!==(saved?.version||0))throw new Error('Die Planung wurde inzwischen geändert. Bitte neu laden.');
  const plan=validateCompensationPlan(body.plan);localStorage.setItem(key,JSON.stringify({version:body.version+1,plan}));return {ok:true,version:body.version+1};
 }
 throw new Error('Unbekannte Vergütungsaktion.');
}
