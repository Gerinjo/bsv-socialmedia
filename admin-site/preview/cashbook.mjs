// Deliberately synthetic data, isolated from the real safe and mail delivery.
import {validateCashbookChange,validateCashbookBooking,validateCashbookSettlement} from '/cashbook-model.mjs';
import {enrichSuiteMembers} from '/suite-members.mjs';
const KEY='bsv-cashbook-preview-v5';
const team={id:'10000000-0000-4000-8000-000000000001',name:'U15 C1-Junioren (Beispiel)'};
const dTeam={id:'10000000-0000-4000-8000-000000000002',name:'U13 D1-Junioren (Beispiel)'};
const teams=[team,dTeam];
const people=[{id:'20000000-0000-4000-8000-000000000001',name:'Max Mustermann',username:'mustm',role:'trainer'},{id:'20000000-0000-4000-8000-000000000002',name:'Wiebke Beispiel',username:'kassw',role:'cashier'},{id:'20000000-0000-4000-8000-000000000003',name:'Jugendleitung Beispiel',username:'beisj',role:'trainer',isYouthLeader:true}];
const allowedTeams=person=>person.isYouthLeader?teams:person.role==='trainer'?[team]:[];
let state;
try{state=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
state ||= {entries:[{id:crypto.randomUUID(),sequence:1,direction:'deposit',amountCents:20000,balanceAfterCents:20000,personName:'Wiebke Beispiel',teamName:'Vereinskasse / Jugendkasse',createdAt:'2026-10-08T17:00:00Z',note:'Beispiel: Safe aufgefüllt',canViewEvidence:false}],settings:{email:'jugendkasse@bsvnordstern.de',instructions:'Lokale Vorschau: Geld in den Umschlag legen. Diese Beispieldaten verändern keinen echten Kassenbestand.'},accounts:people.map(p=>({...p,personId:p.id,active:true,birthdayReady:true,suiteUserId:p.id,teams:allowedTeams(p)}))};
state.settlements ||= [];
const balance=()=>state.entries.at(-1)?.balanceAfterCents||0;
const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
const page=before=>[...state.entries].reverse().filter(e=>!before||e.sequence<before).slice(0,31);
const superseded=entry=>state.entries.some(e=>e.supersedesEntryId===entry.id);
export function cashbookPreviewMembers() {
  const members=people.map(person=>({user_id:person.id,email:`cashbook-${person.id}@suite.bsvnordstern.invalid`,role:'sm-team',is_active:true,access_areas:['cashbook'],created_at:'2026-10-09T14:16:00Z'}));
  return [...enrichSuiteMembers(members,state.accounts),{user_id:'local-preview-admin',email:'admin@example.test',display_name:'Super-Admin (Vorschau)',role:'admin',is_active:true,access_areas:['social_media','user_management'],created_at:'2026-10-08T08:00:00Z'}];
}
function entryFor(e,person) {
  const transferred=state.settlements.find(event=>event.id===e.id&&event.action==='mark_transferred'),received=state.settlements.find(event=>event.id===e.id&&event.action==='confirm_received');
  const current=!superseded(e)&&e.entryType!=='cancellation',owner=e.accountId===person.id,advance=e.direction==='advance';
  return {...e,entryType:e.entryType||'booking',recordAmountCents:e.recordAmountCents??e.amountCents,superseded:superseded(e),status:e.entryType==='cancellation'?'cancelled':superseded(e)?'superseded':!advance||received?'completed':transferred?'transferred':'advanced',canManage:person.role==='trainer'&&owner&&(advance||e.direction==='withdrawal'||e.entryType==='correction')&&current&&!transferred,canViewEvidence:!!e.evidence&&(['cashier','observer'].includes(person.role)||owner),canMarkTransferred:advance&&current&&!transferred&&person.role==='cashier',canConfirmReceived:advance&&current&&!!transferred&&!received&&owner&&person.role==='trainer',transferredAt:transferred?.createdAt,transferredBy:transferred?.actorName,receivedAt:received?.createdAt,receivedBy:received?.actorName,notificationState:transferred?'sent':null};
}
const snapshot=(person,body={})=>({user:{...person,notificationEmail:[...state.entries].reverse().find(e=>e.accountId===person.id&&e.direction==='advance')?.notificationEmail},canBook:person.role!=='observer',canDeposit:person.role==='cashier'||person.isYouthLeader===true,canWithdraw:person.role==='trainer'&&allowedTeams(person).length>0,canReimburse:person.role==='cashier',canExport:['cashier','observer'].includes(person.role),teams:allowedTeams(person),entries:page(body.before).map(e=>entryFor(e,person)),openAdvances:state.entries.map(e=>entryFor(e,person)).filter(e=>e.direction==='advance'&&['advanced','transferred'].includes(e.status)&&(person.role!=='trainer'||e.accountId===person.id)),balanceCents:balance(),thresholdCents:5000,instructions:state.settings.instructions});
export async function cashbookPreviewApi(body,persona) {
  const person=people.find(p=>p.username===persona)||{id:'local-preview-admin',name:'Super-Admin (Vorschau)',role:'observer'};
  if(['mark_transferred','confirm_received'].includes(body.action)){
    const settlement=validateCashbookSettlement(body),entry=state.entries.find(e=>e.id===body.id),prior=state.settlements.find(e=>e.requestId===body.requestId&&e.actorId===person.id);
    if(prior){if(prior.id!==settlement.id||prior.action!==settlement.action)throw Object.assign(new Error('Diese Bestätigung gehört zu anderen Angaben.'),{status:409});return snapshot(person);}
    const row=entry&&entryFor(entry,person);if(!row||(body.action==='mark_transferred'?!row.canMarkTransferred:!row.canConfirmReceived))throw Object.assign(new Error('Dieser Schritt ist nicht erlaubt.'),{status:403});
    state.settlements.push({...settlement,actorId:person.id,actorName:person.name,createdAt:new Date().toISOString()});save();return snapshot(person);
  }
  if(body.action==='edit'||body.action==='cancel'){
    const change=validateCashbookChange(body),entry=state.entries.find(e=>e.id===change.id),prior=state.entries.find(e=>e.requestId===change.requestId&&e.accountId===person.id);
    if(person.role!=='trainer'||!entry||entry.accountId!==person.id||(entry.direction==='deposit'&&(!entry.entryType||entry.entryType==='booking')))throw Object.assign(new Error('Du darfst nur eigene Einträge bearbeiten oder löschen.'),{status:403});
    if(prior){if(prior.supersedesEntryId!==entry.id||prior.changeAction!==change.action||JSON.stringify(prior.change)!==JSON.stringify(change))throw Object.assign(new Error('Diese Änderungsnummer gehört zu anderen Angaben.'),{status:409});return snapshot(person);}
    if(superseded(entry)||entry.entryType==='cancellation'||state.settlements.some(e=>e.id===entry.id))throw Object.assign(new Error('Dieser Eintrag wurde bereits geändert. Bitte aktualisieren.'),{status:409});
    if(!body.signature||body.signatureDrawn!==true)throw new Error('Bitte die Änderung unterschreiben.');
    const cancel=body.action==='cancel',amount=cancel?0:change.amountCents,teamId=cancel?entry.teamId:change.teamId;
    if(!cancel&&!allowedTeams(person).some(t=>t.id===teamId))throw Object.assign(new Error('Bitte eine eigene Mannschaft auswählen.'),{status:403});
    const advance=entry.direction==='advance',delta=advance?0:(entry.recordAmountCents??entry.amountCents)-amount;
    if(balance()+delta<0)throw Object.assign(new Error('Der Safe enthält nicht genug Geld für die zusätzliche Entnahme.'),{status:409});
    state.entries.push({id:crypto.randomUUID(),sequence:state.entries.at(-1).sequence+1,accountId:person.id,requestId:change.requestId,notificationEmail:entry.notificationEmail,direction:advance?'advance':delta>=0?'deposit':'withdrawal',amountCents:Math.abs(delta),recordAmountCents:amount,balanceAfterCents:balance()+delta,personName:person.name,teamId,teamName:teams.find(t=>t.id===teamId).name,note:cancel?entry.note:change.note,evidence:body.evidence||entry.evidence,signature:body.signature,entryType:cancel?'cancellation':'correction',originalEntryId:entry.originalEntryId||entry.id,supersedesEntryId:entry.id,changeReason:change.reason,createdAt:new Date().toISOString(),changeAction:change.action,change});save();
  }
  if(body.action==='book'){
    Object.assign(body,validateCashbookBooking(body));
    const prior=state.entries.find(e=>e.requestId===body.requestId);if(prior)return snapshot(person);
    if(body.direction==='deposit'&&person.role!=='cashier'&&!person.isYouthLeader)throw new Error('Nur die Kasse und die Jugendleitung dürfen einzahlen.');
    if(body.direction!=='deposit'&&(person.role!=='trainer'||!allowedTeams(person).some(t=>t.id===body.teamId)))throw new Error('Bitte eine berechtigte Mannschaft auswählen.');
    if(body.direction==='withdrawal'&&body.amountCents>balance())throw new Error('Bestand reicht nicht aus.');
    state.entries.push({id:crypto.randomUUID(),sequence:(state.entries.at(-1)?.sequence||0)+1,requestId:body.requestId,accountId:person.id,direction:body.direction,amountCents:body.amountCents,notificationEmail:body.notificationEmail,balanceAfterCents:balance()+(body.direction==='advance'?0:body.direction==='deposit'?body.amountCents:-body.amountCents),personName:person.name,teamId:body.teamId,teamName:body.direction==='deposit'?'Vereinskasse / Jugendkasse':teams.find(t=>t.id===body.teamId).name,note:body.note,createdAt:new Date().toISOString(),evidence:body.evidence,signature:body.signature});save();
  }
  if(body.action==='media'){const entry=state.entries.find(e=>e.id===body.id);if(!entry||(!['cashier','observer'].includes(person.role)&&entry.accountId!==person.id))throw new Error('Kein Zugriff auf diesen Beleg.');return {evidenceUrl:entry.evidence,signatureUrl:entry.signature};}
  return snapshot(person,body);
}
export async function cashbookPreviewAdmin(body) {
  if(body.action==='cashbook_media'){const entry=state.entries.find(e=>e.id===body.id);return {evidenceUrl:entry?.evidence,signatureUrl:entry?.signature};}
  if(body.action==='cashbook_settings'){state.settings={email:body.email,instructions:body.instructions};save();}
  if(body.action==='cashbook_account'){const person=people.find(p=>p.id===body.personId);state.accounts=state.accounts.filter(p=>p.personId!==body.personId);state.accounts.push({...body,name:person?.name||'Beispielperson',isYouthLeader:person?.isYouthLeader||false,birthdayReady:true,teams:body.role==='trainer'?allowedTeams(person):[]});save();}
  return {accounts:state.accounts,members:people.map(p=>({id:p.id,email:p.username+' (Suite-Vorschau)',active:true})),provision:{created:0,skipped:[],errors:[]},people,teams:teams.map(t=>({...t,enabled:true})),balanceCents:balance(),entries:page(body.before).map(e=>({...e,canViewEvidence:!!e.evidence})),settings:state.settings,notifications:[],import:{added:0,collisions:[]}};
}
