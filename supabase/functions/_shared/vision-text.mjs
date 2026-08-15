const KINDS = new Set(['lineup', 'scorers']);

function requiredKind(value) {
  const kind = String(value ?? '').trim();
  if (!KINDS.has(kind)) throw new Error('Die gewünschte Bildauswertung ist ungültig.');
  return kind;
}

function cleanLines(value) {
  return String(value ?? '')
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/\s*```$/, '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, ''))
    .filter(Boolean);
}

export function visionTextPrompt(kindValue, game = {}) {
  const kind = requiredKind(kindValue);
  const bsvTeam = String(game.bsvTeam ?? '').trim() || 'die BSV-Mannschaft';
  const opponent = String(game.opponent ?? '').trim();
  const gameContext = opponent
    ? `Die gesuchte Mannschaft ist "${bsvTeam}", der Gegner ist "${opponent}".`
    : `Die gesuchte Mannschaft ist "${bsvTeam}".`;

  if (kind === 'lineup') {
    return [
      'Lies die Mannschaftsaufstellung aus diesem Bild.',
      gameContext,
      'Übernimm nur die klar als Startaufstellung erkennbaren Spieler dieser Mannschaft, höchstens elf Spieler.',
      'Gib pro Spieler genau eine Zeile im Format "01, Vorname Nachname" aus.',
      'Formatiere einstellige Rückennummern zweistellig. Behalte die Reihenfolge des Bildes bei.',
      'Gib keine Überschrift, keine Aufzählungszeichen, keine Ersatzspieler und keine Erklärung aus.',
      'Erfinde nichts. Kennzeichne einzelne unsichere Zeichen mit [?], damit ein Mensch sie korrigieren kann.',
    ].join(' ');
  }

  return [
    'Lies die Torschützen und Spielminuten aus diesem Bild.',
    gameContext,
    'Übernimm ausschließlich die Tore dieser Mannschaft.',
    'Fasse mehrere Tore derselben Person in einer Zeile zusammen.',
    'Gib pro Person genau eine Zeile im Format "(19., 46.) M. Oosbrugger" aus.',
    'Gib keine Überschrift, keine Aufzählungszeichen, kein Ergebnis und keine Erklärung aus.',
    'Erfinde nichts. Kennzeichne einzelne unsichere Zeichen mit [?], damit ein Mensch sie korrigieren kann.',
  ].join(' ');
}

export function normalizeVisionText(kindValue, value) {
  const kind = requiredKind(kindValue);
  const lines = cleanLines(value)
    .filter((line) => !/^(?:aufstellung|startelf|torschützen|tore)\s*:?\s*$/i.test(line));

  if (kind === 'lineup') {
    return lines.map((line) => {
      const match = /^(?:#\s*)?(\d{1,3})\s*(?:[,;:.)-]|\s)\s*(.+)$/.exec(line);
      if (!match) return line;
      return `${match[1].padStart(2, '0')}, ${match[2].trim()}`;
    }).slice(0, 11).join('\n');
  }

  return lines.map((line) => {
    const alreadyFormatted = /^\(([^)]+)\)\s+(.+)$/.exec(line);
    if (alreadyFormatted) return `(${alreadyFormatted[1].trim()}) ${alreadyFormatted[2].trim()}`;
    const nameFirst = /^(.+?)\s+\(([^)]+)\)$/.exec(line);
    if (nameFirst) return `(${nameFirst[2].trim()}) ${nameFirst[1].trim()}`;
    const minuteFirst = /^((?:\d{1,3}(?:\s*\.\s*)?)(?:\s*[,/]\s*\d{1,3}(?:\s*\.\s*)?)*)\s*[-,:]\s*(.+)$/.exec(line);
    if (!minuteFirst) return line;
    const minutes = minuteFirst[1].split(/[,/]/).map((minute) => `${minute.replace(/\s*\.\s*$/, '').trim()}.`).join(', ');
    return `(${minutes}) ${minuteFirst[2].trim()}`;
  }).slice(0, 4).join('\n');
}

export function responseOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  const parts = [];
  for (const output of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(output?.content) ? output.content : []) {
      if (typeof content?.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n');
}
