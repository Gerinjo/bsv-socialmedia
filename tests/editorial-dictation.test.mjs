import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorialDictation} from '../admin-site/editorial-dictation.mjs';
function setup({supported=true,text='',cursor=text.length,maxLength=30000}={}) {
 const recognitions=[],activity=[],changes=[];
 class Recognition {
  constructor(){recognitions.push(this);}
  start(){this.onstart?.();}
  stop(){this.stopped=true;}
  abort(){this.aborted=true;this.onend?.();}
 }
 const label={textContent:''},button={querySelector:()=>label,setAttribute(name,value){this[name]=value;}};
 const textarea={value:text,selectionStart:cursor,maxLength,setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);}};
 const status={textContent:''},hint={textContent:''};
 const control=createEditorialDictation({button,status,hint,textarea,onChange:()=>changes.push(textarea.value),onActiveChange:value=>activity.push(value),canStart:()=>true,scope:{isSecureContext:true,SpeechRecognition:supported?Recognition:undefined}});
 const result=(recognition,entries,index=0)=>recognition.onresult({resultIndex:index,results:entries.map(([text,final])=>Object.assign([{transcript:text}],{isFinal:final}))});
 return {recognitions,activity,changes,button,label,textarea,status,hint,control,result};
}
test('dictation is opt-in, German, and inserts final results once without replacing selected text',()=>{
 const h=setup({text:'Hallo Welt',cursor:6});assert.equal(h.recognitions.length,0);
 h.button.onclick();const r=h.recognitions[0];assert.equal(r.lang,'de-DE');assert.equal(h.control.active,true);
 h.result(r,[['liebe',false]]);assert.equal(h.textarea.value,'Hallo Welt');assert.equal(h.changes.length,0);
 h.result(r,[['liebe Fans',true]]);h.result(r,[['liebe Fans',true],['willkommen',false]]);
 assert.equal(h.textarea.value,'Hallo liebe Fans Welt');assert.equal(h.changes.length,1);
 h.result(r,[['liebe Fans',true],['willkommen',true]],1);assert.equal(h.textarea.value,'Hallo liebe Fans willkommen Welt');
 h.control.stop();assert.equal(r.stopped,true);assert.equal(h.control.active,true);
 h.result(r,[['liebe Fans',true],['willkommen',true],['!',true]],2);r.onend();
 assert.equal(h.textarea.value,'Hallo liebe Fans willkommen! Welt');assert.equal(h.control.active,false);assert.deepEqual(h.activity,[true,false]);
});
test('permission failures and late results cannot alter a stopped or different article',()=>{
 const h=setup({text:'Original'});h.button.onclick();const old=h.recognitions[0];
 old.onerror({error:'not-allowed'});assert.match(h.status.textContent,/Browserberechtigung/);assert.equal(h.control.active,false);
 h.result(old,[['late',true]]);assert.equal(h.textarea.value,'Original');
 h.button.onclick();const active=h.recognitions[1];h.result(old,[['another stale result',true]]);assert.equal(h.textarea.value,'Original');
 h.control.reset();h.result(active,[['wrong article',true]]);assert.equal(h.textarea.value,'Original');assert.equal(h.control.active,false);
});
test('unsupported browsers and disabled editors cannot start recognition; length limits preserve the saved text',()=>{
 const unavailable=setup({supported:false});assert.equal(unavailable.button.disabled,true);unavailable.button.onclick();assert.equal(unavailable.recognitions.length,0);
 const h=setup({text:'Original',maxLength:10});h.control.setEnabled(false);h.button.onclick();assert.equal(h.recognitions.length,0);
 h.control.setEnabled(true);h.button.onclick();const r=h.recognitions[0];h.result(r,[['too long',true]]);r.onend();
 assert.equal(h.textarea.value,'Original');assert.match(h.status.textContent,/Textlänge/);assert.equal(h.changes.length,0);
});
