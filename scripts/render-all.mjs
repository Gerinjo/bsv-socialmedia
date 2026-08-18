#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORY_TYPES, writeStoryFiles } from '../src/story-renderer.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const match = JSON.parse(await readFile(resolve(rootDir, 'examples/match.json'), 'utf8'));
const lineup = JSON.parse(await readFile(resolve(rootDir, 'examples/lineup.json'), 'utf8'));
const birthday = JSON.parse(await readFile(resolve(rootDir, 'examples/birthday.json'), 'utf8'));
const independentStory = JSON.parse(await readFile(resolve(rootDir, 'examples/story.json'), 'utf8'));
const outputDir = resolve(rootDir, 'output');

for (const type of STORY_TYPES) {
  const input = type === 'birthday' ? birthday : type === 'story' ? independentStory : match;
  const files = await writeStoryFiles({ rootDir, type, match: input, lineup, outputDir });
  console.log(`${type}: ${files.jpgPath}`);
}
