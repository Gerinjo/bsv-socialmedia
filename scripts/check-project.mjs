#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORY_TYPES } from '../src/story-renderer.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'README.md',
  'brand/tokens.json',
  'brand/logos/bsv-nordstern.png',
  'docs/corporate-design.md',
  'docs/corporate-design.html',
  'docs/automation-architecture.md',
  'supabase/config.toml',
  ...STORY_TYPES.map((type) => `templates/${type}.svg`),
];

for (const file of required) await access(resolve(rootDir, file));

for (const type of STORY_TYPES) {
  const source = await readFile(resolve(rootDir, 'templates', `${type}.svg`), 'utf8');
  const expectedHeight = type === 'report' ? '1080' : '1920';
  if (!source.includes('width="1080"') || !source.includes(`height="${expectedHeight}"`)) {
    throw new Error(`${type}.svg hat nicht das Format 1080 × ${expectedHeight}.`);
  }
  if (!source.includes('{{LOGO_DATA_URI}}')) {
    throw new Error(`${type}.svg enthält keinen Logo-Platzhalter.`);
  }
}

const adminPage = await readFile(resolve(rootDir, 'admin-site/admin-page.html'), 'utf8');
const adminApi = await readFile(resolve(rootDir, 'supabase/functions/social-media-admin-api/index.ts'), 'utf8');
const edgeRenderer = await readFile(resolve(rootDir, 'supabase/functions/story-renderer/index.ts'), 'utf8');
const socialWorker = await readFile(resolve(rootDir, 'supabase/functions/social-media-worker/index.ts'), 'utf8');
for (const marker of ['workspaceSearch', 'memberSearch', 'crestSearch', 'discardCrest', 'remove-report-image', 'markReportNeedsApproval', 'reportApprovalView', 'report-action-bar']) {
  if (!adminPage.includes(marker)) throw new Error(`Admin-Oberfläche enthält ${marker} nicht.`);
}
const reportSaveHandler = adminPage.match(/document\.querySelectorAll\('\.reportSave'\)[\s\S]*?document\.querySelectorAll\('\.reportApprove'\)/)?.[0] ?? '';
if (!reportSaveHandler || reportSaveHandler.includes("action:'approve_result'")) {
  throw new Error('Spielbericht speichern darf keine automatische Freigabe auslösen.');
}
if (!adminApi.includes("action === 'discard_club_crest'")) {
  throw new Error('Admin-API enthält das Verwerfen von Wappen-Uploads nicht.');
}
if (!adminApi.includes("last_error: 'Spielbericht wurde geändert. Bitte erneut freigeben.'")) {
  throw new Error('Admin-API macht eine alte Spielbericht-Freigabe nach Änderungen nicht ungültig.');
}
if (!edgeRenderer.includes('for (let index = 0; index < pageCount; index += 1)') || edgeRenderer.includes('Promise.all(svgs.map')) {
  throw new Error('Spielbericht-Seiten werden nicht ressourcenschonend nacheinander gerendert.');
}
if (!socialWorker.includes('reportPageIndex') || !socialWorker.includes('renderGamePreview(candidate)')) {
  throw new Error('Spielbericht-Seiten erhalten keine getrennten Renderer-Aufrufe.');
}

console.log(`Projektstruktur geprüft: ${required.length} Pflichtdateien vorhanden.`);
