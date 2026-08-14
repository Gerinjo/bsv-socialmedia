import { STORY_ASSETS, STORY_TEMPLATES } from './story-assets.generated.ts';

export const STORY_TYPES = ['announcement', 'lineup', 'result', 'report', 'birthday'] as const;
export type StoryType = typeof STORY_TYPES[number];

const TEAM_DISPLAY_NAMES = new Map([
  [
    'SG Nordstern Radolfzell/Öhningen-Gaienhofen/Bankholzen-Moos',
    'SG Nordstern Radolfzell / Höri',
  ],
]);

const TRANSPARENT_PIXEL_DATA_URI = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

type StoryInput = Record<string, unknown>;
type Lineup = { players?: Array<{ number?: string | number; name?: string }> };

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export const edgeFontBuffers = [
  STORY_ASSETS.captureFont.base64,
  STORY_ASSETS.notoSansRegular.base64,
  STORY_ASSETS.notoSansBlack.base64,
  STORY_ASSETS.notoSerifItalic.base64,
].map(decodeBase64);

function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function fillTemplate(template: string, values: Record<string, unknown>, rawKeys = new Set<string>()): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_token, key: string) => {
    if (!(key in values)) throw new Error(`Fehlender Template-Wert: ${key}`);
    return rawKeys.has(key) ? String(values[key]) : xmlEscape(values[key]);
  });
}

function text(value: unknown, fallback = 'NOCH OFFEN'): string {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function truncate(value: unknown, maximum: number): string {
  const normalized = text(value);
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1).trimEnd()}…` : normalized;
}

function birthdayRoleText(value: unknown): string {
  const roles = Array.isArray(value) ? value : [value];
  return [...new Set(roles
    .map((role) => String(role ?? '').trim())
    .filter((role) => role && role.toLocaleLowerCase('de-DE') !== 'vereinsmitglied'))]
    .join(' · ');
}

function displayTeamName(value: unknown): string {
  const normalized = text(value);
  for (const [fullName, displayName] of TEAM_DISPLAY_NAMES) {
    if (normalized === fullName) return displayName;
    if (normalized.startsWith(`${fullName} `)) {
      return `${displayName}${normalized.slice(fullName.length)}`;
    }
  }
  return normalized;
}

function teamCrestKey(value: unknown): 'bsv' | 'tsv-aach-linz' | undefined {
  const normalized = String(value ?? '')
    .trim()
    .toLocaleLowerCase('de-DE')
    .replaceAll(/[^a-z0-9äöüß]+/g, ' ')
    .replaceAll(/\s+/g, ' ');
  if (normalized.includes('nordstern radolfzell')) return 'bsv';
  if (normalized === 'tsv aach linz' || normalized.startsWith('tsv aach linz ')) return 'tsv-aach-linz';
  return undefined;
}

function lineupRows(players: Lineup['players'] = []): string {
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

function outcome(match: StoryInput): string {
  const home = Number(match.homeScore);
  const away = Number(match.awayScore);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return 'ERGEBNIS';
  if (home > away) return 'HEIMSIEG';
  if (home < away) return 'AUSWÄRTSSIEG';
  return 'UNENTSCHIEDEN';
}

function fittedSize(value: unknown, regularSize: number, compactSize: number, threshold: number): number {
  return text(value).length > threshold ? compactSize : regularSize;
}

function resultLabelSize(value: unknown): number {
  const length = text(value).length;
  if (length <= 10) return 126;
  if (length <= 18) return 84;
  if (length <= 26) return 60;
  return 48;
}

export function renderStorySvg({
  type,
  match,
  lineup = { players: [] },
  imageAssets,
  playerPhotoDataUri,
  actionPhotoDataUri,
  homeCrestDataUri,
  awayCrestDataUri,
}: {
  type: StoryType;
  match: StoryInput;
  lineup?: Lineup;
  imageAssets: { logo: string; sparkasseLogo: string; actionPlayer: string };
  playerPhotoDataUri?: string;
  actionPhotoDataUri?: string;
  homeCrestDataUri?: string;
  awayCrestDataUri?: string;
}): string {
  if (!STORY_TYPES.includes(type)) throw new Error(`Unbekannter Story-Typ: ${type}`);

  const resultLabel = text(match.resultLabel, outcome(match));
  const resultMessage = truncate(match.resultMessage, 52);
  const homeCrestKey = teamCrestKey(match.homeTeam);
  const awayCrestKey = teamCrestKey(match.awayTeam);
  const embeddedHomeCrestDataUri = homeCrestKey === 'bsv'
    ? imageAssets.logo
    : homeCrestKey === 'tsv-aach-linz'
      ? `data:${STORY_ASSETS.tsvAachLinzCrest.mime};base64,${STORY_ASSETS.tsvAachLinzCrest.base64}`
      : TRANSPARENT_PIXEL_DATA_URI;
  const embeddedAwayCrestDataUri = awayCrestKey === 'bsv'
    ? imageAssets.logo
    : awayCrestKey === 'tsv-aach-linz'
      ? `data:${STORY_ASSETS.tsvAachLinzCrest.mime};base64,${STORY_ASSETS.tsvAachLinzCrest.base64}`
      : TRANSPARENT_PIXEL_DATA_URI;
  const resolvedHomeCrestDataUri = homeCrestDataUri || embeddedHomeCrestDataUri;
  const resolvedAwayCrestDataUri = awayCrestDataUri || embeddedAwayCrestDataUri;
  const hasHomeCrest = Boolean(homeCrestDataUri || homeCrestKey);
  const hasAwayCrest = Boolean(awayCrestDataUri || awayCrestKey);
  const birthdayRole = birthdayRoleText(match.birthdayRoles ?? match.birthdayRole);
  const gameStatusLabel = match.gameStatus === 'cancelled'
    ? 'ABGESAGT'
    : match.gameStatus === 'aborted'
      ? 'ABGEBROCHEN'
      : '';
  const kicker = type === 'announcement'
    ? 'MATCHDAY'
    : type === 'lineup'
      ? 'MATCHDAY · STARTELF'
      : type === 'report'
        ? 'ABPFIFF · BERICHT'
        : 'ABPFIFF · ERGEBNIS';
  const resolvedActionPhotoDataUri = actionPhotoDataUri || match.actionPhotoDataUri;
  const values = {
    LOGO_DATA_URI: imageAssets.logo,
    SPARKASSE_LOGO_DATA_URI: imageAssets.sparkasseLogo,
    ACTION_PLAYER_DATA_URI: resolvedActionPhotoDataUri || imageAssets.actionPlayer,
    HANDWRITTEN_FONT_DATA_URI: `data:${STORY_ASSETS.captureFont.mime};base64,${STORY_ASSETS.captureFont.base64}`,
    PLAYER_PHOTO_DATA_URI: resolvedActionPhotoDataUri || playerPhotoDataUri || imageAssets.actionPlayer,
    HOME_CREST_DATA_URI: resolvedHomeCrestDataUri,
    HOME_CREST_OPACITY: hasHomeCrest ? 1 : 0,
    AWAY_CREST_DATA_URI: resolvedAwayCrestDataUri,
    AWAY_CREST_OPACITY: hasAwayCrest ? 1 : 0,
    DUEL_MARK_OPACITY: hasHomeCrest && hasAwayCrest ? 1 : 0.3,
    GAME_STATUS_LABEL: gameStatusLabel,
    GAME_STATUS_OPACITY: gameStatusLabel ? 1 : 0,
    GAME_STATUS_SIZE: gameStatusLabel === 'ABGEBROCHEN' ? 130 : 160,
    KICKER: kicker,
    HOME_TEAM: truncate(displayTeamName(match.homeTeam), 32),
    HOME_TEAM_SIZE: fittedSize(displayTeamName(match.homeTeam), 44, 36, 24),
    AWAY_TEAM: truncate(displayTeamName(match.awayTeam), 32),
    AWAY_TEAM_SIZE: fittedSize(displayTeamName(match.awayTeam), 44, 36, 24),
    COMPETITION: truncate(match.competition, 36),
    DATE: text(match.date),
    TIME: text(match.time),
    VENUE: truncate(match.venue, 44),
    MATCH_ID_SHORT: truncate(match.matchId, 22),
    FORMATION: text(match.formation, 'FORMATION FOLGT'),
    PLAYER_ROWS: lineupRows(lineup.players),
    HOME_SCORE: Number.isFinite(Number(match.homeScore)) ? Number(match.homeScore) : '–',
    AWAY_SCORE: Number.isFinite(Number(match.awayScore)) ? Number(match.awayScore) : '–',
    RESULT_LABEL: truncate(resultLabel, 32),
    RESULT_LABEL_SIZE: resultLabelSize(resultLabel),
    RESULT_MESSAGE: resultMessage,
    RESULT_MESSAGE_SIZE: fittedSize(resultMessage, 40, 32, 38),
    BIRTHDAY_NAME: truncate(match.birthdayName, 28),
    BIRTHDAY_NAME_SIZE: fittedSize(match.birthdayName, 27, 21, 18),
    BIRTHDAY_ROLE: birthdayRole.length > 34 ? `${birthdayRole.slice(0, 33).trimEnd()}…` : birthdayRole,
    BIRTHDAY_ROLE_SIZE: birthdayRole.length > 18 ? 32 : 40,
    BIRTHDAY_MESSAGE: truncate(match.birthdayMessage, 54),
  };

  return fillTemplate(STORY_TEMPLATES[type], values, new Set(['PLAYER_ROWS']));
}
