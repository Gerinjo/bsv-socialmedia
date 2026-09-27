import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { parseEuroCents, detectReceiptAmount, parseTrainerBankDetails, normalizeIban, validateExpenseSubmission } from '../src/referee-expenses.mjs';
import { parseRefereeAppointment } from '../src/referee-source.mjs';
import { decodeRefereeReceipt, receiptHash, encryptTrainerBankDetails } from '../supabase/functions/_shared/referee-receipts.mjs';
import { coachExpenses } from '../supabase/functions/referee-coach-api/expenses.mjs';
import { handleRefereeCoach } from '../supabase/functions/referee-coach-api/handler.mjs';

test('euro amounts use integer cents and reject ambiguous, negative and excessive input', () => {
  for (const value of ['37,40','37.40','37,40 EUR','37,40 €']) assert.equal(parseEuroCents(value),3740);
  assert.equal(parseEuroCents('1.000'),100000);
  assert.equal(parseEuroCents('1.000,00'),100000);
  assert.equal(parseEuroCents('0,01'),1);
  for (const value of ['1,234','1.23,45','-5','0','1000,01','1e2','3+4','',null]) assert.equal(parseEuroCents(value),null,value);
});

test('receipt recognition prioritizes total and asks for correction on ambiguous components', () => {
  assert.deepEqual(detectReceiptAmount('Entschädigung 30,00 EUR\nFahrtkosten 7,40 EUR\nGesamtbetrag 37,40 EUR'),{cents:3740,confidence:'total'});
  assert.equal(detectReceiptAmount('37,40 EUR').cents,3740);
  for (const text of ['Fahrtkosten 7,40 EUR','0,30 EUR pro km','Summe 10,00 EUR\nGesamt 20,00 EUR','30,00 EUR\n7,40 EUR','kein Betrag']) assert.equal(detectReceiptAmount(text).cents,null,text);
});

test('bank import validates labelled fields and IBAN checksum', () => {
  const details = parseTrainerBankDetails('Kontoinhaber: Alex Beispiel\nIBAN: DE89 3704 0044 0532 0130 00\nBIC: COBADEFFXXX');
  assert.deepEqual(details,{accountHolder:'Alex Beispiel',iban:'DE89370400440532013000',bic:'COBADEFFXXX'});
  assert.throws(()=>normalizeIban('DE00370400440532013000'));
  assert.throws(()=>parseTrainerBankDetails('IBAN: DE89370400440532013000'));
});

test('encrypted destination uses random IVs and is bound to the trainer identity', async () => {
  const details = {iban:'DE89370400440532013000',accountHolder:'Alex Beispiel',bic:''};
  const raw = new Uint8Array(32).fill(5), secret = Buffer.from(raw).toString('base64');
  const encrypted = await encryptTrainerBankDetails(details,'coach-1',secret);
  assert.notEqual(encrypted,await encryptTrainerBankDetails(details,'coach-1',secret));
  assert.ok(!encrypted.includes(details.iban) && !encrypted.includes(details.accountHolder));
  const [,iv,cipher] = encrypted.split('.');
  const key = await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
  const decrypt = person => crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64'),additionalData:new TextEncoder().encode(person)},key,Buffer.from(cipher,'base64'));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(await decrypt('coach-1'))),details);
  await assert.rejects(decrypt('coach-2'));
  await assert.rejects(encryptTrainerBankDetails(details,'coach-1',''));
});

test('receipt input verifies MIME signatures and hashes identical content consistently', async () => {
  const bytes = new Uint8Array([137,80,78,71,13,10,26,10]);
  const data = 'data:image/png;base64,'+Buffer.from(bytes).toString('base64');
  assert.equal(decodeRefereeReceipt(data).mime,'image/png');
  assert.equal(await receiptHash(bytes),await receiptHash(decodeRefereeReceipt(data).bytes));
  assert.throws(()=>decodeRefereeReceipt(data.replace('image/png','application/pdf')));
  assert.throws(()=>decodeRefereeReceipt('data:image/svg+xml;base64,PHN2Zz4='));
});

test('submission retains recognized and corrected cents and requires confirmation', () => {
  assert.deepEqual(validateExpenseSubmission({amountCents:3820,ocrAmountCents:3740,confirmed:true,paid:true}),{amountCents:3820,ocrAmountCents:3740,confirmed:true});
  for (const body of [{amountCents:37.4,confirmed:true},{amountCents:3740,confirmed:false},{amountCents:3740,confirmed:true,ocrAmountCents:-1}]) assert.throws(()=>validateExpenseSubmission(body));
});

test('appointment detection needs a labelled match row and treats privacy as unknown', () => {
  const page = row => '<div class="stage-header"></div><div class="team-name"></div><div class="team-name"></div><ul class="stage-meta-left">'+row+'</ul>';
  const row = text => '<li><span>Schiedsrichter:</span><span>'+text+'</span></li>';
  assert.equal(parseRefereeAppointment(page(row('<a href="/schiedsrichterprofil/example">Name</a>')),load),'assigned');
  assert.equal(parseRefereeAppointment(page(row('nicht angesetzt')),load),'missing');
  assert.equal(parseRefereeAppointment(page(row('aus Datenschutz nicht veröffentlicht')),load),'unknown');
  assert.equal(parseRefereeAppointment(page('<li>Schiedsrichter finden</li>'),load),'unknown');
  assert.equal(parseRefereeAppointment(page(row('Robin')+row('Name')),load),'unknown');
  assert.equal(parseRefereeAppointment('<p>Schiedsrichter: Robin</p>',load),'unknown');
});

const body = {action:'expense_submit',personId:'c0000000-0000-4000-8000-000000000001',teamId:'b0000000-0000-4000-8000-000000000001',caseId:'d0000000-0000-4000-8000-000000000001',birthDate:'1980-01-01',amountCents:3740,confirmed:true,receiptData:'data:image/png;base64,iVBORw0KGgo='};
function database({prepared={data:{ok:true,receiptExists:false}},uploaded={},committed={data:{cases:[]}}}={}) {
  const calls=[];
  return {calls,rpc:async(name,{payload})=>{calls.push(payload);return payload.action==='expense_prepare'?prepared:committed;},storage:{from:()=>({upload:async(path,bytes,options)=>{calls.push({upload:path,options});return uploaded;},remove:()=>{throw new Error('Must not delete a concurrent receipt');}})}};
}
test('receipt storage requires verified coach, eligible game and duplicate check first', async () => {
  const db=database({prepared:{data:{error:'Fremde Mannschaft',status:403}}});
  assert.equal((await coachExpenses(db,body)).data.status,403);
  assert.equal(db.calls.length,1);
});
test('upload retries can reuse only identical hash-addressed files; no premature deletion', async () => {
  const db=database({uploaded:{error:{statusCode:'409'}},committed:{data:{error:'already submitted',status:409}}});
  assert.equal((await coachExpenses(db,body)).data.status,409);
  assert.match(db.calls[1].upload,/^[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9]{64}\.png$/);
  assert.equal(db.calls[1].options.upsert,false);
  assert.equal(db.calls[2].action,'expense_submit');
  const failed=database({uploaded:{error:{statusCode:'503'}}});
  await coachExpenses(failed,body);
  assert.equal(failed.calls.length,2);
});
test('public expense API drops forged payout and bank fields and hides transport errors', async () => {
  const db=database();
  const request = payload => new Request('https://example.invalid',{method:'POST',body:JSON.stringify(payload)});
  assert.equal((await handleRefereeCoach(request({...body,paid:true,status:'paid',iban:'SECRET',actor:'forged'}),db)).status,200);
  assert.ok(!JSON.stringify(db.calls).includes('SECRET') && !JSON.stringify(db.calls).includes('forged') && !JSON.stringify(db.calls).includes('"paid"'));
  const result=await handleRefereeCoach(request(body),{rpc:()=>{throw new Error('secret database details');}});
  assert.equal(result.status,503);
  assert.ok(!(await result.text()).includes('secret'));
});
