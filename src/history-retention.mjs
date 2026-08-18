export const DEFAULT_RETENTION_DAYS = 30;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

export function normalizeRetentionDays(value, fallback = DEFAULT_RETENTION_DAYS) {
  const days = Number(value);
  return Number.isInteger(days) && days >= MIN_RETENTION_DAYS && days <= MAX_RETENTION_DAYS
    ? days
    : fallback;
}

function timestamp(value) {
  const parsed = new Date(String(value ?? '')).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function jobsFor(record, relation = 'jobs') {
  const value = record?.[relation];
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function latestPublishedAt(record, relation = 'jobs') {
  const published = jobsFor(record, relation)
    .filter((job) => job?.status === 'published')
    .map((job) => timestamp(job.published_at))
    .filter((value) => value !== null);
  return published.length ? Math.max(...published) : null;
}

export function historyState(record, kind, retentionDays = DEFAULT_RETENTION_DAYS, now = Date.now()) {
  const archivedAt = timestamp(record?.archived_at);
  let historyAt = archivedAt;
  let reason = archivedAt === null ? null : 'archived';

  if (historyAt === null && kind === 'post') {
    historyAt = latestPublishedAt(record, 'job');
    reason = historyAt === null ? null : 'published';
  }

  if (historyAt === null && kind === 'story' && record?.schedule_kind === 'once') {
    historyAt = latestPublishedAt(record);
    reason = historyAt === null ? null : 'published';
  }

  if (historyAt === null && kind === 'game') {
    const kickoffAt = timestamp(record?.kickoff_at);
    if (kickoffAt !== null && kickoffAt <= now) {
      historyAt = latestPublishedAt(record);
      reason = historyAt === null ? null : 'published';
    }
  }

  if (historyAt === null) {
    return {
      historical: false,
      historical_reason: null,
      history_at: null,
      delete_after: null,
      cleanup_eligible: false,
    };
  }

  const days = normalizeRetentionDays(retentionDays);
  const deleteAfter = historyAt + days * 24 * 60 * 60 * 1000;
  return {
    historical: true,
    historical_reason: reason,
    history_at: new Date(historyAt).toISOString(),
    delete_after: new Date(deleteAfter).toISOString(),
    cleanup_eligible: deleteAfter <= now,
  };
}

export function withHistoryState(record, kind, retentionDays = DEFAULT_RETENTION_DAYS, now = Date.now()) {
  return { ...record, ...historyState(record, kind, retentionDays, now) };
}

export function cleanupSummary(records, retentionDays = DEFAULT_RETENTION_DAYS, now = Date.now()) {
  const kinds = ['game', 'post', 'story'];
  return Object.fromEntries(kinds.map((kind) => {
    const values = Array.isArray(records?.[kind]) ? records[kind] : [];
    const states = values.map((record) => historyState(record, kind, retentionDays, now));
    return [kind, {
      historical: states.filter((state) => state.historical).length,
      eligible: states.filter((state) => state.cleanup_eligible).length,
    }];
  }));
}
