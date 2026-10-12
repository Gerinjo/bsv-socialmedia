export async function handleTrainerOnboardingImport(request,{db}){
 if(request.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405});
 const signature=request.headers.get('x-bsv-onboarding-signature')||'';
 if(!/^[a-f0-9]{64}$/.test(signature))return Response.json({error:'unauthorized'},{status:401});
 if(Number(request.headers.get('content-length')||0)>8192)return Response.json({error:'request_too_large'},{status:413});
 let raw;try{raw=await request.text();if(raw.length>8192)throw new Error();}catch{return Response.json({error:'invalid_request'},{status:400});}
 let payload;try{payload=JSON.parse(raw);}catch{return Response.json({error:'invalid_json'},{status:400});}

 try{const {data,error}=await db.rpc('import_trainer_onboarding',{secret_hash:signature,payload});if(error||!data)return Response.json({error:'import_unavailable'},{status:503});if(data.error)return Response.json({error:data.error},{status:data.status||400});return Response.json({ok:true});}catch{return Response.json({error:'import_unavailable'},{status:503});}
}
