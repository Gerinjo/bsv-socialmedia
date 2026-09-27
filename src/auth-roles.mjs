export const TEAM_ROLES = ['admin', 'sm-team', 'referee-admin'];

export function normalizeTeamRole(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase('de-DE')
    .replace(/\s+/g, '-')
    .replace(/_+/g, '-');

  if (normalized === 'sm-team' || normalized === 'smteam') return 'sm-team';
  if (normalized === 'referee-admin' || normalized === 'schiedsrichteradmin') return 'referee-admin';
  if (normalized === 'admin') return 'admin';
  return '';
}

export function isAllowedTeamRole(value) {
  const role = normalizeTeamRole(value);
  return TEAM_ROLES.includes(role);
}
