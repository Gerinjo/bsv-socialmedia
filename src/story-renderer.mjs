import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { extname, resolve } from 'node:path';

export const STORY_TYPES = ['announcement', 'lineup', 'result'];

const MIME_TYPES = new Map([
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
]);

export function xmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function fillTemplate(template, values, rawKeys = new Set()) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_token, key) => {
    if (!(key in values)) throw new Error(`Fehlender Template-Wert: ${key}`);
    return rawKeys.has(key) ? String(values[key]) : xmlEscape(values[key]);
  });
}

export async function fileDataUri(filePath) {
  const extension = extname(filePath).toLowerCase();
  const mime = MIME_TYPES.get(extension);
  if (!mime) throw new Error(`Nicht unterstütztes Logoformat: ${extension}`);
  const data = await readFile(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

function text(value, fallback = 'NOCH OFFEN') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function truncate(value, maximum) {
  const normalized = text(value);
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1).trimEnd()}…` : normalized;
}

function lineupRows(players = []) {
  const normalized = players.slice(0, 11);
  if (!normalized.length) {
    return '<text x="540" y="1000" text-anchor="middle" class="empty">AUFSTELLUNG FOLGT</text>';
  }

  return normalized.map((player, index) => {
    const column = index < 6 ? 0 : 1;
    const row = column === 0 ? index : index - 6;
    const x = column === 0 ? 95 : 575;
    const y = 735 + row * 126;
    return [
      `<g transform="translate(${x} ${y})">`,
      '<rect width="410" height="96" fill="#ffffff"/>',
      '<rect width="88" height="96" fill="#a8cbb4"/>',
      `<text x="44" y="63" text-anchor="middle" class="number">${xmlEscape(player.number ?? '–')}</text>`,
      `<text x="112" y="61" class="player">${xmlEscape(truncate(player.name, 22))}</text>`,
      '</g>',
    ].join('');
  }).join('');
}

function outcome(match) {
  const home = Number(match.homeScore);
  const away = Number(match.awayScore);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return 'ERGEBNIS';
  if (home > away) return 'HEIMSIEG';
  if (home < away) return 'AUSWÄRTSSIEG';
  return 'UNENTSCHIEDEN';
}

export async function renderStorySvg({ rootDir, type, match, lineup = { players: [] } }) {
  if (!STORY_TYPES.includes(type)) throw new Error(`Unbekannter Story-Typ: ${type}`);

  const templatePath = resolve(rootDir, 'templates', `${type}.svg`);
  const logoPath = resolve(rootDir, 'brand/logos/bsv-nordstern.gif');
  const [template, logoDataUri] = await Promise.all([
    readFile(templatePath, 'utf8'),
    fileDataUri(logoPath),
  ]);

  const values = {
    LOGO_DATA_URI: logoDataUri,
    KICKER: type === 'announcement' ? 'MATCHDAY · MORGEN' : type === 'lineup' ? 'MATCHDAY · STARTELF' : 'ABPFIFF · ERGEBNIS',
    HOME_TEAM: truncate(match.homeTeam, 32),
    AWAY_TEAM: truncate(match.awayTeam, 32),
    COMPETITION: truncate(match.competition, 36),
    DATE: text(match.date),
    TIME: text(match.time),
    VENUE: truncate(match.venue, 44),
    MATCH_ID_SHORT: truncate(match.matchId, 22),
    FORMATION: text(match.formation, 'FORMATION FOLGT'),
    PLAYER_ROWS: lineupRows(lineup.players),
    HOME_SCORE: Number.isFinite(Number(match.homeScore)) ? Number(match.homeScore) : '–',
    AWAY_SCORE: Number.isFinite(Number(match.awayScore)) ? Number(match.awayScore) : '–',
    RESULT_LABEL: text(match.resultLabel, outcome(match)),
    RESULT_MESSAGE: truncate(match.resultMessage, 52),
  };

  return fillTemplate(template, values, new Set(['PLAYER_ROWS']));
}

export async function writeStoryFiles({ rootDir, type, match, lineup, outputDir, basename = type }) {
  const svg = await renderStorySvg({ rootDir, type, match, lineup });
  await mkdir(outputDir, { recursive: true });

  const svgPath = resolve(outputDir, `${basename}.svg`);
  const jpgPath = resolve(outputDir, `${basename}.jpg`);
  await writeFile(svgPath, svg, 'utf8');

  const result = spawnSync('magick', [
    svgPath,
    '-colorspace', 'sRGB',
    '-strip',
    '-interlace', 'Plane',
    '-sampling-factor', '4:2:0',
    '-quality', '90',
    jpgPath,
  ], { encoding: 'utf8' });

  if (result.error?.code === 'ENOENT') {
    throw new Error('ImageMagick fehlt. Bitte den Befehl `magick` installieren.');
  }
  if (result.status !== 0) {
    throw new Error(`JPG-Rendering fehlgeschlagen: ${result.stderr || result.stdout}`);
  }

  return { svgPath, jpgPath };
}
