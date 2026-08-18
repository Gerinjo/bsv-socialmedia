const WEEKDAY_FORMATTER_CACHE = new Map();

function formatter(timeZone) {
  if (!WEEKDAY_FORMATTER_CACHE.has(timeZone)) {
    WEEKDAY_FORMATTER_CACHE.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return WEEKDAY_FORMATTER_CACHE.get(timeZone);
}

function zonedParts(date, timeZone) {
  const values = Object.fromEntries(formatter(timeZone).formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function parseTime(value) {
  const match = String(value ?? '').match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) throw new Error('Die Uhrzeit muss im Format HH:MM angegeben werden.');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('Die Uhrzeit ist ungültig.');
  return { hour, minute };
}

function weekdayOf({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
}

function plusLocalDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function zonedDateTimeToUtc(parts, timeZone) {
  const wanted = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  let guess = wanted;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const difference = wanted - actualAsUtc;
    guess += difference;
    if (difference === 0) break;
  }
  return new Date(guess);
}

export function nextWeeklyOccurrence({ weekday, time, timeZone = 'Europe/Berlin', after = new Date() }) {
  const normalizedWeekday = Number(weekday);
  if (!Number.isInteger(normalizedWeekday) || normalizedWeekday < 1 || normalizedWeekday > 7) {
    throw new Error('Der Wochentag muss zwischen Montag (1) und Sonntag (7) liegen.');
  }
  const afterDate = after instanceof Date ? after : new Date(after);
  if (Number.isNaN(afterDate.getTime())) throw new Error('Der Bezugszeitpunkt ist ungültig.');
  const clock = parseTime(time);
  const localAfter = zonedParts(afterDate, timeZone);
  let days = (normalizedWeekday - weekdayOf(localAfter) + 7) % 7;
  let localDate = plusLocalDays(localAfter, days);
  let candidate = zonedDateTimeToUtc({ ...localDate, ...clock }, timeZone);
  if (candidate.getTime() <= afterDate.getTime()) {
    days += 7;
    localDate = plusLocalDays(localAfter, days);
    candidate = zonedDateTimeToUtc({ ...localDate, ...clock }, timeZone);
  }
  return candidate.toISOString();
}

export function nextStoryDueAt(story, after = new Date()) {
  if (story?.schedule_kind === 'once') {
    const publishAt = new Date(String(story.publish_at ?? ''));
    if (Number.isNaN(publishAt.getTime())) throw new Error('Der Veröffentlichungszeitpunkt ist ungültig.');
    return publishAt.toISOString();
  }
  if (story?.schedule_kind !== 'weekly') throw new Error('Die Veröffentlichungsregel ist ungültig.');
  return nextWeeklyOccurrence({
    weekday: story.weekly_weekday,
    time: String(story.weekly_time ?? '').slice(0, 5),
    timeZone: String(story.schedule_timezone || 'Europe/Berlin'),
    after,
  });
}

export function nextWeeklyEventAt(eventAt, timeZone = 'Europe/Berlin') {
  const current = eventAt instanceof Date ? eventAt : new Date(eventAt);
  if (Number.isNaN(current.getTime())) throw new Error('Der Story-Termin ist ungültig.');
  const local = zonedParts(current, timeZone);
  const nextDate = plusLocalDays(local, 7);
  return zonedDateTimeToUtc({ ...nextDate, hour: local.hour, minute: local.minute }, timeZone).toISOString();
}

export function currentWeeklyEventAt(eventAt, after = new Date(), timeZone = 'Europe/Berlin') {
  const event = eventAt instanceof Date ? eventAt : new Date(eventAt);
  const reference = after instanceof Date ? after : new Date(after);
  if (Number.isNaN(event.getTime()) || Number.isNaN(reference.getTime())) throw new Error('Der Story-Termin ist ungültig.');
  if (event.getTime() > reference.getTime()) return event.toISOString();
  const local = zonedParts(event, timeZone);
  return nextWeeklyOccurrence({
    weekday: weekdayOf(local),
    time: `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`,
    timeZone,
    after: reference,
  });
}
