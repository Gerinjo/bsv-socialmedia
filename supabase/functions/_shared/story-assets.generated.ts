// Runtime fallback for direct Supabase deployments.
// Normal CLI deployments may overwrite this file with the generated static bundle.

async function fetchText(relativePath: string): Promise<string> {
  const url = new URL(relativePath, import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Edge-Asset ${relativePath} konnte nicht geladen werden: HTTP ${response.status}`);
  return await response.text();
}

async function fetchBase64(relativePath: string): Promise<string> {
  const url = new URL(relativePath, import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Edge-Asset ${relativePath} konnte nicht geladen werden: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

const templatePaths = {
  announcement: '../../../templates/announcement.svg',
  lineup: '../../../templates/lineup.svg',
  result: '../../../templates/result.svg',
  report: '../../../templates/report.svg',
  reportScorers: '../../../templates/report-scorers.svg',
  reportPhoto: '../../../templates/report-photo.svg',
  post: '../../../templates/post.svg',
  postPhoto: '../../../templates/post-photo.svg',
  story: '../../../templates/story.svg',
  birthday: '../../../templates/birthday.svg',
} as const;

const assetPaths = {
  captureFont: ['../../../brand/fonts/Capture it.ttf', 'font/ttf'],
  notoSansRegular: ['../../../brand/fonts/NotoSans-Regular.ttf', 'font/ttf'],
  notoSansBlack: ['../../../brand/fonts/NotoSans-Black.ttf', 'font/ttf'],
  notoSerifItalic: ['../../../brand/fonts/NotoSerif-Italic.ttf', 'font/ttf'],
  tsvAachLinzCrest: ['../../../brand/logos/opponents/tsv-aach-linz.png', 'image/png'],
} as const;

export const STORY_TEMPLATES = Object.fromEntries(await Promise.all(
  Object.entries(templatePaths).map(async ([name, path]) => [name, await fetchText(path)]),
)) as Record<keyof typeof templatePaths, string>;

export const STORY_ASSETS = Object.fromEntries(await Promise.all(
  Object.entries(assetPaths).map(async ([name, [path, mime]]) => [name, { base64: await fetchBase64(path), mime }]),
)) as Record<keyof typeof assetPaths, { base64: string; mime: string }>;
