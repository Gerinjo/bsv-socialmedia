import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {trainerContractDocument,trainerContractWaiverDocument} from '../src/trainer-contract-document.mjs';
import {renderTrainerContractPdf,annotateTrainerContractPdf} from '../src/trainer-contract-pdf.mjs';
import {receiptHash} from '../supabase/functions/_shared/referee-receipts.mjs';
const deps={PDFDocument,rgb,fontkit,regularBytes:await readFile(new URL('../brand/fonts/NotoSans-Regular.ttf',import.meta.url)),boldBytes:await readFile(new URL('../brand/fonts/NotoSans-Black.ttf',import.meta.url))};
const snapshot={templateVersion:'2026-11-03.1',name:'Muster Trainer',street:'Musterstraße 1',postcode:'78315',city:'Radolfzell',birthDate:'2010-01-01',guardianName:'Muster Sorgeberechtigte',season:'2026/2027',start:'2026-07-01',end:'2027-06-30',teamName:'D1-Junioren',role:'Trainer',license:'valid',share:100,grossMonthlyCents:10500,monthlyCents:10500,paidMonths:[7,9,10,11,1,2,3,4,5,6],bank:{holder:'Muster Trainer',iban:'DE89370400440532013000',name:'Testbank'}};
const options={number:'TV-TEST',templateVersion:snapshot.templateVersion},strokes=[[[.1,.5],[.2,.3],[.3,.6],[.4,.2],[.5,.5]]];
const signatures=['agreement','allowance','conduct','club'].map(part=>({part,strokes,signer_name:part==='club'?'Muster Vorstand':'Muster Trainer',place:'Radolfzell',signed_at:'2026-11-04T07:08:00Z',values:part==='allowance'?{2026:0,2027:12345}:{}}));
function contents(pdf,page){const refs=page.node.Contents()?.asArray()||[];return refs.map(ref=>Buffer.from(pdf.context.lookup(ref).getContents()).toString('base64'));}
test('existing base pages retain their original content streams and receive distinct signatures at their measured lines',async()=>{
 const pages=trainerContractDocument(snapshot).slice(0,6),layout={},base=await renderTrainerContractPdf(pages,deps,{...options,layout}),hash=await receiptHash(base);
 assert.deepEqual(layout.signatures.filter(a=>!a.extra).map(a=>[a.part,a.page,a.y]),[['club',3,286],['agreement',3,227],['guardian',3,168],['conduct',5,111]]);
 assert.equal(layout.signatures.find(a=>a.part==='allowance').page,2);
 const signed=await annotateTrainerContractPdf(base,pages,signatures,deps,options),old=await PDFDocument.load(base),now=await PDFDocument.load(signed);
 assert.equal(now.getPageCount(),old.getPageCount());assert.equal(await receiptHash(base),hash);
 for(let i=0;i<old.getPageCount();i++)for(const stream of contents(old,old.getPage(i)))assert.ok(contents(now,now.getPage(i)).includes(stream),'issued page content must survive annotation');
 // Unaffected first page is not overlaid, while §5, contract and conduct pages are.
 assert.equal(contents(now,now.getPage(0)).length,contents(old,old.getPage(0)).length);
 for(const i of [2,3,5])assert.ok(contents(now,now.getPage(i)).length>contents(old,old.getPage(i)).length);
 await writeFile('/tmp/bsv-trainer-contract-inline-demo.pdf',signed);
});
test('long bank details leave too little room for §5; its separate signature moves to a labelled supplement',async()=>{
 const value={...snapshot,bank:{...snapshot.bank,holder:'W'.repeat(60),name:'W'.repeat(90)}},pages=trainerContractDocument(value).slice(0,6),layout={},base=await renderTrainerContractPdf(pages,deps,{...options,layout});
 assert.equal(layout.signatures.find(a=>a.part==='allowance').page,null);
 const signed=await annotateTrainerContractPdf(base,pages,[signatures[1]],deps,options);
 assert.equal((await PDFDocument.load(signed)).getPageCount(),layout.pageCount+1);
});
test('unknown source layouts or mismatching original page counts cannot place signatures by guesswork',async()=>{
 const pages=trainerContractDocument(snapshot).slice(0,6),base=await renderTrainerContractPdf(pages,deps,options);
 await assert.rejects(()=>annotateTrainerContractPdf(base,pages,signatures,deps,{...options,templateVersion:'unknown'}),/eigene Zuordnung/);
 await assert.rejects(()=>annotateTrainerContractPdf(base,pages.slice(0,1),signatures,deps,options),/Vertragsseiten/);
});
test('older issued packets with three blank payout forms keep all nine original pages',async()=>{
 const pages=trainerContractDocument(snapshot),base=await renderTrainerContractPdf(pages,deps,options),signed=await annotateTrainerContractPdf(base,pages.slice(0,6),[signatures[0]],deps,{...options,legacyAppendix:pages.slice(6)}),old=await PDFDocument.load(base),now=await PDFDocument.load(signed);
 assert.equal(now.getPageCount(),9);for(let i=0;i<9;i++)for(const stream of contents(old,old.getPage(i)))assert.ok(contents(now,now.getPage(i)).includes(stream));
});
test('signed waiver forms show the actual exclusive choice and payout, and keep the matching signature line',()=>{
 const s={...signatures[0],part:'waiver_november',values:{choice:'partial',payoutCents:15000}},page=trainerContractWaiverDocument(snapshot,'november',s)[0];
 assert.deepEqual(page.blocks.filter(b=>b.kind==='check').map(b=>b.checked),[false,false,true]);
 assert.equal(page.blocks.find(b=>b.label?.startsWith('Bei teilweisem')).text,'150,00');assert.equal(page.blocks.find(b=>b.kind==='signature').part,'waiver_november');
 assert.throws(()=>trainerContractWaiverDocument(snapshot,'maerz',s),/anderen Zeitraum/);
});
