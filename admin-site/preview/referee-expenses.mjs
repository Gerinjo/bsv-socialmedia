import { validateExpenseSubmission } from '/referee-expense-model.mjs';
const storageKey='bsv-referee-expenses-preview-v1';
const personId='20000000-0000-0000-0000-000000000001';
const receiptId='demo-receipt';
function seed(){
  return {cases:[
    {id:'50000000-0000-0000-0000-000000000001',home_team:'BSV Nordstern · D1-Junioren',away_team:'SV Beispielstadt',days:-1,game_status:'finished',claim:null},
    {id:'50000000-0000-0000-0000-000000000002',home_team:'BSV Nordstern · D1-Junioren',away_team:'FC Seeblick',days:-7,game_status:'finished',claim:{id:'60000000-0000-0000-0000-000000000002',amount_cents:3740,ocr_amount_cents:3740,status:'submitted',version:1,receipt_id:receiptId}},
    {id:'50000000-0000-0000-0000-000000000003',home_team:'BSV Nordstern · D1-Junioren',away_team:'SV Sonnenberg',days:3,game_status:'scheduled',claim:null},
  ].map(row=>({...row,appointment_state:'assigned',checked_at:new Date().toISOString(),kickoff_at:new Date(Date.now()+row.days*86400000).toISOString(),source_url:'',claim:row.claim?{...row.claim,person_name:'Alex Beispiel',person_id:personId,bankLast4:'3000',review_note:''}:null})),receipts:{[receiptId]:{url:'/preview-referee-receipt.png',mime:'image/png'}}};
}
function load(){try{return JSON.parse(localStorage.getItem(storageKey))||seed();}catch{return seed();}}
export async function refereeExpensePreviewApi(body){
 const data=load();const row=data.cases.find(row=>row.id===body.caseId||row.claim?.id===body.id);
 if(body.action==='expense_submit'){
   const input=validateExpenseSubmission(body);
   if(!row||row.game_status!=='finished'||row.claim&&row.claim.status!=='rejected')throw new Error('Dieses Spiel kann nicht erneut eingereicht werden.');
   if(row.claim&&row.claim.version!==body.version)throw new Error('Die Erstattung wurde geändert.');
   if(!/^data:(image\/(jpeg|png|webp)|application\/pdf);base64,/.test(body.receiptData||''))throw new Error('Bitte Quittung auswählen.');
   const duplicate=Object.entries(data.receipts).find(([,value])=>value.url===body.receiptData);
   if(duplicate&&row.claim?.receipt_id!==duplicate[0])throw new Error('Diese Quittung wurde bereits verwendet.');
   const id=duplicate?.[0]||crypto.randomUUID();data.receipts[id]={url:body.receiptData,mime:body.receiptData.slice(5,body.receiptData.indexOf(';'))};
   row.claim={id:row.claim?.id||crypto.randomUUID(),receipt_id:id,amount_cents:input.amountCents,ocr_amount_cents:input.ocrAmountCents,status:'submitted',version:(row.claim?.version||0)+1,person_name:'Alex Beispiel',person_id:personId,bankLast4:'3000',review_note:''};
 }
 if(['referee_approve_expense','referee_reject_expense'].includes(body.action)){
   if(!row?.claim||row.claim.status!=='submitted'||row.claim.version!==body.version)throw new Error('Die Erstattung wurde bereits bearbeitet.');
   if(body.action==='referee_approve_expense'){row.claim.status='approved';row.claim.payment_id=crypto.randomUUID();row.claim.payment_status='ready';}
   else {if(!body.note?.trim())throw new Error('Bitte Hinweis angeben.');row.claim.status='rejected';row.claim.review_note=body.note.trim();}
   row.claim.version++;
 }
 if(body.action==='referee_import_account')throw new Error('In der Demo werden keine echten Kontodaten übernommen. Der Beispielzugang verwendet ein Musterkonto.');
 if(body.action==='referee_sync_fees'){for(const row of data.cases)row.checked_at=new Date().toISOString();localStorage.setItem(storageKey,JSON.stringify(data));return {checked:data.cases.length,assigned:data.cases.length,issues:[]};}
 if(body.action==='referee_receipt_url'){const receipt=data.receipts[body.receiptId];if(!receipt)throw new Error('Quittung nicht gefunden.');return receipt;}
 localStorage.setItem(storageKey,JSON.stringify(data));
 return {cases:data.cases,bankLast4:'3000',paymentServiceConfigured:false,coaches:[{id:personId,name:'Alex Beispiel'}]};
}
