import test from 'node:test';import assert from 'node:assert/strict';
import {handleContractPortal} from '../supabase/functions/_shared/trainer-contract-portal.mjs';
import {receiptHash} from '../supabase/functions/_shared/referee-receipts.mjs';
test('cancelled archives download stored originals and reconstruct missing proof without writing',async()=>{const base=new TextEncoder().encode('%PDF-source'),proof=new TextEncoder().encode('%PDF-proof'),hash=await receiptHash(base),calls=[];let uploads=0;const c={id:'10000000-0000-4000-8000-000000000001',status:'cancelled',reference:'TV-TEST',season:'2026/2027',snapshot:{name:'Example Coach',teamName:'C1',season:'2026/2027',start:'2026-07-01',end:'2027-06-30',paidMonths:[7,9,10,11,1,2,3,4,5,6],monthlyCents:10000},signatures:[{part:'agreement',place:'Radolfzell',signed_at:'2026-11-03T10:00:00Z',values:{},strokes:[[[.1,.2],[.2,.3],[.3,.4],[.4,.3],[.5,.2]]]}]},db={rpc:async(_name,{payload})=>{calls.push(payload);return {data:payload.action==='get'?c:payload.action==='file'?payload.kind==='base'?{path:'base.pdf',hash}:{path:null}:{error:'Must not write',status:409}};},storage:{from:()=>({download:async()=>({data:new Blob([base])}),upload:async()=>{uploads++;return {};}})}};const result=await handleContractPortal(db,'actor',{action:'my_contract_download',id:c.id,kind:'all'},{pdf:async()=>proof,merge:async files=>new Uint8Array(files.flatMap(f=>[...f]))});assert.equal(uploads,0);assert.ok(calls.every(p=>['get','file'].includes(p.action)));assert.equal(atob(result.base64),'%PDF-source%PDF-proof');});

const fixtureSnapshot={templateVersion:'2026-11-03.1',name:'Example Coach',teamName:'C1',season:'2026/2027',start:'2026-07-01',end:'2027-06-30',paidMonths:[7,9,10,11,1,2,3,4,5,6],monthlyCents:10000,grossMonthlyCents:10000,share:100,role:'Trainer',license:'none',bank:{holder:'Example',iban:'',name:''}};
async function downloadsFixture({signedPath=null,part='contract',guardian=false}={}){
 const source=new TextEncoder().encode('%PDF-original'),oldSigned=new TextEncoder().encode('%PDF-old-signed'),proof=new TextEncoder().encode('%PDF-proof'),inline=new TextEncoder().encode('%PDF-inline'),calls=[],overlays=[],uploads=[];
 const c={id:'10000000-0000-4000-8000-000000000001',status:signedPath?'signed':'issued',reference:'TV-TEST',season:'2026/2027',snapshot:fixtureSnapshot,guardianConfirmed:guardian,signatures:[{part:'agreement',place:'Radolfzell',signed_at:'2026-11-04T07:08:00Z',values:{},strokes:[[[.1,.2],[.2,.3],[.3,.4],[.4,.3],[.5,.2]]]}]};
 const files={base:{path:'base.pdf',bytes:source},agreement:{path:'proof.pdf',bytes:proof},signed:signedPath?{path:signedPath,bytes:oldSigned}:null};
 const db={rpc:async(_name,{payload})=>{calls.push(payload);if(payload.action==='get')return {data:c};if(payload.action!=='file')throw Error('Unexpected mutation');const f=files[payload.kind];return {data:f?{path:f.path,hash:await receiptHash(f.bytes)}:{path:null}};},storage:{from:()=>({download:async path=>({data:new Blob([Object.values(files).find(f=>f?.path===path).bytes])}),upload:async()=>{uploads.push(1);throw Error('Unexpected upload');}})}};
 const result=await handleContractPortal(db,'actor',{action:'my_contract_download',id:c.id,kind:part},{pdf:async()=>proof,merge:async files=>new Uint8Array(files.flatMap(f=>[...f])),annotate:async(base,pages,signatures,options)=>{overlays.push({base,pages,signatures,options});return inline;}});
 return {value:atob(result.base64),calls,overlays,uploads};
}
test('previously signed digital downloads rebuild their view from the verified original without changing any stored signature',async()=>{
 for(const part of ['contract','all','agreement']){const r=await downloadsFixture({signedPath:'contract/signed/digital-4-existing.pdf',part});assert.equal(r.value,'%PDF-inline%PDF-proof');assert.equal(r.overlays.length,1);assert.equal(new TextDecoder().decode(r.overlays[0].base),'%PDF-original');assert.deepEqual(r.overlays[0].signatures.map(s=>s.part),['agreement']);assert.equal(r.uploads.length,0);assert.ok(r.calls.every(p=>['get','file'].includes(p.action)));}
});
test('an actual signed paper upload is preserved even when digital signature events also exist',async()=>{
 const r=await downloadsFixture({signedPath:'contract/signed/paper-upload.pdf'});assert.equal(r.value,'%PDF-old-signed');assert.equal(r.overlays.length,0);assert.ok(!r.calls.some(p=>p.kind==='base'));
});
test('a partially signed contract is annotated now, and its archived original remains separately downloadable',async()=>{
 const signed=await downloadsFixture();assert.equal(signed.value,'%PDF-inline%PDF-proof');
 const original=await downloadsFixture({part:'original'});assert.equal(original.value,'%PDF-original');assert.equal(original.overlays.length,0);
});
test('guardian template generation remains behind the same ownership check as the contract',async()=>{
 let generated=false;const db={rpc:async()=>({data:{error:'Kein Zugriff auf diesen Vertrag.',status:403}})};
 await assert.rejects(()=>handleContractPortal(db,'other-account',{action:'my_contract_download',id:'10000000-0000-4000-8000-000000000001',kind:'guardian_template'},{pdf:async()=>{generated=true;}}),/Kein Zugriff/);assert.equal(generated,false);
});
