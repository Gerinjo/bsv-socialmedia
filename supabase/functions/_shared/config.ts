function enabledOnlyByExplicitFalse(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== 'false';
}

export const runtimeConfig = Object.freeze({
  testMode: enabledOnlyByExplicitFalse(Deno.env.get('INSTAGRAM_TEST_MODE')),
  renderEndpoint: Deno.env.get('STORY_RENDER_ENDPOINT')?.trim() ?? '',
  renderSecret: Deno.env.get('STORY_RENDER_SECRET')?.trim() ?? '',
  instagramAccountId: Deno.env.get('INSTAGRAM_ACCOUNT_ID')?.trim() ?? '',
  instagramAccessToken: Deno.env.get('INSTAGRAM_ACCESS_TOKEN')?.trim() ?? '',
});
