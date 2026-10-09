import { withSupabase } from 'npm:@supabase/server@1.4.1';
import { handleSuiteLogin } from './handler.mjs';
const handler = withSupabase({auth:'publishable'},(request,context)=>handleSuiteLogin(request,context.supabaseAdmin,context.supabase.auth));
export default {fetch:(request:Request)=>request.method==='OPTIONS'?handleSuiteLogin(request,null,null):handler(request)};
