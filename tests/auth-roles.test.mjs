import test from 'node:test';
import assert from 'node:assert/strict';

import { TEAM_ROLES, isAllowedTeamRole, normalizeTeamRole } from '../src/auth-roles.mjs';

test('team roles normalize and validate correctly', () => {
  assert.deepEqual(TEAM_ROLES, ['admin', 'sm-team']);
  assert.equal(normalizeTeamRole('Admin'), 'admin');
  assert.equal(normalizeTeamRole('SM-Team'), 'sm-team');
  assert.equal(normalizeTeamRole('sm team'), 'sm-team');
  assert.equal(normalizeTeamRole('   admin  '), 'admin');
  assert.equal(isAllowedTeamRole('admin'), true);
  assert.equal(isAllowedTeamRole('sm-team'), true);
  assert.equal(isAllowedTeamRole('guest'), false);
  assert.equal(isAllowedTeamRole(null), false);
});
