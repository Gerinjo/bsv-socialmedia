import {trainerSortedPeople,validateTrainerPerson,validateTrainerTeam,validateTrainerLifecycle} from '/trainer-management-model.mjs';
import {trainerPreviewSeed} from '/preview-trainer-seed.mjs';
const key='bsv-trainer-management-preview-v2';
function state(){let data;try{data=JSON.parse(localStorage.getItem(key)||'null');}catch{}data||=structuredClone(trainerPreviewSeed);
 const ids=new Map();for(const item of [...data.people,...data.teams])if(item.id.startsWith('demo-')){ids.set(item.id,crypto.randomUUID());item.id=ids.get(item.id);}
 for(const a of data.assignments){a.personId=ids.get(a.personId)||a.personId;a.teamId=ids.get(a.teamId)||a.teamId;}
 if(ids.size)localStorage.setItem(key,JSON.stringify(data));return data;
}
export async function trainerPreviewApi(body){const data=state();const act=body.action.replace('trainer_','');
 if(act==='list'){let staff;try{staff=JSON.parse(localStorage.getItem('bsv-employee-management-preview-v1')||'null');}catch{}return {...data,people:trainerSortedPeople(data.people.map(p=>{const rolePhoto=staff?.assignments?.filter(a=>a.personId===p.id&&a.photo).sort((a,b)=>b.photoUpdated-a.photoUpdated)[0];return p.ownPhoto||!rolePhoto?{...p,photoInherited:false}:{...p,photo_url:rolePhoto.photo,photoInherited:true};}))};}
 let result={ok:true};
 if(['set_active','delete_person'].includes(act)){
  const v=validateTrainerLifecycle(body),p=data.people.find(p=>p.id===v.personId);
  if(!p)throw new Error('Person nicht gefunden.');
  if(p.version!==v.version)throw new Error('Die Person wurde inzwischen geändert. Bitte neu laden.');
  for(const t of data.teams.filter(t=>data.assignments.some(a=>a.teamId===t.id&&a.personId===p.id)))t.version++;
  if(act==='set_active'){p.active=v.active;p.version++;p.updated_at=new Date().toISOString();result={ok:true,version:p.version};}
  else{data.people=data.people.filter(n=>n.id!==p.id);data.assignments=data.assignments.filter(a=>a.personId!==p.id);}
 }else if(act==='save_person'){
  const v=validateTrainerPerson(body);let p=data.people.find(p=>p.id===v.personId);
  if(p&&p.version!==v.version)throw new Error('Die Person wurde inzwischen geändert. Bitte neu laden.');
  if(!p){p={id:crypto.randomUUID(),version:0,photo_url:null};data.people.push(p);}
  const map={firstName:'first_name',lastName:'last_name',websiteName:'website_name',birthDate:'birth_date',publicEmail:'public_email',publicPhone:'public_phone'};
  for(const [k,value] of Object.entries(v)){if(!['personId','version'].includes(k))p[map[k]||k]=value;}p.name=p.first_name+' '+p.last_name;p.version++;p.updated_at=new Date().toISOString();result={ok:true,personId:p.id,version:p.version};
 }else if(act==='upload_photo'){const p=data.people.find(p=>p.id===body.personId);if(!p||p.version!==body.version)throw new Error('Bitte neu laden.');p.photo_url=body.photo;p.ownPhoto=true;p.version++;result={ok:true,version:p.version};}
 else if(['upload_team_photo','remove_team_photo'].includes(act)){const t=data.teams.find(t=>t.id===body.teamId);if(!t||t.version!==body.version)throw new Error('Bitte neu laden.');t.photo_url=act==='upload_team_photo'?body.photo:null;t.photoManaged=true;t.version++;result={ok:true,version:t.version};}
 else if(act==='save_team'){const v=validateTrainerTeam(body),t=data.teams.find(t=>t.id===v.teamId);if(!t||t.version!==v.version)throw new Error('Bitte neu laden.');data.assignments=data.assignments.filter(a=>a.teamId!==t.id).concat(v.assignments.map(a=>({...a,teamId:t.id})));if(v.contactEmails!==undefined)t.contactEmails=v.contactEmails;t.version++;t.managed=true;}
 else throw new Error('Unbekannte Traineraktion.');
 localStorage.setItem(key,JSON.stringify(data));return result;
}
