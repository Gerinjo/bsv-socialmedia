import test from 'node:test';
import assert from 'node:assert/strict';
import { currentWeeklyEventAt, nextStoryDueAt, nextWeeklyEventAt, nextWeeklyOccurrence } from '../src/story-schedule.mjs';

test('findet den nächsten Montag um 01:00 Uhr in Berlin', () => {
  assert.equal(nextWeeklyOccurrence({
    weekday: 1,
    time: '01:00',
    after: new Date('2026-08-18T10:00:00Z'),
  }), '2026-08-23T23:00:00.000Z');
});

test('behält die lokale Uhrzeit beim Wechsel auf Winterzeit bei', () => {
  assert.equal(nextWeeklyOccurrence({
    weekday: 1,
    time: '01:00',
    after: new Date('2026-10-19T00:00:00Z'),
  }), '2026-10-26T00:00:00.000Z');
});

test('übernimmt einen Einzeltermin unverändert', () => {
  assert.equal(nextStoryDueAt({ schedule_kind: 'once', publish_at: '2026-09-01T07:30:00Z' }), '2026-09-01T07:30:00.000Z');
});

test('schreibt den sichtbaren Serientermin lokal um eine Woche fort', () => {
  assert.equal(nextWeeklyEventAt('2026-10-21T16:00:00Z'), '2026-10-28T17:00:00.000Z');
  assert.equal(currentWeeklyEventAt('2026-08-12T16:00:00Z', new Date('2026-08-18T10:00:00Z')), '2026-08-19T16:00:00.000Z');
});
