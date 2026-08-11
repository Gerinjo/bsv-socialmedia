import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { extname, resolve } from 'node:path';

export const STORY_TYPES = ['announcement', 'lineup', 'result', 'birthday'];

const TEAM_DISPLAY_NAMES = new Map([
  [
    'SG Nordstern Radolfzell/Öhningen-Gaienhofen/Bankholzen-Moos',
    'SG Nordstern Radolfzell / Höri',
  ],
]);

const TRANSPARENT_PIXEL_DATA_URI = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

const MIME_TYPES = new Map([
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.otf', 'font/otf'],
  ['.ttf', 'font/ttf'],
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

export function displayTeamName(value) {
  const normalized = text(value);
  for (const [fullName, displayName] of TEAM_DISPLAY_NAMES) {
    if (normalized === fullName) return displayName;
    if (normalized.startsWith(`${fullName} `)) {
      return `${displayName}${normalized.slice(fullName.length)}`;
    }
  }
  return normalized;
}

export function teamCrestKey(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLocaleLowerCase('de-DE')
    .replaceAll(/[^a-z0-9äöüß]+/g, ' ')
    .replaceAll(/\s+/g, ' ');
  if (normalized.includes('nordstern radolfzell')) return 'bsv';
  if (normalized === 'tsv aach linz' || normalized.startsWith('tsv aach linz ')) return 'tsv-aach-linz';
  return undefined;
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
      '<rect width="410" height="96" rx="32" fill="#ffffff"/>',
      '<circle cx="49" cy="48" r="35" fill="#dce9df"/>',
      '<circle cx="49" cy="48" r="30" fill="#a8cbb4"/>',
      `<text x="49" y="61" text-anchor="middle" class="number">${xmlEscape(player.number ?? '–')}</text>`,
      `<text x="102" y="61" class="player">${xmlEscape(truncate(player.name, 22))}</text>`,
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

function fittedSize(value, regularSize, compactSize, threshold) {
  return text(value).length > threshold ? compactSize : regularSize;
}

export async function renderStorySvg({ rootDir, type, match, lineup = { players: [] }, photoPath }) {
  if (!STORY_TYPES.includes(type)) throw new Error(`Unbekannter Story-Typ: ${type}`);

  const templatePath = resolve(rootDir, 'templates', `${type}.svg`);
  const logoPath = resolve(rootDir, 'brand/logos/bsv-nordstern.png');
  const sparkasseLogoPath = resolve(rootDir, 'brand/logos/sparkasse-hegau-bodensee-white.png');
  const tsvAachLinzCrestPath = resolve(rootDir, 'brand/logos/opponents/tsv-aach-linz.png');
  const actionPlayerPath = resolve(rootDir, 'brand/graphics/footballer-action-v2.png');
  const handwrittenFontPath = resolve(rootDir, 'brand/fonts/Capture it.ttf');
  const playerPhotoPath = photoPath ?? actionPlayerPath;
  const [template, logoDataUri, sparkasseLogoDataUri, tsvAachLinzCrestDataUri, actionPlayerDataUri, handwrittenFontDataUri, playerPhotoDataUri] = await Promise.all([
    readFile(templatePath, 'utf8'),
    fileDataUri(logoPath),
    fileDataUri(sparkasseLogoPath),
    fileDataUri(tsvAachLinzCrestPath),
    fileDataUri(actionPlayerPath),
    fileDataUri(handwrittenFontPath),
    fileDataUri(playerPhotoPath),
  ]);

  const resultLabel = text(match.resultLabel, outcome(match));
  const resultMessage = truncate(match.resultMessage, 52);
  const awayCrestKey = teamCrestKey(match.awayTeam);
  const awayCrestDataUri = awayCrestKey === 'bsv'
    ? logoDataUri
    : awayCrestKey === 'tsv-aach-linz'
      ? tsvAachLinzCrestDataUri
      : TRANSPARENT_PIXEL_DATA_URI;
  const hasAwayCrest = Boolean(awayCrestKey);
  const values = {
    LOGO_DATA_URI: logoDataUri,
    SPARKASSE_LOGO_DATA_URI: sparkasseLogoDataUri,
    ACTION_PLAYER_DATA_URI: actionPlayerDataUri,
    HANDWRITTEN_FONT_DATA_URI: handwrittenFontDataUri,
    PLAYER_PHOTO_DATA_URI: playerPhotoDataUri,
    AWAY_CREST_DATA_URI: awayCrestDataUri,
    AWAY_CREST_OPACITY: hasAwayCrest ? 1 : 0,
    AWAY_TEAM_Y: hasAwayCrest ? 383 : 344,
    DETAIL_DIVIDER_Y: hasAwayCrest ? 414 : 395,
    KICKER: type === 'announcement' ? 'MATCHDAY' : type === 'lineup' ? 'MATCHDAY · STARTELF' : 'ABPFIFF · ERGEBNIS',
    HOME_TEAM: truncate(displayTeamName(match.homeTeam), 32),
    AWAY_TEAM: truncate(displayTeamName(match.awayTeam), 32),
    COMPETITION: truncate(match.competition, 36),
    DATE: text(match.date),
    TIME: text(match.time),
    VENUE: truncate(match.venue, 44),
    MATCH_ID_SHORT: truncate(match.matchId, 22),
    FORMATION: text(match.formation, 'FORMATION FOLGT'),
    PLAYER_ROWS: lineupRows(lineup.players),
    HOME_SCORE: Number.isFinite(Number(match.homeScore)) ? Number(match.homeScore) : '–',
    AWAY_SCORE: Number.isFinite(Number(match.awayScore)) ? Number(match.awayScore) : '–',
    RESULT_LABEL: resultLabel,
    RESULT_LABEL_SIZE: fittedSize(resultLabel, 126, 98, 10),
    RESULT_MESSAGE: resultMessage,
    RESULT_MESSAGE_SIZE: fittedSize(resultMessage, 40, 32, 38),
    BIRTHDAY_NAME: truncate(match.birthdayName, 28),
    BIRTHDAY_NAME_SIZE: fittedSize(match.birthdayName, 27, 21, 18),
    BIRTHDAY_MESSAGE: truncate(match.birthdayMessage, 54),
  };

  return fillTemplate(template, values, new Set(['PLAYER_ROWS']));
}

export async function writeStoryFiles({ rootDir, type, match, lineup, photoPath, outputDir, basename = type }) {
  const svg = await renderStorySvg({ rootDir, type, match, lineup, photoPath });
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
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FONTCONFIG_FILE: resolve(rootDir, 'brand/fonts/fonts.conf'),
    },
  });

  if (result.error?.code === 'ENOENT') {
    throw new Error('ImageMagick fehlt. Bitte den Befehl `magick` installieren.');
  }
  if (result.status !== 0) {
    throw new Error(`JPG-Rendering fehlgeschlagen: ${result.stderr || result.stdout}`);
  }

  return { svgPath, jpgPath };
}
