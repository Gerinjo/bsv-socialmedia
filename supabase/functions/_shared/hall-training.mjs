import {validateHallDay} from '../../../src/hall-training.mjs';
export async function handleHallTraining(db,actor,body){
 const action=String(body.action).replace(/^hall_/,'');
 if(!['list','save_day','delete_day','book','release'].includes(action))throw new Error('Unbekannte Hallentraining-Aktion.');
 const payload=action==='save_day'?{action,...validateHallDay(body)}:{...body,action};
 const {data,error}=await db.rpc('hall_training_request',{actor,payload});
 if(error)throw Object.assign(new Error('Hallentraining konnte nicht geladen oder gespeichert werden. Bitte die Eingaben prüfen.'),{status:400});
 if(!data||data.error)throw Object.assign(new Error(data?.error||'Hallentraining ist vorübergehend nicht verfügbar.'),{status:data?.status||503});
 return data;
}
