export const SUITE_BRAND_DEFAULT={background:'#071f16',panel:'#164f32',primary:'#91c82f',accent:'#f4d638',muted:'#a8cbb4',surface:'#f4f1e8',ink:'#10251a'};
export const SUITE_BRAND_PALETTES=[
 {key:'bsv',label:'BSV-Standard',description:'Grün und Gelb · unsere Vereinsfarben',colors:{...SUITE_BRAND_DEFAULT}},
 {key:'girls_day',label:'Girls’ Day',description:'Violett, Türkis und Sonnengelb · Mut und Zukunft',colors:{background:'#241234',panel:'#62328c',primary:'#75d6d0',accent:'#ffc85a',muted:'#e5c8f3',surface:'#fcf6ff',ink:'#251536'}},
 {key:'pride',label:'CSD · Regenbogen',description:'Für Vielfalt und Zusammenhalt · mit Regenbogenleiste',colors:{background:'#171a36',panel:'#293777',primary:'#28b678',accent:'#ffd447',muted:'#c6d5ff',surface:'#fff8f1',ink:'#17213a'}},
 {key:'summer_festival',label:'Sommerfest',description:'Petrol, Mint und Apricot · sonnig und gesellig',colors:{background:'#07313b',panel:'#0b6673',primary:'#9adbbb',accent:'#ffcc75',muted:'#c4e6e7',surface:'#fff8ed',ink:'#102d36'}},
 {key:'anniversary',label:'Vereinsjubiläum',description:'Tannengrün und Gold · festlich und vertraut',colors:{background:'#11271e',panel:'#204b3a',primary:'#c8dda8',accent:'#e8bf63',muted:'#d6dbc7',surface:'#fcf8ef',ink:'#172b22'}},
 {key:'floodlight',label:'Flutlichtcup',description:'Nachtblau, Eisblau und Orange · Energie am Abend',colors:{background:'#101d36',panel:'#243e6b',primary:'#89d4ee',accent:'#f2a65a',muted:'#cadcf7',surface:'#f4f7fc',ink:'#14233a'}},
];
export const SUITE_PRIDE_RIBBON=['#e40303','#ff8c00','#ffed00','#008026','#004dff','#750787'];
export function suiteBrandPalette(value){
 const colors=suiteBrandColors(value);
 return SUITE_BRAND_PALETTES.find(palette=>Object.keys(SUITE_BRAND_DEFAULT).every(key=>palette.colors[key]===colors[key]))||null;
}
export function suiteBrandRibbon(colors){return suiteBrandPalette(colors)?.key==='pride'?[...SUITE_PRIDE_RIBBON]:[];}
export function suiteBrandColors(value){
 if(!value||Object.keys(SUITE_BRAND_DEFAULT).some(key=>!/^#[a-f\d]{6}$/i.test(value[key]||'')))throw new Error('Bitte alle sieben BSV-Standardfarben als gültige Hex-Farben angeben.');
 return Object.fromEntries(Object.keys(SUITE_BRAND_DEFAULT).map(key=>[key,value[key].toLowerCase()]));
}
export function suiteBrandVariables(colors){
 const c=suiteBrandColors(colors);
 const mix=(a,b,t)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
 const luminance=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const text=luminance(c.panel)>.179?'#10251a':'#ffffff';
 const ribbon=suiteBrandRibbon(c);
 return {'--brand-ribbon':ribbon.length?`linear-gradient(90deg,${ribbon.map((color,i)=>`${color} ${i*100/6}% ${(i+1)*100/6}%`).join(',')})`:'none','--brand-ribbon-height':ribbon.length?'6px':'0px','--accent':c.panel,'--accent-hover':mix(c.panel,'#000000',.16),'--accent-text':c.panel,'--accent-contrast':text,'--accent-soft':mix(c.panel,'#ffffff',.91),'--accent-subtle':mix(c.panel,'#ffffff',.96),'--accent-border':mix(c.panel,'#ffffff',.76),'--paper':c.surface,'--ink':c.ink,'--mint':mix(c.ink,'#ffffff',.34),'--outline':mix(c.panel,'#ffffff',.82)};
}
