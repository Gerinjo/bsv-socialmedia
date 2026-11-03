import {employeePhotoUrl} from './employee-management.mjs';
export async function financialDirectoryPhotos(db,data){
 const cache=new Map();const withPhoto=async item=>{const {photoSource,...safe}=item;if(!photoSource)return safe;const key=JSON.stringify(photoSource);if(!cache.has(key))cache.set(key,employeePhotoUrl(db,photoSource).catch(()=>null));return {...safe,photo_url:await cache.get(key)};};
 if(Array.isArray(data.people))data.people=await Promise.all(data.people.map(withPhoto));if(Array.isArray(data.contracts))data.contracts=await Promise.all(data.contracts.map(withPhoto));return data;
}
export async function financialRecordPhoto(db,record){const {photoSource,...safe}=record;return {...safe,photo_url:photoSource?await employeePhotoUrl(db,photoSource).catch(()=>null):null};}
