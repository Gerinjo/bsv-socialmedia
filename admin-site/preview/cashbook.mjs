// Deliberately synthetic data, isolated from the real safe and mail delivery.
const KEY='bsv-cashbook-preview-v3';
const team={id:'10000000-0000-4000-8000-000000000001',name:'U15 C1-Junioren (Beispiel)'};
const dTeam={id:'10000000-0000-4000-8000-000000000002',name:'U13 D1-Junioren (Beispiel)'};
const teams=[team,dTeam];
const people=[{id:'20000000-0000-4000-8000-000000000001',name:'Max Mustermann',username:'mustm',role:'trainer'},{id:'20000000-0000-4000-8000-000000000002',name:'Wiebke Beispiel',username:'kassw',role:'cashier'},{id:'20000000-0000-4000-8000-000000000003',name:'Jugendleitung Beispiel',username:'beisj',role:'trainer',isYouthLeader:true}];
const allowedTeams=person=>person.isYouthLeader?teams:person.role==='trainer'?[team]:[];
let state;
try{state=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
state ||= {entries:[{id:crypto.randomUUID(),sequence:1,direction:'deposit',amountCents:20000,balanceAfterCents:20000,personName:'Wiebke Beispiel',teamName:'Vereinskasse / Jugendkasse',createdAt:'2026-10-08T17:00:00Z',note:'Beispiel: Safe aufgefüllt',canViewEvidence:false}],settings:{email:'jugendkasse@bsvnordstern.de',instructions:'Lokale Vorschau: Geld in den Umschlag legen. Diese Beispieldaten verändern keinen echten Kassenbestand.'},accounts:people.map(p=>({...p,personId:p.id,active:true,birthdayReady:true,suiteUserId:p.id,teams:allowedTeams(p)}))};
const balance=()=>state.entries.at(-1)?.balanceAfterCents||0;
const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
const page=before=>[...state.entries].reverse().filter(e=>!before||e.sequence<before).slice(0,31);
const snapshot=(person,body={})=>({user:person,canBook:person.role!=='observer',canExport:['cashier','observer'].includes(person.role),teams:allowedTeams(person),entries:page(body.before).map(e=>({...e,canViewEvidence:!!e.evidence&&(['cashier','observer'].includes(person.role)||e.accountId===person.id)})),balanceCents:balance(),thresholdCents:5000,instructions:state.settings.instructions});
export async function cashbookPreviewApi(body,persona) {
  const person=people.find(p=>p.username===persona)||{id:'local-preview-admin',name:'Super-Admin (Vorschau)',role:'observer'};
  if(body.action==='book'){
    const prior=state.entries.find(e=>e.requestId===body.requestId);if(prior)return snapshot(person);
    if(body.direction==='deposit'&&person.role!=='cashier')throw new Error('Nur die Kasse darf einzahlen.');
    if(body.direction==='withdrawal'&&(person.role!=='trainer'||!allowedTeams(person).some(t=>t.id===body.teamId)))throw new Error('Bitte eine berechtigte Mannschaft auswählen.');
    if(body.direction==='withdrawal'&&body.amountCents>balance())throw new Error('Bestand reicht nicht aus.');
    state.entries.push({id:crypto.randomUUID(),sequence:(state.entries.at(-1)?.sequence||0)+1,requestId:body.requestId,accountId:person.id,direction:body.direction,amountCents:body.amountCents,balanceAfterCents:balance()+(body.direction==='deposit'?body.amountCents:-body.amountCents),personName:person.name,teamName:body.direction==='deposit'?'Vereinskasse / Jugendkasse':teams.find(t=>t.id===body.teamId).name,note:body.note,createdAt:new Date().toISOString(),evidence:body.evidence,signature:body.signature});save();
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
