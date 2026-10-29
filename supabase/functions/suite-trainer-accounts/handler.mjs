import {SUITE_INITIAL_PASSWORD} from '../_shared/suite-accounts.mjs';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function handleTrainerAccounts(request,db){
 if(request.method!=='POST')return reply({error:'Methode nicht erlaubt.'},405);
 try{
  const token=request.headers.get('x-provision-token')||'';
  if(!/^[A-Za-z0-9_-]{40,100}$/.test(token))return reply({error:'Nicht berechtigt.'},403);
  const raw=await request.text();if(raw.length>256)return reply({error:'Ungültiger Auftrag.'},400);
  const {jobId}=JSON.parse(raw);if(!/^[0-9a-f-]{36}$/i.test(jobId||''))return reply({error:'Ungültiger Auftrag.'},400);
  const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  async function rpc(payload){
   const {data,error}=await db.rpc('suite_trainer_account_job',{job_id:jobId,token_hash:tokenHash,payload});
   if(error)throw Object.assign(new Error('Auftrag konnte nicht gespeichert werden.'),{status:503});
   if(!data||data.error)throw Object.assign(new Error(data?.error||'Auftrag fehlgeschlagen.'),{status:data?.status||503});
   return data;
  }
  const {people}=await rpc({action:'claim'}),results=[];
  for(const person of people){
   let userId=null;
   try{
    const {data,error}=await db.auth.admin.createUser({email:person.email,password:SUITE_INITIAL_PASSWORD,email_confirm:true,app_metadata:{trainer_person_id:person.personId}});
    if(error||!data?.user?.id)throw new Error('Auth-Zugang konnte nicht angelegt werden.');
    userId=data.user.id;
    await rpc({action:'finish_person',personId:person.personId,userId});
    results.push({personId:person.personId,username:person.username,ok:true});
   }catch(error){
    let cleanupFailed=false;
    if(userId){try{const cleanup=await db.auth.admin.deleteUser(userId);cleanupFailed=Boolean(cleanup.error);}catch{cleanupFailed=true;}}
    results.push({personId:person.personId,ok:false,error:error.message,...(cleanupFailed?{cleanupFailed:true}:{})});
   }
  }
  const result={ok:results.every(r=>r.ok),created:results.filter(r=>r.ok).length,results};
  await rpc({action:'complete',result});return reply(result);
 }catch(error){return reply({error:error.message||'Auftrag fehlgeschlagen.'},error.status||500);}
}
