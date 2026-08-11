function enabledOnlyByExplicitFalse(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== 'false';
}

function defaultSecretKey(): string {
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modern) {
    try {
      const keys = JSON.parse(modern) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Fall through to the legacy key for local and older projects.
    }
  }
  return Deno.env.get('SUPABASE_SECRET_KEY')?.trim()
    || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
    || '';
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() ?? '';
const internalSecretKey = defaultSecretKey();

export const runtimeConfig = Object.freeze({
  testMode: enabledOnlyByExplicitFalse(Deno.env.get('INSTAGRAM_TEST_MODE')),
  supabaseUrl,
  renderEndpoint: Deno.env.get('STORY_RENDER_ENDPOINT')?.trim()
    || `${supabaseUrl}/functions/v1/story-renderer`,
  renderApiKey: Deno.env.get('STORY_RENDER_SECRET')?.trim() || internalSecretKey,
  workerApiKey: internalSecretKey,
  workerCronSecret: Deno.env.get('SOCIAL_WORKER_CRON_SECRET')?.trim() ?? '',
  instagramAccountId: Deno.env.get('INSTAGRAM_ACCOUNT_ID')?.trim() ?? '',
  instagramAccessToken: Deno.env.get('INSTAGRAM_ACCESS_TOKEN')?.trim() ?? '',
});
