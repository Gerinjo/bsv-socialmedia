import {employeePhotoUrl,employeePhotos} from './employee-management.mjs';
export async function financialDirectoryPhotos(db,data){
 const photos=await employeePhotos(db,[...(data.people||[]),...(data.contracts||[])].map(item=>item.photoSource));
 const withPhoto=async item=>{const {photoSource,...safe}=item;return photoSource?{...safe,photo_url:await photos.url(photoSource).catch(()=>null)}:safe;};
 if(Array.isArray(data.people))data.people=await Promise.all(data.people.map(withPhoto));if(Array.isArray(data.contracts))data.contracts=await Promise.all(data.contracts.map(withPhoto));await photos.save();return data;
}
export async function financialRecordPhoto(db,record){const {photoSource,...safe}=record;return {...safe,photo_url:photoSource?await employeePhotoUrl(db,photoSource).catch(()=>null):null};}
