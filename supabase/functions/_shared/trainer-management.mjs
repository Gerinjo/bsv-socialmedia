import {employeePhotoUrl} from './employee-management.mjs';
import {TEAM_PHOTO_BUCKET,TRAINER_PHOTO_BUCKET,validateTrainerPerson,validateTrainerTeam,validateTrainerLifecycle} from '../../../src/trainer-management.mjs';
import {decodeRefereeReceipt,receiptHash} from './referee-receipts.mjs';
export async function trainerRpc(db,actor,payload){
 const {data,error}=await db.rpc('trainer_management_request',{actor,payload});
 if(error)throw Object.assign(new Error('Die Trainerdaten konnten nicht gespeichert oder geladen werden. Bitte die Eingaben prüfen und erneut versuchen.'),{status:400});
 if(!data||data.error)throw Object.assign(new Error(data?.error||'Trainerverwaltung vorübergehend nicht verfügbar.'),{status:data?.status||503});
 return data;
}
export async function trainerPhotoUrl(db,path){
 const {data,error}=await db.storage.from(TRAINER_PHOTO_BUCKET).createSignedUrl(path,3600);
 if(error)throw Object.assign(new Error('Das Trainerfoto ist vorübergehend nicht verfügbar.'),{status:503});
 return data.signedUrl;
}
export async function handleTrainerManagement(db,actor,body){
 const action=String(body.action).replace(/^trainer_/,'');
 if(action==='list'){
  const data=await trainerRpc(db,actor,{action});
  data.people=await Promise.all(data.people.map(async p=>{const {photo_path,website_photo_url,photoSource,...safe}=p;return {...safe,photo_url:photoSource?await employeePhotoUrl(db,photoSource):photo_path?await trainerPhotoUrl(db,photo_path):p.source_photo_url,photoInherited:photoSource?.inherited===true};}));
  data.teams=data.teams.map(({photoPath,...team})=>({...team,photo_url:photoPath?db.storage.from(TEAM_PHOTO_BUCKET).getPublicUrl(photoPath).data.publicUrl:null}));
  return data;
 }
 if(['set_active','delete_person'].includes(action))return trainerRpc(db,actor,{action,...validateTrainerLifecycle(body)});
 if(action==='save_person')return trainerRpc(db,actor,{action,...validateTrainerPerson(body)});
 if(action==='save_team')return trainerRpc(db,actor,{action,...validateTrainerTeam(body)});
 if(['upload_team_photo','remove_team_photo'].includes(action)){
  if(!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(body.teamId||'')||!Number.isSafeInteger(body.version)||body.version<1)throw new Error('Bitte eine gespeicherte Mannschaft auswählen.');
  const identity={teamId:body.teamId,version:body.version};
  await trainerRpc(db,actor,{action:'authorize_team_photo',...identity});
  if(action==='remove_team_photo')return trainerRpc(db,actor,{action:'save_team_photo',...identity,photoPath:null});
  const decoded=decodeRefereeReceipt(body.photo);
  if(!['image/jpeg','image/png','image/webp'].includes(decoded.mime)||decoded.bytes.length>5242880)throw new Error('Bitte ein Mannschaftsbild als JPG, PNG oder WebP mit höchstens 5 MB auswählen.');
  const photoPath=`${body.teamId}/${await receiptHash(decoded.bytes)}.${decoded.extension}`;
  const {error}=await db.storage.from(TEAM_PHOTO_BUCKET).upload(photoPath,decoded.bytes,{contentType:decoded.mime,upsert:false});
  if(error&&String(error.statusCode)!=='409'&&!/already exists/i.test(error.message||''))throw Object.assign(new Error('Das Mannschaftsbild konnte nicht hochgeladen werden.'),{status:503});
  return trainerRpc(db,actor,{action:'save_team_photo',...identity,photoPath});
 }
 if(action==='upload_photo'){
  if(!/^[a-f\d-]{36}$/i.test(body.personId||'')||!Number.isSafeInteger(body.version)||body.version<1)throw new Error('Bitte eine gespeicherte Person auswählen.');
  await trainerRpc(db,actor,{action:'authorize',personId:body.personId});
  const decoded=decodeRefereeReceipt(body.photo);
  if(!decoded.mime.startsWith('image/')||decoded.bytes.length>5242880)throw new Error('Bitte ein Foto als JPG, PNG oder WebP mit höchstens 5 MB auswählen.');
  const photoPath=`${body.personId}/${await receiptHash(decoded.bytes)}.${decoded.extension}`;
  const {error}=await db.storage.from(TRAINER_PHOTO_BUCKET).upload(photoPath,decoded.bytes,{contentType:decoded.mime,upsert:false});
  if(error&&String(error.statusCode)!=='409'&&!/already exists/i.test(error.message||''))throw Object.assign(new Error('Das Foto konnte nicht hochgeladen werden.'),{status:503});
  return trainerRpc(db,actor,{action:'save_photo',personId:body.personId,version:body.version,photoPath});
 }
 throw new Error('Unbekannte Traineraktion.');
}
