import {BRAND_THEME_ASSETS} from './brand-theme-assets.mjs';
// Photographic cutouts shared by Suite previews, exports and editorial media.
export const BSV_THEMES = [
  {key:'football',label:'Fußball',description:'Unser Standard · das ganze Jahr'},
  {key:'christmas',label:'Weihnachten',description:'Weihnachtsbaum · Advent & Festtage'},
  {key:'easter',label:'Ostern',description:'Osterhase · Frühlingszeit'},
  {key:'summer',label:'Sommerferien',description:'Surferboy · Sommer am See'},
];
export function suiteBrandTheme(value = 'football') {
  if (!BSV_THEMES.some(theme => theme.key === value)) throw new Error('Bitte ein gültiges BSV-Theme auswählen.');
  return value;
}
export function brandThemeSvg(key = 'football', {primary='#91c82f',accent='#f4d638',surface='#f4f1e8',panel='#164f32'} = {}) {
  suiteBrandTheme(key);
  if (![primary,accent,surface,panel].every(color=>/^#[a-f\d]{6}$/i.test(color))) throw new Error('Ungültige Motivfarben.');
  const art=`<image href="${BRAND_THEME_ASSETS[key]}" x="0" y="0" width="320" height="320" preserveAspectRatio="xMidYMax meet"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320" role="img" aria-label="${BSV_THEMES.find(theme=>theme.key===key).label}">${art}</svg>`;
}
