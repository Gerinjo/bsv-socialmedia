import {validateEmployeeAssignment,validateEmployeePhoto,validateEmployeeContact} from '/employee-management-model.mjs';
import {trainerPreviewApi} from '/preview-trainer-management.mjs';
const key='bsv-employee-management-preview-v1';
async function state(){let data;try{data=JSON.parse(localStorage.getItem(key)||'null');}catch{}if(data)return data;
 const [seed,trainers]=await Promise.all([fetch('/employee-role-seed.json').then(r=>r.json()),trainerPreviewApi({action:'list'})]);
 data={people:trainers.people.map(p=>({id:p.id,name:p.name,active:p.active})),assignments:[]};
 for(const entry of seed.entries){let p=data.people.find(p=>p.name===entry.name);if(entry.name!=='Aktuell vakant'&&!p){p={id:crypto.randomUUID(),name:entry.name,active:true};data.people.push(p);}const id=crypto.randomUUID();data.assignments.push({id,personId:p?.id||null,groupKey:entry.groupKey,roleLabel:entry.role,roleKey:'role-'+id,name:p?.name||'Noch nicht besetzt',version:1,sourceImage:entry.image});}
 localStorage.setItem(key,JSON.stringify(data));return data;
}
export async function employeePreviewApi(body){const data=await state(),action=body.action.replace(/^employee_/,'');
 if(action==='list'){
  const trainers=await trainerPreviewApi({action:'list'});
  return {...data,people:[...new Map([...data.people,...trainers.people.map(p=>({id:p.id,name:p.name,active:p.active,...p,contactSource:'trainer',contactVersion:p.version,publicPhone:p.public_phone}))].map(p=>[p.id,p])).values()].map(p=>({...p,contactSource:p.contactSource||'employee',contactVersion:p.contactVersion||0})),assignments:data.assignments.map(a=>{const other=data.assignments.filter(other=>other.personId===a.personId&&other.photo).sort((x,y)=>y.photoUpdated-x.photoUpdated)[0],t=trainers.people.find(p=>p.id===a.personId),image=a.photo||other?.photo||(t?.photoInherited?null:t?.photo_url)||a.sourceImage;return {...a,name:data.people.find(p=>p.id===a.personId)?.name||'Noch nicht besetzt',photo_url:image,hasOwnPhoto:Boolean(a.photo),photoInherited:!a.photo&&Boolean(other?.photo||t?.ownPhoto),photo:undefined};})};
 }
 let result={ok:true};
 if(action==='save_assignment'){
  const v=validateEmployeeAssignment(body);let a=data.assignments.find(a=>a.id===v.assignmentId);
  if(v.assignmentId&&(!a||a.version!==v.version))throw new Error('Die Rolle wurde inzwischen geändert. Bitte neu laden.');
  let personId=v.personId;if(!personId&&v.firstName){const name=v.firstName+' '+v.lastName;if(data.people.some(p=>p.name.toLowerCase()===name.toLowerCase()))throw new Error('Diese Person gibt es bereits.');personId=crypto.randomUUID();data.people.push({id:personId,name,active:true});}
  if(!a){a={id:crypto.randomUUID(),version:0};a.roleKey='role-'+a.id;data.assignments.push(a);}
  Object.assign(a,v,{personId});a.version++;result={ok:true,assignmentId:a.id,personId,version:a.version};
 }else if(action==='save_contact'){const v=validateEmployeeContact(body);const p=data.people.find(p=>p.id===v.personId);if(!p)throw new Error('Person nicht gefunden.');if(v.contactSource==='trainer'){const trainers=await trainerPreviewApi({action:'list'}),t=trainers.people.find(t=>t.id===v.personId);if(!t||t.version!==v.version)throw new Error('Die Kontaktdaten wurden inzwischen geändert. Bitte neu laden.');await trainerPreviewApi({action:'save_person',...t,...v,firstName:t.first_name,lastName:t.last_name,websiteName:t.website_name,birthDate:t.birth_date,publicEmail:t.public_email});}else{if((p.contactVersion||0)!==v.version)throw new Error('Die Kontaktdaten wurden inzwischen geändert. Bitte neu laden.');Object.assign(p,v,{contactVersion:v.version+1});}
 }else if(action==='remove_assignment'){const a=data.assignments.find(a=>a.id===body.assignmentId);if(!a||a.version!==body.version)throw new Error('Bitte neu laden.');data.assignments=data.assignments.filter(x=>x.id!==a.id);
 }else if(['upload_photo','clear_photo'].includes(action)){
  const v=validateEmployeePhoto(body),a=data.assignments.find(a=>a.roleKey===v.roleKey&&a.personId===v.personId);if(!a||a.version!==v.version)throw new Error('Bitte neu laden.');a.photo=action==='upload_photo'?body.photo:null;a.photoUpdated=Date.now();a.version++;
 }else throw new Error('Unbekannte Mitarbeiteraktion.');
 localStorage.setItem(key,JSON.stringify(data));return result;
}
