import assert from 'node:assert/strict';
import api from '../supabase/functions/social-media-admin-api/index.ts';
import { setResourceApiContext } from './support/resource-api-auth.ts';

const existing = { id: 'existing-graf', name: 'Garten Graf', slug: 'garten-graf' };
function setup(duplicate = true, areas = ['sponsoring']) {
  const writes: any[] = [];
  setResourceApiContext({ userClaims: { sub: 'test-sponsor-editor' }, supabaseAdmin: {
    from(table: string) {
      if (table === 'social_admins') {
        const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({
          data: { role: 'sm-team', is_active: true, is_blocked: false, access_areas: areas },
        }) };
        return query;
      }
      assert.equal(table, 'social_sponsors');
      return {
        insert(payload: any) {
          writes.push(payload);
          return { select: () => ({ single: async () => duplicate
            ? { error: { code: '23505', message: 'duplicate key value violates unique constraint "social_sponsors_slug_key"' } }
            : { data: { id: 'new-partner', ...payload } },
          }) };
        },
        select: () => ({ eq: (field: keyof typeof existing, value: string) => ({ maybeSingle: async () => ({
          data: existing[field] === value ? existing : null,
        }) }) }),
      };
    },
  } });
  return writes;
}
const post = (name: string) => api.fetch(new Request('https://example.test/admin', {
  method: 'POST', body: JSON.stringify({ action: 'save_sponsor', name, active: true }),
}));

Deno.test('actual API returns a readable duplicate response with the existing partner, including slug variants', async () => {
  for (const name of ['Garten Graf', 'GARTEN-GRAF']) {
    const writes = setup();
    const response = await post(name);
    const body = await response.json();
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.equal(body.code, 'sponsor_exists');
    assert.deepEqual(body.existingSponsor, { id: existing.id, name: existing.name });
    assert.match(body.error, /Garten Graf.*bereits vorhanden/);
    assert.equal(writes.length, 1);
  }
});

Deno.test('actual API creates a new sponsor with validated values and a stable slug', async () => {
  const writes = setup(false);
  const response = await post('Neuer Partner');
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.sponsor.slug, 'neuer-partner');
  assert.equal(body.sponsor.id, 'new-partner');
  assert.equal(writes.length, 1);
});

Deno.test('actual API reveals no existing sponsor and performs no insert without sponsoring permission', async () => {
  const writes = setup(true, []);
  const response = await post('Garten Graf');
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'area_forbidden', area: 'sponsoring' });
  assert.deepEqual(writes, []);
});
