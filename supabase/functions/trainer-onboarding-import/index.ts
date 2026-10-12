import {createClient} from 'npm:@supabase/supabase-js@2';
import {handleTrainerOnboardingImport} from './handler.mjs';
// Server-to-server only: a private bridge key is checked by the service-only RPC.
Deno.serve(request=>handleTrainerOnboardingImport(request,{db:createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})}));
