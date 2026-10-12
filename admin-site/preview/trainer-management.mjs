import {trainerSortedPeople,validateTrainerPerson,validateTrainerTeam} from '/trainer-management-model.mjs';
import {trainerPreviewSeed} from '/preview-trainer-seed.mjs';
const key='bsv-trainer-management-preview-v2';
function state(){try{const value=JSON.parse(localStorage.getItem(key)||'null');if(value)return value;}catch{}return structuredClone(trainerPreviewSeed);}
export async function trainerPreviewApi(body){const data=state();const act=body.action.replace('trainer_','');
 if(act==='list')return {...data,people:trainerSortedPeople(data.people)};
 let result={ok:true};
 if(act==='save_person'){
  const v=validateTrainerPerson(body);let p=data.people.find(p=>p.id===v.personId);
  if(p&&p.version!==v.version)throw new Error('Die Person wurde inzwischen geändert. Bitte neu laden.');
  if(!p){p={id:crypto.randomUUID(),version:0,photo_url:null};data.people.push(p);}
  const map={firstName:'first_name',lastName:'last_name',websiteName:'website_name',birthDate:'birth_date',publicEmail:'public_email',publicPhone:'public_phone'};
  for(const [k,value] of Object.entries(v)){if(!['personId','version'].includes(k))p[map[k]||k]=value;}p.name=p.first_name+' '+p.last_name;p.version++;p.updated_at=new Date().toISOString();result={ok:true,personId:p.id,version:p.version};
 }else if(act==='upload_photo'){const p=data.people.find(p=>p.id===body.personId);if(!p||p.version!==body.version)throw new Error('Bitte neu laden.');p.photo_url=body.photo;p.version++;result={ok:true,version:p.version};}
 else if(act==='save_team'){const v=validateTrainerTeam(body),t=data.teams.find(t=>t.id===v.teamId);if(!t||t.version!==v.version)throw new Error('Bitte neu laden.');data.assignments=data.assignments.filter(a=>a.teamId!==t.id).concat(v.assignments.map(a=>({...a,teamId:t.id})));t.version++;t.managed=true;}
 else throw new Error('Unbekannte Traineraktion.');
 localStorage.setItem(key,JSON.stringify(data));return result;
}
