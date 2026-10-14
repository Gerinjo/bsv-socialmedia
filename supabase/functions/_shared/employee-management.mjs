import {EMPLOYEE_PHOTO_BUCKET,validateEmployeeAssignment,validateEmployeePhoto,validateEmployeeContact} from '../../../src/employee-management.mjs';
import {decodeRefereeReceipt,receiptHash} from './referee-receipts.mjs';
export async function employeePhotoUrl(db,source){
 if(!source)return null;
 if(!source.path)return source.url||null;
 if(!['employee-portraits','trainer-portraits'].includes(source.bucket))throw new Error('Ungültiger Bildbestand.');
 const {data,error}=await db.storage.from(source.bucket).createSignedUrl(source.path,3600);
 if(error||!data?.signedUrl)throw Object.assign(new Error('Das Personenbild ist vorübergehend nicht verfügbar.'),{status:503});
 return data.signedUrl;
}
export async function employeeRpc(db,actor,payload){
 const {data,error}=await db.rpc('employee_management_request',{actor,payload});
 if(error)throw Object.assign(new Error('Mitarbeiterdaten konnten nicht geladen oder gespeichert werden.'),{status:400});
 if(!data||data.error)throw Object.assign(new Error(data?.error||'Mitarbeiter vorübergehend nicht verfügbar.'),{status:data?.status||503});
 return data;
}
export async function handleEmployeeManagement(db,actor,body){
 const action=String(body.action).replace(/^employee_/,'');
 if(action==='list'){
  const data=await employeeRpc(db,actor,{action});
  data.assignments=await Promise.all(data.assignments.map(async({photoSource,...a})=>({...a,photo_url:await employeePhotoUrl(db,photoSource),photoInherited:photoSource?.inherited===true,hasOwnPhoto:Boolean(photoSource?.path&&!photoSource.inherited)})));
  return data;
 }
 if(action==='save_assignment')return employeeRpc(db,actor,{action,...validateEmployeeAssignment(body)});
 if(action==='save_contact')return employeeRpc(db,actor,{action,...validateEmployeeContact(body)});
 if(action==='remove_assignment'){
  if(!/^[a-f\d-]{36}$/i.test(body.assignmentId||'')||!Number.isSafeInteger(body.version)||body.version<1)throw new Error('Bitte eine gespeicherte Rolle auswählen.');
  return employeeRpc(db,actor,{action,assignmentId:body.assignmentId,version:body.version});
 }
 if(['upload_photo','clear_photo'].includes(action)){
  const identity=validateEmployeePhoto(body);
  await employeeRpc(db,actor,{action:'authorize_photo',...identity});
  if(action==='clear_photo')return employeeRpc(db,actor,{action,...identity});
  const decoded=decodeRefereeReceipt(body.photo);
  if(!['image/jpeg','image/png','image/webp'].includes(decoded.mime)||decoded.bytes.length>5242880)throw new Error('Bitte ein Bild als JPG, PNG oder WebP bis 5 MB auswählen.');
  const photoPath=`${identity.personId}/${await receiptHash(decoded.bytes)}.${decoded.extension}`;
  const {error}=await db.storage.from(EMPLOYEE_PHOTO_BUCKET).upload(photoPath,decoded.bytes,{contentType:decoded.mime,upsert:false});
  if(error&&String(error.statusCode)!=='409'&&!/already exists/i.test(error.message||''))throw Object.assign(new Error('Das Rollenbild konnte nicht hochgeladen werden.'),{status:503});
  return employeeRpc(db,actor,{action:'save_photo',...identity,photoPath});
 }
 throw new Error('Unbekannte Mitarbeiteraktion.');
}
