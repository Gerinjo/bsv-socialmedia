import {BRAND_THEME_ASSETS} from './brand-theme-assets.mjs';
// Photographic cutouts shared by Suite previews, exports and editorial media.
export const BSV_THEMES = [
  {key:'football',label:'Fußball',description:'Unser Standard · das ganze Jahr'},
  {key:'christmas',label:'Weihnachten',description:'Weihnachtsbaum mit Krippe & Geschenken'},
  {key:'easter',label:'Ostern',description:'Osterhase mit Ostereiern & Glocken'},
  {key:'summer',label:'Sommerferien',description:'Surferboy · Sommer am See'},
  {key:'girls_day',label:'Girls’ Day',description:'Jubelnde Mädchen · gemeinsam im Team'},
];
export function suiteBrandTheme(value = 'football') {
  if (!BSV_THEMES.some(theme => theme.key === value)) throw new Error('Bitte ein gültiges BSV-Theme auswählen.');
  return value;
}
export function brandThemeSvg(key = 'football', {primary='#91c82f',accent='#f4d638',surface='#f4f1e8',panel='#164f32'} = {}) {
  suiteBrandTheme(key);
  if (![primary,accent,surface,panel].every(color=>/^#[a-f\d]{6}$/i.test(color))) throw new Error('Ungültige Motivfarben.');
  const art=`<image href="${BRAND_THEME_ASSETS[key]}" x="0" y="0" width="320" height="${key==='girls_day'?282:320}" preserveAspectRatio="xMidYMax meet"/>`;
  const caption=key==='girls_day'?`<g font-family="Arial,Helvetica,sans-serif"><rect x="69" y="280" width="182" height="28" rx="3" fill="${surface}"/><text x="160" y="301" text-anchor="middle" fill="${panel}" font-size="24" font-family="Georgia,serif" font-style="italic" font-weight="700">Girls’ Day</text><rect x="87" y="310" width="146" height="10" rx="2" fill="${panel}"/><text x="160" y="318" text-anchor="middle" fill="${surface}" font-size="9">KI-generierte Illustration</text></g>`:'';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320" role="img" aria-label="${BSV_THEMES.find(theme=>theme.key===key).label}">${art}${caption}</svg>`;
}
