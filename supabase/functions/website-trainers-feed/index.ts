import {websitePortraitUrl,websiteTeamPhoto} from '../_shared/website-image-urls.mjs';
import {createClient} from 'npm:@supabase/supabase-js@2';
const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'apikey, authorization, content-type','cache-control':'no-store'};
// Intentionally anonymous read-only endpoint. The service-only SQL function returns
// approved public coach fields, never the directory, account details or birthdays.
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers});
 try{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const [trainers,groupsResult]=await Promise.all([db.rpc('website_trainers_feed'),db.rpc('website_employee_groups')]);
  const {data,error}=trainers;const {data:groups,error:groupError}=groupsResult;if(error||!data||groupError||!groups)throw new Error('feed_unavailable');
  const teams=await Promise.all(data.teams.map(async (team:any)=>({path:team.path,...(team.photoManaged?{photo:team.teamPhotoPath?{image:websiteTeamPhoto(db,team.teamPhotoPath),previewImage:websiteTeamPhoto(db,team.teamPhotoPath,900)}:null}:{}),coaches:await Promise.all(team.coaches.map(async (coach:any)=>{
   const {photoPath,photoSource,...publicCoach}=coach;
   if(photoSource){publicCoach.image=await websitePortraitUrl(db,photoSource);return publicCoach;}
   if(photoPath)publicCoach.image=await websitePortraitUrl(db,{bucket:'trainer-portraits',path:photoPath});
   return publicCoach;
  }))})));
  const employeeGroups=await Promise.all(groups.assignments.map(async({photoSource,personId,id,...a}:any)=>({...a,image:await websitePortraitUrl(db,photoSource)})));
  return Response.json({teams,employeeGroups},{headers});
 }catch{return Response.json({error:'feed_unavailable'},{status:503,headers});}
});
