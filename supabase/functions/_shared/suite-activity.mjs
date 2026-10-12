const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// claims must come from withSupabase's verified session, never request JSON.
export async function recordSuiteLogin(db,actor,claims){
 if(!uuid.test(claims?.session_id||''))throw Object.assign(new Error('Ungültige Sitzung. Bitte erneut anmelden.'),{status:401});
 const methods=new Set(['password','oauth','otp','recovery','invite','sso/saml','magiclink','email/signup']);
 const times=(Array.isArray(claims.amr)?claims.amr:[]).filter(item=>methods.has(item.method)&&Number.isSafeInteger(item.timestamp)&&item.timestamp>0&&item.timestamp<=Date.now()/1000+300).map(item=>item.timestamp);
 const signedInAt=times.length?new Date(Math.min(...times)*1000).toISOString():null;
 const {data,error}=await db.rpc('suite_record_login',{actor,session_id:claims.session_id,signed_in_at:signedInAt});
 if(error||data?.error)throw Object.assign(new Error('Die Anmeldung konnte nicht protokolliert werden. Bitte erneut versuchen.'),{status:data?.status||503});
}

export async function readSuiteActivity(db,actor,body){
 const payload={userId:body.userId||'',category:body.category||'',from:body.from||'',until:body.until||'',cursor:body.cursor||null};
 const {data,error}=await db.rpc('suite_activity_request',{actor,payload});
 if(error)throw Object.assign(new Error('Das Aktivitätsprotokoll konnte nicht geladen werden.'),{status:503});
 if(!data||data.error)throw Object.assign(new Error(data?.error||'Das Aktivitätsprotokoll ist derzeit nicht verfügbar.'),{status:data?.status||503});
 return data;
}
