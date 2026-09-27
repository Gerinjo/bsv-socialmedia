import assert from 'node:assert/strict';
import test from 'node:test';
import { canPayReferee, refereeStatus, validateRefereeInput } from '../src/referees.mjs';
import { handleRefereeCoach } from '../supabase/functions/referee-coach-api/handler.mjs';
import { historyState, cleanupSummary } from '../src/history-retention.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const assignment = { referee_name: 'Alex', field_size: 7, paid_at: null, game: { kickoff_at: '2026-01-01T12:00:00Z', status: 'finished' } };
const credentials = { personId: id, teamId: id, birthDate: '1980-01-01' };
const request = body => new Request('https://example.org', { method: 'POST', body: JSON.stringify(body) });

test('referee records are excluded from cleanup and its eligible count', () => {
  const game = { archived_at: '2025-01-01', referee_assignments: [{ id }] };
  assert.equal(historyState(game, 'game').cleanup_eligible, false);
  assert.equal(historyState(game, 'game').delete_after, null);
  assert.equal(cleanupSummary({ game: [game] }).game.eligible, 0);
  assert.equal(historyState({ ...game, referee_assignments: [] }, 'game').cleanup_eligible, true);
});

test('payout eligibility requires a finished, past, assigned and unpaid match', () => {
  assert.equal(canPayReferee(assignment), true);
  for (const change of [{ referee_name: null }, { field_size: null }, { paid_at: '2026-02-01' }, { game: { ...assignment.game, kickoff_at: '2999-01-01' } }, ...['scheduled', 'live', 'cancelled', 'postponed', 'aborted'].map(status => ({ game: { ...assignment.game, status } }))]) {
    assert.equal(canPayReferee({ ...assignment, ...change }), false);
  }
  assert.equal(refereeStatus(assignment).key, 'payable');
  assert.equal(refereeStatus({ ...assignment, referee_name: null }).key, 'missing');
  assert.equal(refereeStatus({ ...assignment, paid_at: '2026-02-01' }).key, 'paid');
});

test('coach inputs allow only supported pitch sizes, bounded names and current versions', () => {
  assert.deepEqual(validateRefereeInput({ refereeName: '  Alex  ', fieldSize: 9, version: 1 }), { refereeName: 'Alex', fieldSize: 9, version: 1 });
  for (const fieldSize of [null, 11, '7', true]) assert.throws(() => validateRefereeInput({ refereeName: 'Alex', fieldSize, version: 1 }));
  for (const refereeName of ['', ' ', 'a'.repeat(161)]) assert.throws(() => validateRefereeInput({ refereeName, fieldSize: 7, version: 1 }));
});

test('public endpoint cannot invoke admin actions or smuggle payout fields to RPC', async () => {
  let calls = 0;
  const db = { rpc: async (name, { payload }) => { calls++; assert.equal(name, 'referee_coach_request'); assert.equal(payload.paid_at, undefined); assert.equal(payload.paid_by, undefined); assert.equal(payload.actor, undefined); return { data: { assignments: [] }, error: null }; } };
  for (const action of ['referee_pay', 'referee_register', 'referee_birthdate']) assert.equal((await handleRefereeCoach(request({ ...credentials, action }), db)).status, 400);
  assert.equal(calls, 0);
  const response = await handleRefereeCoach(request({ ...credentials, action: 'save', id, refereeName: 'Alex', fieldSize: 7, version: 1, paid_at: '2026-01-01', paid_by: id, actor: id }), db);
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test('public coach selector requests no birthdays, emails or unrelated personal fields', async () => {
  let fields;
  const query = {
    select(value) { fields = value; return this; },
    ilike() { return this; }, eq() { return this; },
    then(resolve) { return Promise.resolve({ data: [{ person_id: id, display_name: 'Test Trainer', team_id: id, team_name: 'Test', role: 'Trainer', is_club_role: false }] }).then(resolve); },
  };
  const response = await handleRefereeCoach(new Request('https://example.org'), { from: table => { assert.equal(table, 'referee_portal_people'); return query; } });
  assert.equal(response.status, 200);
  assert.doesNotMatch(fields, /birth|email|\*/);
  assert.equal((await response.json()).coaches[0].person.display_name, 'Test Trainer');
});

test('failed identities, locks, conflicts and rate limits retain their server status', async () => {
  for (const status of [403, 409, 429]) {
    const response = await handleRefereeCoach(request({ ...credentials, action: 'list' }), { rpc: async () => ({ data: { error: 'Denied', status } }) });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('invalid payloads and internal failures do not disclose birthdays or database details', async () => {
  for (const body of [null, {}, { ...credentials, action: 'list', birthDate: '01.01.1980' }]) assert.equal((await handleRefereeCoach(request(body), {})).status, 400);
  const response = await handleRefereeCoach(request({ ...credentials, action: 'list' }), { rpc: async () => ({ error: new Error('database contains 1980-01-01') }) });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /1980|database/);
});
