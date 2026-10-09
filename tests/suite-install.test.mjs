import assert from 'node:assert/strict';
import test from 'node:test';
import {createSuiteInstaller,suiteInstallInstructions} from '../admin-site/suite-install.mjs';

function fixture({standalone=false,navigator={userAgent:'Chrome'},secure=true}={}) {
  class Node extends EventTarget {
    hidden=false;disabled=false;textContent='';open=false;children=[];
    classList={toggle:()=>{}};
    showModal(){this.open=true;}close(){this.open=false;}replaceChildren(...children){this.children=children;}
  }
  const buttons=[new Node(),new Node()],entries=[new Node()],status=[new Node()];
  const nodes=Object.fromEntries(['#suiteInstallDialog','#suiteInstallIntro','#suiteInstallSteps','#closeSuiteInstall'].map(key=>[key,new Node()]));
  const doc={querySelectorAll:selector=>({'[data-suite-install]':buttons,'[data-suite-install-entry]':entries,'[data-suite-install-status]':status}[selector]),querySelector:selector=>nodes[selector],createElement:()=>new Node()};
  const mode=new EventTarget();mode.matches=standalone;
  const target=new EventTarget();Object.assign(target,{navigator,isSecureContext:secure,matchMedia:()=>mode});
  const installer=createSuiteInstaller({window:target,document:doc});
  return {buttons,entries,status,nodes,target,mode,installer};
}
function promptEvent(outcome='dismissed') {
  const event=new Event('beforeinstallprompt',{cancelable:true});let calls=0;
  event.prompt=async()=>{calls++;};event.userChoice=Promise.resolve({outcome});
  return {event,get calls(){return calls;}};
}

test('installation is only prompted on click; a consumed or dismissed event is never reused',async()=>{
  const f=fixture(),prompt=promptEvent();f.target.dispatchEvent(prompt.event);
  assert.equal(prompt.event.defaultPrevented,true);assert.equal(prompt.calls,0);
  await f.installer.install();assert.equal(prompt.calls,1);assert.match(f.status[0].textContent,/abgebrochen/);
  await f.installer.install();assert.equal(prompt.calls,1);assert.equal(f.nodes['#suiteInstallDialog'].open,true);
  const next=promptEvent('accepted');f.target.dispatchEvent(next.event);await f.installer.install();assert.equal(next.calls,1);assert.equal(f.nodes['#suiteInstallDialog'].open,false);assert.match(f.status[0].textContent,/bestätigt/);
});
test('parallel clicks cannot launch more than one native installation prompt',async()=>{
  const f=fixture();let resolveChoice;const prompt=promptEvent();prompt.event.userChoice=new Promise(resolve=>{resolveChoice=resolve;});
  f.target.dispatchEvent(prompt.event);const first=f.installer.install();assert.equal(f.buttons.every(button=>button.disabled),true);
  await f.installer.install();assert.equal(prompt.calls,1);resolveChoice({outcome:'dismissed'});await first;assert.equal(f.buttons.some(button=>button.disabled),false);
});
test('standalone, Safari standalone and appinstalled hide all installation entries',async()=>{
  for(const options of [{standalone:true},{navigator:{userAgent:'iPhone',standalone:true}}]){
    const f=fixture(options);assert.equal([...f.buttons,...f.entries].every(node=>node.hidden),true);await f.installer.install();assert.equal(f.nodes['#suiteInstallDialog'].open,false);
  }
  const f=fixture();await f.installer.install();f.target.dispatchEvent(new Event('appinstalled'));
  assert.equal([...f.buttons,...f.entries].every(node=>node.hidden),true);assert.equal(f.nodes['#suiteInstallDialog'].open,false);
  const changed=fixture();changed.mode.matches=true;changed.mode.dispatchEvent(new Event('change'));assert.equal(changed.buttons[0].hidden,true);
});
test('iPhone and desktop-mode iPad receive Apple steps; Android and insecure origins get matching instructions',()=>{
  for(const navigator of [{userAgent:'iPhone'},{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5}])assert.match(suiteInstallInstructions(navigator,true).steps.join(' '),/Safari.*Teilen.*Home-Bildschirm/);
  assert.match(suiteInstallInstructions({userAgent:'Android'},true).steps.join(' '),/Browsermenü.*Startbildschirm/);
  assert.match(suiteInstallInstructions({userAgent:'Chrome'},false).intro,/HTTPS/);
});
test('a browser prompt error falls back to instructions without leaving buttons disabled',async()=>{
  const f=fixture(),prompt=promptEvent();prompt.event.prompt=async()=>{throw new Error('Unavailable');};f.target.dispatchEvent(prompt.event);await f.installer.install();
  assert.equal(f.nodes['#suiteInstallDialog'].open,true);assert.match(f.status[0].textContent,/Browsermenü/);assert.equal(f.buttons.some(button=>button.disabled),false);
});
