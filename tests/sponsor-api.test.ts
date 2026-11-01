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

function setupServices(rpcError: any = null) {
  const saves: any[] = [];
  setResourceApiContext({ userClaims: { sub: 'sponsor-editor' }, supabaseAdmin: {
    from(table: string) {
      if (table === 'social_admins') {
        const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { role: 'sm-team', is_active: true, access_areas: ['sponsoring'] } }) };
        return q;
      }
      const rows: any[] = table === 'social_post_audiences' ? [{ id: 'club', audience_group: 'club' }]
        : table === 'social_sponsor_types' ? [{ id: 'boards', slug: 'bandensponsor' }, { id: 'stadium', slug: 'stadionheft' }] : [];
      assert.ok(['social_post_audiences', 'social_sponsor_types', 'social_sponsor_assignments'].includes(table));
      let selectedIds: any[] | null = null;
      const q: any = { select: () => q, eq: () => q, in: (_column: string, values: any[]) => {
        assert.equal(values.length, new Set(values).size); selectedIds = values; return q;
      }, then: (resolve: any) => resolve({ data: selectedIds ? rows.filter(row => selectedIds!.includes(row.id)) : rows }) };
      return q;
    },
    rpc: async (name: string, payload: any) => {
      assert.equal(name, 'save_social_sponsor_assignments'); saves.push(payload); return { error: rpcError };
    },
  } });
  return saves;
}
const services = [
  { audienceId: 'club', sponsorTypeId: 'boards', description: 'Bande' },
  { audienceId: 'club', sponsorTypeId: 'stadium', pageSize: '1/3', description: 'Anzeige' },
];
const saveServices = (websiteAssignments: any[]) => api.fetch(new Request('https://example.test/admin', {
  method: 'POST', body: JSON.stringify({ action: 'save_sponsor_assignments', sponsorId: 'graf', assignments: [], websiteAssignments, assignmentsSchemaVersion: 2 }),
}));
Deno.test('actual API saves Bandenwerbung and a third-page advertisement for the same club atomically', async () => {
  const saves = setupServices(); const response = await saveServices(services); const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(saves.length, 1);
  assert.equal(saves[0].p_schema_version, 2); assert.equal(saves[0].p_website.length, 2);
  assert.deepEqual(body.websiteAssignments.map((row: any) => [row.sponsor_type_id, row.page_size, row.description]), [['boards', null, 'Bande'], ['stadium', '1/3', 'Anzeige']]);
});
Deno.test('actual API rejects duplicate services, unspecified mixed services and missing magazine formats before saving', async () => {
  for (const [rows, pattern] of [
    [[services[0], services[0]], /doppelt/],
    [[services[0], { audienceId: 'club' }], /Sponsorart/],
    [[{ ...services[1], pageSize: '' }], /Seitengröße/],
  ] as const) {
    const saves = setupServices(); const response = await saveServices([...rows]);
    assert.equal(response.status, 400); assert.match((await response.json()).error, pattern); assert.deepEqual(saves, []);
  }
});
Deno.test('actual API preserves the transaction conflict response and tells stale clients to reload', async () => {
  setupServices({ code: 'PT409', message: 'Mehrere Sponsorleistungen. Bitte die Seite neu laden.' });
  const response = await saveServices(services); assert.equal(response.status, 409);
  assert.match((await response.json()).error, /neu laden/);
});
