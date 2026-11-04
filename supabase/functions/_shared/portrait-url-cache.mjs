// Cache image capabilities, never directory data or authorization decisions.
// Database storage survives cold starts; the original one-hour URL TTL is retained.
const variants=new Set(['original','website-900-q95']);
function key(source){
 if(!source?.path)return null;
 if(!['employee-portraits','trainer-portraits'].includes(source.bucket))throw new Error('Ungültiger Bildbestand.');
 return source.bucket+'/'+source.path;
}
export async function portraitUrlResolver(db,sources,{variant,sign,now=Date.now}){
 if(!variants.has(variant))throw new Error('Ungültige Bildvariante.');
 const requested=new Map();
 for(const source of sources){const id=key(source);if(id)requested.set(id,{bucket:source.bucket,path:source.path});}
 const cached=new Map(),pending=new Map(),updates=new Map();
 let available=false;
 if(requested.size){
  try{
   const {data,error}=await db.rpc('portrait_url_cache_request',{payload:{action:'get',variant,items:[...requested.values()]}});
   if(!error&&Array.isArray(data?.entries)){
    available=true;
    for(const row of data.entries){
     const id=key(row);
     if(requested.has(id)&&row.variant===variant&&typeof row.url==='string'&&row.url.startsWith('https://')&&row.url.includes('/'+row.bucket+'/'+row.path+'?')&&Date.parse(row.expires_at)>now()+300000)cached.set(id,row.url);
    }
   }
  }catch{available=false;cached.clear();/* An unavailable cache must not make an otherwise accessible image fail. */}
 }
 return {
  async url(source){
   const id=key(source);if(!id)return source?.url||null;
   if(cached.has(id))return cached.get(id);
   if(!pending.has(id)){
    const started=now();
    const promise=Promise.resolve().then(()=>sign(source)).then(url=>{
     if(url&&available)updates.set(id,{bucket:source.bucket,path:source.path,url,expiresAt:new Date(started+50*60000).toISOString()});
     return url;
    }).catch(error=>{pending.delete(id);throw error;});
    pending.set(id,promise);
   }
   return pending.get(id);
  },
  async save(){
   if(!available||!updates.size)return;
   try{await db.rpc('portrait_url_cache_request',{payload:{action:'put',variant,items:[...updates.values()]}});}catch{/* Retry on a later request; never hide a signing failure. */}
  },
 };
}
