import assert from 'node:assert/strict';
import test from 'node:test';
import { createSponsor, SponsorExistsError } from '../supabase/functions/_shared/sponsor-create.mjs';

const graf = { id: 'graf', name: 'Garten Graf', slug: 'garten-graf', active: true, logo_status: 'approved' };

function database(rows = [], { insertError, readError } = {}) {
  const records = structuredClone(rows);
  return {
    records,
    from(table) {
      assert.equal(table, 'social_sponsors');
      return {
        insert(payload) {
          return { select: () => ({ single: async () => {
            if (insertError) return { error: insertError };
            if (records.some(row => row.name === payload.name || row.slug === payload.slug)) return { error: { code: '23505' } };
            const data = { ...payload, id: `new-${records.length}` };
            records.push(data);
            return { data };
          } }) };
        },
        select(columns) {
          assert.equal(columns, 'id,name');
          return { eq: (field, value) => ({ maybeSingle: async () => ({
            error: readError,
            data: records.find(row => row[field] === value) || null,
          }) }) };
        },
      };
    },
  };
}

test('a new sponsor is created and returned for subsequent logo upload', async () => {
  const db = database([graf]);
  const payload = { name: 'Neuer Partner', slug: 'neuer-partner', active: true };
  const sponsor = await createSponsor(db, payload);
  assert.deepEqual(sponsor, { ...payload, id: 'new-1' });
  assert.equal(db.records.length, 2);
  assert.deepEqual(db.records[0], graf);
});

test('an existing sponsor produces a readable error and a safe link target without changing data', async () => {
  const db = database([graf]);
  await assert.rejects(createSponsor(db, { name: graf.name, slug: graf.slug, active: false }), error => {
    assert.ok(error instanceof SponsorExistsError);
    assert.match(error.message, /Garten Graf.*bereits vorhanden/);
    assert.deepEqual(error.existingSponsor, { id: graf.id, name: graf.name });
    return true;
  });
  assert.deepEqual(db.records, [graf]);
});

test('punctuation or case variants that share a slug point to the existing partner', async () => {
  const db = database([graf]);
  await assert.rejects(createSponsor(db, { name: 'GARTEN-GRAF', slug: 'garten-graf' }), error => {
    assert.equal(error.existingSponsor.id, graf.id);
    return true;
  });
  assert.deepEqual(db.records, [graf]);
});

test('a renamed sponsor is found by name even if its stable asset slug differs', async () => {
  const renamed = { ...graf, name: 'Graf Gartenbau' };
  await assert.rejects(createSponsor(database([renamed]), { name: renamed.name, slug: 'graf-gartenbau' }), error => {
    assert.deepEqual(error.existingSponsor, { id: renamed.id, name: renamed.name });
    return true;
  });
});

test('concurrent submissions create one partner and direct the others to that same entry', async () => {
  const db = database();
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => createSponsor(db, graf)));
  const saved = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(saved.length, 1);
  assert.equal(db.records.length, 1);
  assert.equal(rejected.length, 3);
  for (const { reason } of rejected) {
    assert.ok(reason instanceof SponsorExistsError);
    assert.equal(reason.existingSponsor.id, saved[0].value.id);
  }
});

test('unrelated insert failures and failed lookups are not misreported as existing sponsors', async () => {
  const denied = { code: '42501', message: 'permission denied' };
  await assert.rejects(createSponsor(database([], { insertError: denied }), graf), error => error === denied);
  const missing = { code: '23505', message: 'another unique constraint' };
  await assert.rejects(createSponsor(database([], { insertError: missing }), graf), error => error === missing);
  const unavailable = { message: 'Connection failed' };
  await assert.rejects(createSponsor(database([graf], { readError: unavailable }), graf), error => error === unavailable);
});
