export async function handleTrainerContactRecipients(request,{db}){
 const headers={'cache-control':'no-store'};
 if(request.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405,headers});
 const signature=request.headers.get('x-bsv-contact-signature')||'';
 if(!/^[a-f0-9]{64}$/.test(signature))return Response.json({error:'unauthorized'},{status:401,headers});
 if(Number(request.headers.get('content-length')||0)>2048)return Response.json({error:'request_too_large'},{status:413,headers});
 let payload;
 try{const raw=await request.text();if(raw.length>2048)return Response.json({error:'request_too_large'},{status:413,headers});payload=JSON.parse(raw);if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error();}
 catch{return Response.json({error:'invalid_request'},{status:400,headers});}
 try{
  const {data,error}=await db.rpc('resolve_trainer_contact',{signature,payload});
  if(error||!data)return Response.json({error:'lookup_unavailable'},{status:503,headers});
  if(data.error)return Response.json({error:data.error},{status:data.status||400,headers});
  return Response.json(data,{headers});
 }catch{return Response.json({error:'lookup_unavailable'},{status:503,headers});}
}
