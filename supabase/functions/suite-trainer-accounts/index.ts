import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {handleTrainerAccounts} from './handler.mjs';
// A service-created, expiring, single-use job capability authorizes this operator endpoint.
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(request=>handleTrainerAccounts(request,db));
