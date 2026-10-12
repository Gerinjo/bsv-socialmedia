export const TRAINER_SLOTS = {trainer:'Trainer',co1:'Co-Trainer 1',co2:'Co-Trainer 2',betreuer:'Betreuer'};
export const TRAINER_PHOTO_BUCKET = 'trainer-portraits';
export function trainerSortedPeople(people){return [...people].sort((a,b)=>String(a.last_name).localeCompare(String(b.last_name),'de',{sensitivity:'base'})||String(a.first_name).localeCompare(String(b.first_name),'de',{sensitivity:'base'}));}
export function validateTrainerPerson(body){
 const limits={firstName:80,lastName:100,websiteName:180,email:254,phone:50,mobile:50,street:160,postcode:20,city:100,qualification:300,club:180,notes:3000};
 const result={personId:body.personId||null,version:Number(body.version),active:body.active!==false,publicEmail:body.publicEmail===true,publicPhone:body.publicPhone===true,birthDate:String(body.birthDate||'')};
 if(!Number.isSafeInteger(result.version)||result.version<0)throw new Error('Ungültiger Stand der Person. Bitte neu laden.');
 for(const [key,max] of Object.entries(limits)){result[key]=String(body[key]||'').trim();if(result[key].length>max)throw new Error('Bitte die Eingaben kürzen.');}
 if(!result.firstName||!result.lastName)throw new Error('Bitte Vor- und Nachname eingeben.');
 result.email=result.email.toLowerCase();if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
 if(result.birthDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(result.birthDate)||Number.isNaN(Date.parse(result.birthDate))||new Date(result.birthDate).toISOString().slice(0,10)!==result.birthDate))throw new Error('Bitte ein gültiges Geburtsdatum eingeben.');
 return result;
}
export function validateTrainerTeam(body){
 if(!Number.isSafeInteger(body.version)||body.version<1||!Array.isArray(body.assignments)||body.assignments.length>20)throw new Error('Ungültige Zuordnung.');
 const slots=new Set(),people=new Set();
 for(const a of body.assignments){if(!Object.hasOwn(TRAINER_SLOTS,a.slot)&&!/^extra-[1-9][0-9]?$/.test(a.slot))throw new Error('Ungültige Position.');if(!a.personId||slots.has(a.slot)||people.has(a.personId))throw new Error('Jede Person und Position darf pro Mannschaft nur einmal belegt sein.');slots.add(a.slot);people.add(a.personId);if(String(a.websiteRole||'').length>100)throw new Error('Bitte die Rollenbezeichnung kürzen.');}
 return {teamId:body.teamId,version:body.version,assignments:body.assignments.map(a=>({slot:a.slot,personId:a.personId,websiteVisible:a.websiteVisible===true,websiteRole:String(a.websiteRole||'').trim()}))};
}

export function trainerFilterPeople(people,status='active'){
 if(!['active','passive','all'].includes(status))throw new Error('Ungültiger Trainerstatus.');
 return trainerSortedPeople(people.filter(p=>status==='all'||(status==='active'?p.active!==false:p.active===false)));
}
export function validateTrainerLifecycle(body){
 if(!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(body.personId||'')||!Number.isSafeInteger(body.version)||body.version<1)throw new Error('Bitte eine gespeicherte Person auswählen und neu laden.');
 const action=String(body.action).replace(/^trainer_/,'');
 if(action==='delete_person'&&body.confirmed!==true)throw new Error('Bitte das Löschen ausdrücklich bestätigen.');
 if(action==='set_active'&&typeof body.active!=='boolean')throw new Error('Bitte den Trainerstatus auswählen.');
 return {personId:body.personId,version:body.version,...(action==='set_active'?{active:body.active}:{confirmed:true})};
}
