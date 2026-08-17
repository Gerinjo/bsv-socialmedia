export const DEFAULT_TEAM_COLOR_SCHEME = Object.freeze({
  background: '#071f16',
  panel: '#164f32',
  primary: '#91c82f',
  accent: '#f4d638',
  muted: '#a8cbb4',
  surface: '#f4f1e8',
  ink: '#10251a',
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const COLOR_KEYS = Object.keys(DEFAULT_TEAM_COLOR_SCHEME);

export function normalizeTeamColorScheme(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(COLOR_KEYS.map((key) => {
    const candidate = String(input[key] ?? '').trim();
    return [key, HEX_COLOR.test(candidate) ? candidate.toLowerCase() : DEFAULT_TEAM_COLOR_SCHEME[key]];
  }));
}

export function teamContentEnabled(team) {
  return Boolean(team?.active && team?.content_enabled);
}

export function teamAllowsAutomaticPublishing(team, testMode) {
  return teamContentEnabled(team) && team?.publishing_mode === 'automatic' && testMode === false;
}

export function applyTeamColorScheme(svg, value) {
  const colors = normalizeTeamColorScheme(value);
  const replacements = new Map([
    ['#071f16', colors.background],
    ['#092f20', colors.background],
    ['#0b2b1e', colors.background],
    ['#0b2a1d', colors.background],
    ['#0f2f24', colors.background],
    ['#164f32', colors.panel],
    ['#0d3525', colors.panel],
    ['#91c82f', colors.primary],
    ['#f4d638', colors.accent],
    ['#a8cbb4', colors.muted],
    ['#cbd8ce', colors.muted],
    ['#6c7b71', colors.muted],
    ['#f4f1e8', colors.surface],
    ['#10251a', colors.ink],
  ]);
  return String(svg).replace(/#[0-9a-f]{6}/gi, (color) => replacements.get(color.toLowerCase()) ?? color);
}
