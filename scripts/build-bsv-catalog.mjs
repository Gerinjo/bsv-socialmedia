import { build } from '../../bsv-website/node_modules/esbuild/lib/main.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const websiteRoot = new URL('../../bsv-website/', import.meta.url);
const websiteBaseUrl = 'https://gerinjo.github.io/bsv-website';
const activeTeamPaths = new Set([
  'fussball/herren/bezirksliga',
  'fussball/herren/kreisliga-2',
  'fussball/frauen/bezirksliga',
  'fussball/frauen/kreisliga',
]);
const websiteTeams = [
  ['fussball/herren/bezirksliga', 'herren-1', 'BSV Nordstern Radolfzell', 10],
  ['fussball/herren/kreisliga-2', 'herren-2', 'SG Markelfingen/BSV Nordstern Radolfzell 2', 11],
  ['fussball/alte-herren', 'alte-herren', 'BSV Nordstern Radolfzell · Alte Herren', 12],
  ['fussball/frauen/bezirksliga', 'frauen-1', 'SG Nordstern Radolfzell/Öhningen-Gaienhofen/Bankholzen-Moos', 20],
  ['fussball/frauen/kreisliga', 'frauen-2', 'SG Nordstern Radolfzell/Öhningen-Gaienhofen/Bankholzen-Moos 2', 21],
  ['jugend/u19', 'u19-junioren', 'BSV Nordstern Radolfzell · U19 A-Junioren', 30],
  ['jugend/u17', 'u17-junioren', 'BSV Nordstern Radolfzell · U17 B-Junioren', 31],
  ['jugend/u15-c1', 'u15-c1-junioren', 'BSV Nordstern Radolfzell · U15 C1-Junioren', 32],
  ['jugend/u15-c2', 'u15-c2-junioren', 'BSV Nordstern Radolfzell · U15 C2-Junioren', 33],
  ['jugend/u13-d1', 'u13-d1-junioren', 'BSV Nordstern Radolfzell · U13 D1-Junioren', 34],
  ['jugend/u13-d2', 'u13-d2-junioren', 'BSV Nordstern Radolfzell · U13 D2-Junioren', 35],
  ['jugend/u13-d3', 'u13-d3-junioren', 'BSV Nordstern Radolfzell · U13 D3-Junioren', 36],
  ['jugend/u11-e1', 'u11-e1-junioren', 'BSV Nordstern Radolfzell · U11 E1-Junioren', 37],
  ['jugend/u11-e2', 'u11-e2-junioren', 'BSV Nordstern Radolfzell · U11 E2-Junioren', 38],
  ['jugend/u11-e3', 'u11-e3-junioren', 'BSV Nordstern Radolfzell · U11 E3-Junioren', 39],
  ['jugend/u9-f', 'u9-f-junioren', 'BSV Nordstern Radolfzell · U9 F-Junioren', 40],
  ['jugend/u8-f', 'u8-f-junioren', 'BSV Nordstern Radolfzell · U8 F-Junioren', 41],
  ['jugend/u7-g', 'u7-bambinis', 'BSV Nordstern Radolfzell · U7 Bambinis', 42],
  ['jugend/u6-g', 'u6-spielgruppe', 'BSV Nordstern Radolfzell · U6 Spielgruppe', 43],
  ['jugend/juniorinnen/u17', 'u17-juniorinnen', 'BSV Nordstern Radolfzell · U17 B-Juniorinnen', 50],
  ['jugend/juniorinnen/u15', 'u15-juniorinnen', 'BSV Nordstern Radolfzell · U15 C-Juniorinnen', 51],
  ['jugend/juniorinnen/u13', 'u13-juniorinnen', 'BSV Nordstern Radolfzell · U13 D-Juniorinnen', 52],
];
const teamSlugs = new Map(websiteTeams.map(([path, slug]) => [path, slug]));
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

const teams = websiteTeams.map(([path, slug, name, sortOrder]) => {
  const profile = teamProfiles[path];
  const competition = activeTeamPaths.has(path) ? splitKicker(profile.kicker).competition : profile.kicker;
  return {
    slug,
    name,
    competition,
    websitePath: path,
    fussballDeUrl: profile.fussballDeUrl ?? null,
    fussballDeTeamId: profile.fussballDeUrl?.match(/\/team-id\/([^/?#]+)/)?.[1] ?? null,
    fussballDeWidgetId: profile.fussballDeWidgetId ?? null,
    sortOrder,
    active: activeTeamPaths.has(path),
    contentEnabled: activeTeamPaths.has(path),
    publishingMode: 'manual',
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
console.log(`BSV-Katalog: ${catalog.teams.length} Website-Teams, ${catalog.people.length} Personen, ${catalog.memberships.length} Zuordnungen.`);
console.log(pathToFileURL(output.pathname).href);
