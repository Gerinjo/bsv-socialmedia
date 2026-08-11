import { build } from '../../bsv-website/node_modules/esbuild/lib/main.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const websiteRoot = new URL('../../bsv-website/', import.meta.url);
const websiteBaseUrl = 'https://gerinjo.github.io/bsv-website';
const activeTeamPaths = [
  'fussball/herren/bezirksliga',
  'fussball/herren/kreisliga-2',
  'fussball/frauen/bezirksliga',
  'fussball/frauen/kreisliga',
];
const teamSlugs = new Map([
  ['fussball/herren/bezirksliga', 'herren-1'],
  ['fussball/herren/kreisliga-2', 'herren-2'],
  ['fussball/frauen/bezirksliga', 'frauen-1'],
  ['fussball/frauen/kreisliga', 'frauen-2'],
]);
const nameCorrections = new Map([
  ['Eberhardt Klinkenberg', 'Eberhard Klinkenberg'],
  ['Migo Jentsch', 'Michael Jentsch'],
]);

function slugify(value) {
  return value
    .replaceAll('ß', 'ss')
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

async function loadModule(entryPoint) {
  const result = await build({
    absWorkingDir: new URL('.', websiteRoot).pathname,
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  });
  const source = Buffer.from(result.outputFiles[0].contents).toString('base64');
  return import(`data:text/javascript;base64,${source}`);
}

function splitKicker(kicker) {
  const separator = kicker.indexOf(' · ');
  return separator < 0
    ? { name: kicker, competition: '' }
    : { name: kicker.slice(0, separator), competition: kicker.slice(separator + 3) };
}

function squadEntries(lines = []) {
  return lines.flatMap((line) => {
    const separator = line.indexOf(':');
    if (separator < 0) return [];
    return line.slice(separator + 1).split(',').flatMap((rawName) => {
      const roleMatch = rawName.match(/\(([^)]+)\)/);
      const name = nameCorrections.get(rawName.replace(/\([^)]+\)/g, '').trim())
        ?? rawName.replace(/\([^)]+\)/g, '').trim();
      if (!name || /^(BSV|SVM)$/i.test(name)) return [];
      const role = /trainer/i.test(roleMatch?.[1] ?? '')
        ? (roleMatch?.[1] ?? 'Trainer')
        : /betreuer/i.test(roleMatch?.[1] ?? '')
          ? (roleMatch?.[1] ?? 'Betreuer')
          : 'Spieler:in';
      return [{ name, role }];
    });
  });
}

const [{ teamProfiles }, { personImageByName }] = await Promise.all([
  loadModule('src/data/teamPages.ts'),
  loadModule('src/data/personImages.ts'),
]);

const teams = activeTeamPaths.map((path, index) => {
  const profile = teamProfiles[path];
  const { name, competition } = splitKicker(profile.kicker);
  return {
    slug: teamSlugs.get(path),
    name,
    competition,
    websitePath: path,
    fussballDeUrl: profile.fussballDeUrl ?? null,
    sortOrder: index + 1,
  };
});

const people = new Map();
function addPerson(name, { role, photoPath } = {}) {
  const normalizedName = nameCorrections.get(name) ?? name;
  const current = people.get(normalizedName) ?? {
    slug: slugify(normalizedName),
    displayName: normalizedName,
    roles: new Set(),
    photoUrl: null,
  };
  if (role) current.roles.add(role);
  if (photoPath) current.photoUrl = new URL(photoPath.replace(/^\//, ''), `${websiteBaseUrl}/`).href;
  people.set(normalizedName, current);
}

for (const [name, photoPath] of Object.entries(personImageByName)) {
  addPerson(name, { role: 'Vereinsmitglied', photoPath });
}
for (const profile of Object.values(teamProfiles)) {
  for (const coach of profile.coaches ?? []) {
    addPerson(coach.name, { role: coach.role, photoPath: coach.image });
  }
}

const memberships = [];
for (const path of activeTeamPaths) {
  const teamSlug = teamSlugs.get(path);
  const profile = teamProfiles[path];
  const entries = [
    ...(profile.coaches ?? []).map((coach) => ({ name: coach.name, role: coach.role })),
    ...squadEntries(profile.squad),
  ];
  for (const entry of entries) {
    addPerson(entry.name, { role: entry.role });
    memberships.push({ teamSlug, personSlug: slugify(nameCorrections.get(entry.name) ?? entry.name), role: entry.role });
  }
}

const catalog = {
  source: 'bsv-website',
  sourceUrl: websiteBaseUrl,
  generatedAt: new Date().toISOString(),
  venues: ['Hauptplatz', 'Nebenplatz', 'Kunstrasenplatz 1', 'Kunstrasenplatz 2'],
  teams,
  people: [...people.values()].map((person) => ({ ...person, roles: [...person.roles].sort() }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de')),
  memberships: [...new Map(memberships.map((entry) => [`${entry.teamSlug}:${entry.personSlug}:${entry.role}`, entry])).values()],
};

const output = new URL('../config/bsv-catalog.json', import.meta.url);
await mkdir(new URL('../config/', import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`BSV-Katalog: ${catalog.teams.length} aktive Teams, ${catalog.people.length} Personen, ${catalog.memberships.length} Zuordnungen.`);
console.log(pathToFileURL(output.pathname).href);
