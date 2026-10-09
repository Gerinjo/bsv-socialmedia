const headers = {'access-control-allow-origin':'*','access-control-allow-headers':'apikey, authorization, content-type','access-control-allow-methods':'POST, OPTIONS','cache-control':'no-store'};
const reply = (body,status=200) => Response.json(body,{status,headers});
// Alias adapter for the same Supabase Auth session used by every suite area.
export async function handleSuiteLogin(request,admin,auth) {
  if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
  if (request.method!=='POST') return reply({error:'Methode nicht erlaubt.'},405);
  try {
    const raw=await request.text();
    if (raw.length>4096) return reply({error:'Ungültige Anmeldung.'},400);
    const body=JSON.parse(raw);
    if (!/^[a-z]{2,30}$/i.test(body.username||'') || typeof body.password!=='string' || !body.password || body.password.length>512) return reply({error:'Ungültige Anmeldung.'},400);
    const username=body.username.toLowerCase();
    const {data:identity,error}=await admin.rpc('suite_cashbook_login',{payload:{action:'attempt',username}});
    if (error) throw error;
    if (identity.error) return reply(identity,identity.status||403);
    const result=await auth.signInWithPassword({email:identity.email,password:body.password});
    if (result.error || !result.data?.session) return reply({error:'Benutzername oder Passwort stimmen nicht.'},403);
    await admin.rpc('suite_cashbook_login',{payload:{action:'success',username}});
    const {access_token,refresh_token}=result.data.session;
    return reply({access_token,refresh_token});
  } catch { return reply({error:'Die Anmeldung ist derzeit nicht verfügbar.'},503); }
}
