const glyphNames = new Map(Object.entries({
  space: ' ', comma: ',', period: '.', colon: ':', semicolon: ';', hyphen: '-', minus: '-',
  slash: '/', backslash: '\\', parenleft: '(', parenright: ')', ampersand: '&', plus: '+',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9',
  Adieresis: 'Ä', Odieresis: 'Ö', Udieresis: 'Ü',
  adieresis: 'ä', odieresis: 'ö', udieresis: 'ü', germandbls: 'ß',
  Eacute: 'É', eacute: 'é', Agrave: 'À', agrave: 'à',
  apostrophe: "'", quotesingle: "'", quotedbl: '"',
}));

function glyphNameToCharacter(name) {
  if (!name || name === '.notdef') return null;
  if ([...name].length === 1) return name;
  if (glyphNames.has(name)) return glyphNames.get(name);
  const unicodeName = /^(?:uni([0-9a-f]{4})|u([0-9a-f]{4,6}))$/i.exec(name);
  if (unicodeName) return String.fromCodePoint(Number.parseInt(unicodeName[1] ?? unicodeName[2], 16));
  return null;
}

export function decodeWidgetText(value, glyphNameForCharacter) {
  if (value == null) return '';
  let decoded = '';
  for (const character of String(value)) {
    const codePoint = character.codePointAt(0);
    if ((codePoint >= 0xe000 && codePoint <= 0xf8ff)
      || (codePoint >= 0xf0000 && codePoint <= 0xffffd)
      || (codePoint >= 0x100000 && codePoint <= 0x10fffd)) {
      const replacement = glyphNameToCharacter(glyphNameForCharacter(character));
      if (replacement == null) throw new Error(`Unbekanntes Zeichen im FUSSBALL.DE-Widget (U+${codePoint.toString(16).toUpperCase()}).`);
      decoded += replacement;
    } else {
      decoded += character;
    }
  }
  return decoded
    .replaceAll(/[\u200b-\u200d\ufeff]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

export function extractWidgetPageProps(html) {
  const match = String(html).match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('FUSSBALL.DE liefert keine auslesbaren Widget-Daten.');
  const payload = JSON.parse(match[1]);
  const pageProps = payload?.props?.pageProps;
  if (!pageProps || !Array.isArray(pageProps.nextMatches)) throw new Error('Das FUSSBALL.DE-Widget hat ein unbekanntes Datenformat.');
  if (pageProps.invalidReferrer) throw new Error('FUSSBALL.DE hat die BSV-Webseite als Quelle abgelehnt.');
  return pageProps;
}

function zonedDate(parts, timeZone = 'Europe/Berlin') {
  const intendedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let candidate = intendedUtc;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const rendered = Object.fromEntries(formatter.formatToParts(new Date(candidate))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]));
    const renderedUtc = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute, rendered.second);
    candidate += intendedUtc - renderedUtc;
  }
  return new Date(candidate);
}

export function parseGermanKickoff(dateWithWeekday, time) {
  const dateMatch = String(dateWithWeekday).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  const timeMatch = String(time).match(/(\d{1,2}):(\d{2})/);
  if (!dateMatch || !timeMatch) throw new Error(`Anstoß konnte nicht gelesen werden: ${dateWithWeekday}, ${time}`);
  const kickoff = zonedDate({
    year: Number(dateMatch[3]), month: Number(dateMatch[2]), day: Number(dateMatch[1]),
    hour: Number(timeMatch[1]), minute: Number(timeMatch[2]),
  });
  if (Number.isNaN(kickoff.getTime())) throw new Error('Der gelesene Anstoß ist ungültig.');
  return kickoff.toISOString();
}

function mapStatus(status) {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized.includes('cancel')) return 'cancelled';
  if (normalized.includes('postpon')) return 'postponed';
  if (normalized.includes('abort')) return 'aborted';
  if (normalized.includes('finish')) return 'finished';
  if (normalized.includes('live')) return 'live';
  return 'scheduled';
}

export function parseNextMatches(pageProps, glyphNameForCharacter) {
  const decode = (value) => decodeWidgetText(value, glyphNameForCharacter);
  return pageProps.nextMatches.map((match) => ({
    sourceMatchId: String(match.id ?? '').trim(),
    status: mapStatus(match.status),
    kickoffAt: parseGermanKickoff(decode(match.kickoff?.dateWithWeekday ?? match.kickoff?.date), decode(match.kickoff?.time)),
    competition: decode(match.competitionName ?? pageProps.competitionName),
    homeTeam: {
      name: decode(match.homeTeam?.name),
      teamPermanentId: String(match.homeTeam?.teamPermanentId ?? '').trim(),
      clubId: String(match.homeTeam?.clubId ?? '').trim(),
      crestSourceUrl: String(match.homeTeam?.clubLogoURL ?? '').trim() || null,
    },
    awayTeam: {
      name: decode(match.guestTeam?.name),
      teamPermanentId: String(match.guestTeam?.teamPermanentId ?? '').trim(),
      clubId: String(match.guestTeam?.clubId ?? '').trim(),
      crestSourceUrl: String(match.guestTeam?.clubLogoURL ?? '').trim() || null,
    },
  })).filter((match) => match.sourceMatchId && match.homeTeam.name && match.awayTeam.name);
}
