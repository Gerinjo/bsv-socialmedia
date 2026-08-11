import { STORY_ASSETS, STORY_TEMPLATES } from './story-assets.generated.ts';

export const STORY_TYPES = ['announcement', 'lineup', 'result', 'birthday'] as const;
export type StoryType = typeof STORY_TYPES[number];

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

export function renderStorySvg({
  type,
  match,
  lineup = { players: [] },
  imageAssets,
  playerPhotoDataUri,
}: {
  type: StoryType;
  match: StoryInput;
  lineup?: Lineup;
  imageAssets: { logo: string; sparkasseLogo: string; actionPlayer: string };
  playerPhotoDataUri?: string;
}): string {
  if (!STORY_TYPES.includes(type)) throw new Error(`Unbekannter Story-Typ: ${type}`);

  const resultLabel = text(match.resultLabel, outcome(match));
  const resultMessage = truncate(match.resultMessage, 52);
  const values = {
    LOGO_DATA_URI: imageAssets.logo,
    SPARKASSE_LOGO_DATA_URI: imageAssets.sparkasseLogo,
    ACTION_PLAYER_DATA_URI: imageAssets.actionPlayer,
    HANDWRITTEN_FONT_DATA_URI: `data:${STORY_ASSETS.captureFont.mime};base64,${STORY_ASSETS.captureFont.base64}`,
    PLAYER_PHOTO_DATA_URI: playerPhotoDataUri || imageAssets.actionPlayer,
    KICKER: type === 'announcement' ? 'MATCHDAY' : type === 'lineup' ? 'MATCHDAY · STARTELF' : 'ABPFIFF · ERGEBNIS',
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
    RESULT_LABEL: resultLabel,
    RESULT_LABEL_SIZE: fittedSize(resultLabel, 126, 98, 10),
    RESULT_MESSAGE: resultMessage,
    RESULT_MESSAGE_SIZE: fittedSize(resultMessage, 40, 32, 38),
    BIRTHDAY_NAME: truncate(match.birthdayName, 28),
    BIRTHDAY_NAME_SIZE: fittedSize(match.birthdayName, 27, 21, 18),
    BIRTHDAY_MESSAGE: truncate(match.birthdayMessage, 54),
  };

  return fillTemplate(STORY_TEMPLATES[type], values, new Set(['PLAYER_ROWS']));
}
