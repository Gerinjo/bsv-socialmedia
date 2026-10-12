import assert from 'node:assert/strict';

// Exercise the actual Edge Function and pinned Supabase auth wrapper. All database
// requests are intercepted; keys and identities are generated only for this test.
Deno.test('bootstrap accepts verified JWT session claims and rejects invalid or blocked logins', async () => {
  const actor = 'b2222222-2222-4222-8222-222222222222';
  const session = 'b1111111-1111-4111-8111-111111111111';
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const json64 = (value: unknown) => encode(new TextEncoder().encode(JSON.stringify(value)));
  const key = await crypto.subtle.generateKey({name: 'HMAC', hash: 'SHA-256'}, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  const env = {
    SUPABASE_URL: 'https://suite-login-test.invalid',
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({default: 'sb_publishable_test'}),
    SUPABASE_SECRET_KEYS: JSON.stringify({default: 'sb_secret_test'}),
    SUPABASE_JWKS: JSON.stringify({keys: [{...jwk, kid: 'test-key', alg: 'HS256'}]}),
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map(name => [name, Deno.env.get(name)]));
  const originalFetch = globalThis.fetch;
  const calls: {path: string; body: any}[] = [];
  let blocked = false;
  let active = true;
  try {
    for (const [name, value] of Object.entries(env)) Deno.env.set(name, value);
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      assert.equal(url.origin, env.SUPABASE_URL, 'No real service may be contacted');
      const body = request.method === 'POST' ? await request.json() : null;
      calls.push({path: url.pathname, body});
      if (url.pathname === '/rest/v1/social_admins') return Response.json({user_id: actor, role: 'sm-team', is_active: active, is_blocked: blocked, access_areas: ['cashbook']});
      if (url.pathname === '/rest/v1/social_brand_settings') return Response.json({color_scheme: {}, theme_key: 'football'});
      if (url.pathname === '/rest/v1/rpc/suite_users_request') return Response.json({userId: actor, accessAreas: ['cashbook']});
      if (url.pathname === '/rest/v1/rpc/suite_record_login') return Response.json({ok: true});
      throw new Error(`Unexpected request: ${url.pathname}`);
    };
    const {default: handler} = await import('../functions/social-media-admin-api/index.ts');
    const token = async (overrides = {}) => {
      const input = `${json64({alg: 'HS256', kid: 'test-key', typ: 'JWT'})}.${json64({sub: actor, role: 'authenticated', session_id: session, iat: now, exp: now + 3600, amr: [{method: 'password', timestamp: now - 30}], ...overrides})}`;
      const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
      return `${input}.${encode(new Uint8Array(signature))}`;
    };
    const request = (jwt: string, query = '?bootstrap=1') => handler.fetch(new Request(`https://suite.example/api${query}`, {headers: {authorization: `Bearer ${jwt}`}}));
    const validToken = await token();
    const response = await request(validToken);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).user.userId, actor);
    assert.deepEqual(calls.find(call => call.path.endsWith('/suite_record_login'))?.body, {
      actor, session_id: session, signed_in_at: new Date((now - 30) * 1000).toISOString(),
    });
    assert.equal(calls.length, 4, 'Bootstrap loads only membership, identity, branding and audit');
    calls.length = 0;
    assert.equal((await request(validToken, '?area=cashbook')).status, 200);
    assert.ok(calls.every(call => !call.path.endsWith('/suite_record_login')), 'Area loads do not create login events');
    calls.length = 0;
    assert.equal((await request(await token({exp: now - 60}))).status, 401);
    const parts = validToken.split('.');
    parts[1] = json64({sub: actor, session_id: session, exp: now + 3600});
    assert.equal((await request(parts.join('.'))).status, 401);
    assert.equal(calls.length, 0, 'Invalid credentials cannot reach the database');
    blocked = true;
    assert.equal((await request(validToken)).status, 403);
    blocked = false;
    active = false;
    assert.equal((await request(validToken)).status, 403);
    assert.ok(calls.every(call => call.path === '/rest/v1/social_admins'), 'Blocked/inactive users cannot bootstrap or log in');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value);
    }
  }
});
