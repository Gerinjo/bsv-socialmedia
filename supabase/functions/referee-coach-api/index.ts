import { withSupabase } from 'npm:@supabase/server@1.4.1';
import { handleRefereeCoach } from './handler.mjs';

const handler = withSupabase({ auth: 'publishable' }, (request, context) => handleRefereeCoach(request, context.supabaseAdmin));
export default { fetch: (request: Request) => request.method === 'OPTIONS' ? handleRefereeCoach(request, null) : handler(request) };
