export const SUITE_BRAND_DEFAULT={background:'#071f16',panel:'#164f32',primary:'#91c82f',accent:'#f4d638',muted:'#a8cbb4',surface:'#f4f1e8',ink:'#10251a'};
export function suiteBrandColors(value){
 if(!value||Object.keys(SUITE_BRAND_DEFAULT).some(key=>!/^#[a-f\d]{6}$/i.test(value[key]||'')))throw new Error('Bitte alle sieben BSV-Standardfarben als gültige Hex-Farben angeben.');
 return Object.fromEntries(Object.keys(SUITE_BRAND_DEFAULT).map(key=>[key,value[key].toLowerCase()]));
}
export function suiteBrandVariables(colors){
 const c=suiteBrandColors(colors);
 const mix=(a,b,t)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
 const luminance=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const text=luminance(c.panel)>.179?'#10251a':'#ffffff';
 return {'--accent':c.panel,'--accent-hover':mix(c.panel,'#000000',.16),'--accent-text':c.panel,'--accent-contrast':text,'--accent-soft':mix(c.panel,'#ffffff',.91),'--accent-subtle':mix(c.panel,'#ffffff',.96),'--accent-border':mix(c.panel,'#ffffff',.76),'--paper':c.surface,'--ink':c.ink,'--mint':mix(c.ink,'#ffffff',.34),'--outline':mix(c.panel,'#ffffff',.82)};
}
