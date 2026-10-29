import {HALL_TRAINING_DATES,validateHallDay} from '/hall-training-model.mjs';
import {previewSuiteProfile,previewSuiteMembers} from '/preview-suite-users.mjs';
const key='bsv-hall-training-preview-v1';
export function hallTrainingPreviewApi(body,persona){
 const user=previewSuiteProfile(persona),admin=user.role==='admin';
 if(!user.accessAreas.includes('hall_training'))throw new Error('Keine Berechtigung für Hallentraining.');
 const state=JSON.parse(localStorage.getItem(key)||'null')||{days:HALL_TRAINING_DATES.map(date=>({id:crypto.randomUUID(),date,startMinute:480,endMinute:1200,blockMinutes:60,version:1})),bookings:[]};
 localStorage.setItem(key,JSON.stringify(state));
 const trainers=previewSuiteMembers().filter(m=>m.suite_role_key==='trainer'&&m.is_active&&!m.is_blocked).map(m=>({userId:m.user_id,personId:null,name:m.display_name}));
 const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
 const act=body.action.replace(/^hall_/,'');
 if(act==='list')return {hall:'BSZ',hallName:'Berufsschulzentrum',admin,trainers:admin?trainers:[],days:state.days.toSorted((a,b)=>a.date.localeCompare(b.date)).map(d=>({...d,slots:Array.from({length:(d.endMinute-d.startMinute)/d.blockMinutes},(_,i)=>{const startMinute=d.startMinute+i*d.blockMinutes,b=state.bookings.find(b=>b.dayId===d.id&&b.startMinute===startMinute);return {startMinute,endMinute:startMinute+d.blockMinutes,past:new Date(`${d.date}T${String(Math.floor(startMinute/60)).padStart(2,'0')}:${String(startMinute%60).padStart(2,'0')}:00`).getTime()<=Date.now(),bookingId:b?.id,trainerName:b?.name,own:b?.userId===user.userId};})}))};
 const day=state.days.find(d=>d.id===body.dayId);
 if(['save_day','delete_day'].includes(act)&&!admin)fail('Nur Admins verwalten Trainingstage.',403);
 if(act==='save_day'){
  const v=validateHallDay(body);
  if(day&&day.version!==v.version)fail('Der Trainingstag wurde geändert.');
  if(day&&state.bookings.some(b=>b.dayId===day.id))fail('Bitte zuerst die bestehenden Buchungen freigeben.');
  if(state.days.some(d=>d.date===v.date&&d!==day))fail('Trainingstag bereits vorhanden.');
  if(body.dayId&&!day)fail('Trainingstag nicht gefunden.',404);
  if(day)Object.assign(day,v,{version:day.version+1});else state.days.push({...v,id:crypto.randomUUID(),version:1});
 }else{
  if(!day)fail('Trainingstag nicht gefunden.',404);
  if(act==='book'){
   if(day.version!==body.version)fail('Die Zeitblöcke wurden geändert.');
   if(state.bookings.some(b=>b.dayId===day.id&&b.startMinute===body.startMinute))fail('Dieser Zeitblock wurde bereits gebucht.');
   if(!admin&&body.trainerUserId)fail('Nur Admins dürfen für andere Trainer buchen.',403);
   const target=admin&&body.trainerUserId?trainers.find(t=>t.userId===body.trainerUserId):{userId:user.userId,name:user.name};
   if(!target)fail('Trainer nicht gefunden.',400);
   state.bookings.push({id:crypto.randomUUID(),dayId:day.id,startMinute:body.startMinute,userId:target.userId,name:target.name});
  }else if(act==='release'){
   const b=state.bookings.find(b=>b.id===body.bookingId&&b.dayId===day.id);
   if(!b)fail('Diese Buchung besteht nicht mehr.');if(!admin&&b.userId!==user.userId)fail('Du kannst nur eigene Buchungen freigeben.',403);
   state.bookings=state.bookings.filter(item=>item!==b);
  }else if(act==='delete_day'){
   if(day.version!==body.version)fail('Trainingstag wurde geändert.');if(state.bookings.some(b=>b.dayId===day.id))fail('Bitte zuerst die Buchungen freigeben.');state.days=state.days.filter(d=>d!==day);
  }else fail('Unbekannte Aktion.',400);
 }
 localStorage.setItem(key,JSON.stringify(state));return {ok:true};
}
