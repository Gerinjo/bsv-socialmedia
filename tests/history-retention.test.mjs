import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanupSummary,
  historyState,
  normalizeRetentionDays,
} from '../src/history-retention.mjs';

const now = Date.parse('2026-08-18T12:00:00.000Z');

test('retention days accept only the configured safe range', () => {
  assert.equal(normalizeRetentionDays(45), 45);
  assert.equal(normalizeRetentionDays(0), 30);
  assert.equal(normalizeRetentionDays(3651), 30);
  assert.equal(normalizeRetentionDays('14'), 14);
});

test('a published post becomes historical and eligible only after retention', () => {
  const recent = historyState({ job: { status: 'published', published_at: '2026-08-10T12:00:00.000Z' } }, 'post', 10, now);
  assert.equal(recent.historical, true);
  assert.equal(recent.historical_reason, 'published');
  assert.equal(recent.cleanup_eligible, false);

  const old = historyState({ job: { status: 'published', published_at: '2026-08-01T12:00:00.000Z' } }, 'post', 10, now);
  assert.equal(old.cleanup_eligible, true);
});

test('weekly stories stay active after publishing until manually archived', () => {
  const weekly = historyState({
    schedule_kind: 'weekly',
    jobs: [{ status: 'published', published_at: '2026-08-01T12:00:00.000Z' }],
  }, 'story', 10, now);
  assert.equal(weekly.historical, false);

  const archived = historyState({
    schedule_kind: 'weekly',
    archived_at: '2026-08-01T12:00:00.000Z',
  }, 'story', 10, now);
  assert.equal(archived.historical, true);
  assert.equal(archived.historical_reason, 'archived');
  assert.equal(archived.cleanup_eligible, true);
});

test('future games do not become historical from an already published announcement', () => {
  const state = historyState({
    kickoff_at: '2026-08-20T12:00:00.000Z',
    jobs: [{ status: 'published', published_at: '2026-08-17T12:00:00.000Z' }],
  }, 'game', 10, now);
  assert.equal(state.historical, false);
});

test('cleanup summary separates historical and eligible records', () => {
  const summary = cleanupSummary({
    game: [{ archived_at: '2026-08-01T12:00:00.000Z' }],
    post: [{ job: { status: 'published', published_at: '2026-08-17T12:00:00.000Z' } }],
    story: [],
  }, 10, now);
  assert.deepEqual(summary, {
    game: { historical: 1, eligible: 1 },
    post: { historical: 1, eligible: 0 },
    story: { historical: 0, eligible: 0 },
  });
});
