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

console.log(`Projektstruktur geprüft: ${required.length} Pflichtdateien vorhanden.`);
