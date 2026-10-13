// Hash-named uploads are immutable. Share signed URLs across role duplicates and
// warm requests so the browser/CDN can reuse an already downloaded portrait.
const signedImages=new Map();
export async function websitePortraitUrl(db,source,{now=Date.now()}={}){
 if(!source)return null;
 if(!source.path)return source.url||null;
 if(!['employee-portraits','trainer-portraits'].includes(source.bucket))throw new Error('Ungültiger Bildbestand.');
 const key=source.bucket+'/'+source.path;
 const cached=signedImages.get(key);if(cached&&cached.expires>now)return cached.promise;
 const promise=db.storage.from(source.bucket).createSignedUrl(source.path,3600,{transform:{width:900,quality:95,resize:'contain'}}).then(({data,error})=>{if(error||!data?.signedUrl)throw new Error('portrait_unavailable');return data.signedUrl;});
 const entry={expires:now+300000,promise};signedImages.set(key,entry);
 if(signedImages.size>256)signedImages.delete(signedImages.keys().next().value);
 try{return await promise;}catch(error){if(signedImages.get(key)===entry)signedImages.delete(key);throw error;}
}
export function websiteTeamPhoto(db,path,width=1800){
 return db.storage.from('team-photos').getPublicUrl(path,{transform:{width,quality:95,resize:'contain'}}).data.publicUrl;
}
