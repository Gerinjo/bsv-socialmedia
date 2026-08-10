#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeStoryFiles, STORY_TYPES } from '../src/story-renderer.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function json(filePath) {
  return JSON.parse(await readFile(resolve(rootDir, filePath), 'utf8'));
}

const type = option('type', 'announcement');
if (!STORY_TYPES.includes(type)) {
  throw new Error(`--type muss einer dieser Werte sein: ${STORY_TYPES.join(', ')}`);
}

const match = await json(option('input', 'examples/match.json'));
const lineupPath = option('lineup', 'examples/lineup.json');
const lineup = type === 'lineup' ? await json(lineupPath) : { players: [] };
const photoOption = option('photo');
const photoPath = photoOption ? resolve(rootDir, photoOption) : undefined;
const outputDir = resolve(rootDir, option('output', 'output'));
const files = await writeStoryFiles({ rootDir, type, match, lineup, photoPath, outputDir });

console.log(`SVG: ${files.svgPath}`);
console.log(`JPG: ${files.jpgPath}`);
