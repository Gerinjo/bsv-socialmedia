import {createClient} from 'npm:@supabase/supabase-js@2';
import {trainerPhotoUrl} from '../_shared/trainer-management.mjs';
const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'apikey, authorization, content-type','cache-control':'no-store'};
// Intentionally anonymous read-only endpoint. The service-only SQL function returns
// approved public coach fields, never the directory, account details or birthdays.
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers});
 try{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.rpc('website_trainers_feed');if(error||!data)throw new Error('feed_unavailable');
  const photos=new Map<string,Promise<string>>();
  const teams=await Promise.all(data.teams.map(async (team:any)=>({path:team.path,coaches:await Promise.all(team.coaches.map(async (coach:any)=>{
   const {photoPath,...publicCoach}=coach;
   if(photoPath){if(!photos.has(photoPath))photos.set(photoPath,trainerPhotoUrl(db,photoPath));publicCoach.image=await photos.get(photoPath);}
   return publicCoach;
  }))})));
  return Response.json({teams},{headers});
 }catch{return Response.json({error:'feed_unavailable'},{status:503,headers});}
});
