import {createClient} from 'npm:@supabase/supabase-js@2';
import {handleTrainerContactRecipients} from './handler.mjs';
// Custom authentication: service-only SQL verifies the signed, short-lived lookup.
Deno.serve(request=>handleTrainerContactRecipients(request,{db:createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})}));
