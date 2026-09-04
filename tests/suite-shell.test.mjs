import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminSource = readFileSync(new URL('../admin-site/admin-page.html', import.meta.url), 'utf8');

test('suite actions live in the header and use accessible icon buttons', () => {
  const header = adminSource.slice(adminSource.indexOf('<header>'), adminSource.indexOf('</header>'));
  assert.match(header, /id="reload"[^]*aria-label="Daten neu laden"/);
  assert.match(header, /id="logout"[^]*aria-label="Abmelden"/);
  assert.doesNotMatch(adminSource, />Neu laden<\/button>/);
  assert.doesNotMatch(adminSource, />Abmelden<\/button>/);
});

test('profile and operating mode are part of the sidebar', () => {
  const sidebar = adminSource.slice(adminSource.indexOf('<aside class="suite-sidebar"'), adminSource.indexOf('</aside>'));
  assert.ok(sidebar.indexOf('id="profile"') < sidebar.indexOf('data-suite-area="user_management"'));
  assert.match(sidebar, /id="suiteMode"/);
  assert.match(adminSource, /<h2>Profil<\/h2>/);
  assert.doesNotMatch(adminSource, /<h2>Einstellungen<\/h2>/);
});

test('sidebar can collapse while the content column grows', () => {
  assert.match(adminSource, /#app\.sidebar-collapsed\{--suite-sidebar-width:80px\}/);
  assert.match(adminSource, /localStorage\.getItem\('bsv-sidebar-collapsed'\)/);
  assert.match(adminSource, /\.sidebar-collapsed \.suite-nav-label[^]*display:none/);
  assert.match(adminSource, /\.sidebar-collapsed \.suite-subnav\{display:none!important\}/);
  assert.match(adminSource, /function updateSuiteMode\(\)/);
  assert.doesNotMatch(adminSource, /#identity/);
});

test('active work areas expose compact subnavigation in the sidebar', () => {
  const sidebar = adminSource.slice(adminSource.indexOf('<aside class="suite-sidebar"'), adminSource.indexOf('</aside>'));
  assert.match(sidebar, /id="socialMediaSubnav"[^]*id="gamesTabButton"[^]*id="postsTabButton"[^]*id="storiesTabButton"[^]*id="birthdaysTabButton"/);
  assert.match(sidebar, /id="sponsoringSubnav"[^]*>Werbepartner [^]*>Zuweisungen</);
  assert.match(sidebar, /id="administrationSubnav"[^]*>Mannschaften<[^]*>Vereinswappen [^]*>Instagram<[^]*>Aufbewahrung · 30 Tage</);
  assert.match(adminSource, /\.suite-nav-item\{min-height:44px;padding:8px 14px\}/);
  assert.match(adminSource, /\.suite-nav-item\.active\+\.suite-subnav\{display:grid\}/);
  assert.match(adminSource, /function updateSuiteNavigation\(area\)[^]*aria-expanded/);
});

test('redundant content navigation and permanent success status are removed', () => {
  const content = adminSource.slice(adminSource.indexOf('<div id="workspaceNav"'), adminSource.indexOf('<div id="status"'));
  assert.doesNotMatch(content, /class="tabs"/);
  assert.doesNotMatch(content, /class="admin-nav"/);
  assert.match(adminSource, /id="status" class="status-toast hidden"/);
  assert.doesNotMatch(adminSource, /Daten sind aktuell/);
});
