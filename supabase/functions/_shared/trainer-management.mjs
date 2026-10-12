import {TRAINER_PHOTO_BUCKET,validateTrainerPerson,validateTrainerTeam} from '../../../src/trainer-management.mjs';
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
  data.people=await Promise.all(data.people.map(async p=>{const {photo_path,website_photo_url,...safe}=p;return {...safe,photo_url:photo_path?await trainerPhotoUrl(db,photo_path):p.source_photo_url};}));
  return data;
 }
 if(action==='save_person')return trainerRpc(db,actor,{action,...validateTrainerPerson(body)});
 if(action==='save_team')return trainerRpc(db,actor,{action,...validateTrainerTeam(body)});
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
