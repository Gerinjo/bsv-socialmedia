// Shared with bsv-website/src/utils/seasonal-snow.mjs.
export function createSeasonalSnow(target){
 if(!target)return {setTheme(){},destroy(){}};
 const doc=target.ownerDocument,win=doc.defaultView,motion=win.matchMedia('(prefers-reduced-motion: reduce)');let theme='football';
 target.classList.add('bsv-seasonal-snow');target.setAttribute('aria-hidden','true');
 const resize=()=>target.style.setProperty('--snow-distance',(target.clientHeight+40)+'px');
 const update=()=>{
  const active=theme==='christmas'&&!motion.matches&&!doc.hidden;target.hidden=!active;
  if(!active){target.replaceChildren();return;}
  if(!target.childElementCount){const flakes=doc.createDocumentFragment();for(let i=0;i<28;i++){const flake=doc.createElement('span'),size=2+(i%4);flake.className='bsv-snowflake';flake.style.cssText=`left:${(i*37.7)%100}%;width:${size}px;height:${size}px;--snow-opacity:${.3+(i%5)*.1};--snow-drift:${(i%2?1:-1)*(18+i%7*9)}px;animation-duration:${9+i%8*1.6}s;animation-delay:-${i*.91}s`;flakes.append(flake);}target.append(flakes);}
  resize();
 };
 const observer=win.ResizeObserver?new win.ResizeObserver(resize):null;observer?.observe(target);
 motion.addEventListener('change',update);doc.addEventListener('visibilitychange',update);target.hidden=true;
 return {setTheme(value){theme=value;update();},destroy(){motion.removeEventListener('change',update);doc.removeEventListener('visibilitychange',update);observer?.disconnect();target.replaceChildren();target.hidden=true;}};
}
