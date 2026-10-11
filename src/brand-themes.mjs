// Shared, scalable seasonal illustrations. Text and colors remain real UI content.
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
  const art = {
    football:`<circle cx="160" cy="165" r="108" fill="${surface}"/><g stroke="${panel}" stroke-width="5" stroke-linejoin="round"><path d="m157 106 43 32-16 49h-53l-16-49Z" fill="${panel}"/><path d="m157 106 2-49m41 81 47-15m-63 64 30 41m-83-41-30 42m14-91-46-16M125 63l34-6 35 8m53 58 19 33-1 40m-51 32-34 42-40-1m-39-40-31-29-16-43" fill="none"/></g><path d="m36 284 51-15m148 17 48-14" stroke="${accent}" stroke-width="8" stroke-linecap="round"/>`,
    christmas:`<path d="M147 239h26v52h-26Z" fill="${accent}"/><path d="M160 59 92 146h37L65 212h41l-57 54h222l-57-54h41l-64-66h37Z" fill="${primary}"/><path d="m160 30 9 18 20 3-15 14 4 20-18-10-18 10 4-20-15-14 20-3Z" fill="${accent}"/><path d="M112 168q48 31 96 0M88 228q72 37 144 0" fill="none" stroke="${surface}" stroke-width="7" stroke-linecap="round"/><g fill="${accent}"><circle cx="137" cy="132" r="8"/><circle cx="182" cy="206" r="9"/><circle cx="129" cy="244" r="8"/></g><g fill="${surface}"><path d="m55 85 4 10 11 4-11 4-4 11-4-11-11-4 11-4Z"/><path d="m262 142 4 10 11 4-11 4-4 11-4-11-11-4 11-4Z"/></g>`,
    easter:`<ellipse cx="156" cy="224" rx="66" ry="70" fill="${surface}"/><ellipse cx="126" cy="99" rx="24" ry="71" transform="rotate(-15 126 99)" fill="${surface}"/><ellipse cx="184" cy="91" rx="24" ry="72" transform="rotate(15 184 91)" fill="${surface}"/><path d="m119 54 13 82m63-82-19 82" stroke="${accent}" stroke-width="12" stroke-linecap="round"/><circle cx="155" cy="160" r="55" fill="${surface}"/><g fill="${panel}"><circle cx="135" cy="150" r="5"/><circle cx="176" cy="150" r="5"/><path d="m147 165 9 10 9-10Z"/></g><path d="M156 174v9m-12 0q12 14 24 0" fill="none" stroke="${panel}" stroke-width="3" stroke-linecap="round"/><ellipse cx="111" cy="281" rx="30" ry="12" fill="${surface}"/><ellipse cx="203" cy="281" rx="30" ry="12" fill="${surface}"/><ellipse cx="245" cy="264" rx="25" ry="34" transform="rotate(17 245 264)" fill="${accent}"/><path d="m222 264 43-5" stroke="${primary}" stroke-width="8"/><path d="m53 293 10-22m9 21 6-18" stroke="${primary}" stroke-width="5" stroke-linecap="round"/>`,
    summer:`<circle cx="259" cy="62" r="29" fill="${accent}"/><g stroke="${accent}" stroke-width="4" stroke-linecap="round"><path d="M259 19V9m0 106v-10m43-43h10m-92 0h-10m78-30 8-8m-60 76-8 8"/></g><ellipse cx="230" cy="207" rx="28" ry="103" transform="rotate(20 230 207)" fill="${accent}"/><path d="m230 133-27 129" stroke="${surface}" stroke-width="5"/><circle cx="132" cy="70" r="24" fill="${surface}"/><path d="M107 65q0-38 39-22l15 17-28-6Z" fill="${panel}"/><path d="m123 98-27 69 78 9-22-76Z" fill="${primary}"/><path d="m110 111-31 43-31 9m106-51 25 44 33 12" fill="none" stroke="${surface}" stroke-width="15" stroke-linecap="round"/><path d="m101 168-10 35 32 9 12-27 12 29 34-13-10-27Z" fill="${panel}"/><path d="m109 212-13 60m65-58 8 58" stroke="${surface}" stroke-width="14" stroke-linecap="round"/><path d="m93 280-18 2m94-2 18 2" stroke="${panel}" stroke-width="10" stroke-linecap="round"/><path d="M26 303q24-17 48 0t48 0 48 0 48 0 48 0" fill="none" stroke="${surface}" stroke-width="5" stroke-linecap="round"/>`,
  }[key];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320" role="img" aria-label="${BSV_THEMES.find(theme=>theme.key===key).label}">${art}</svg>`;
}
