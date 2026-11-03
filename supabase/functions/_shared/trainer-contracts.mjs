import {compensationSeason} from '../../../src/trainer-compensation.mjs';
import {createTrainerContractDraft,validateTrainerContract,trainerContractIssues,contractSourceChanged,contractCandidates,trainerContractAnnualIssues,TRAINER_CONTRACT_VERSION} from '../../../src/trainer-contracts.mjs';
import {trainerContractDocument} from '../../../src/trainer-contract-document.mjs';
import {receiptHash} from './referee-receipts.mjs';

export const TRAINER_CONTRACT_BUCKET='trainer-contracts';
const uuid=value=>{if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value||''))throw new Error('Bitte einen gültigen Vertrag auswählen.');return value;};
const encoded=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary);};
const number=c=>'TV-'+c.season.replace('/','-')+'-'+String(c.number).padStart(5,'0');
const publicRecord=c=>{const {document_path,signed_path,...rest}=c;return {...rest,reference:number(c),hasDocument:Boolean(document_path),hasSignedDocument:Boolean(signed_path)};};
export async function contractRpc(db,actor,payload){const {data,error}=await db.rpc('trainer_contract_request',{actor,payload});if(error)throw Object.assign(new Error('Der Vertrag konnte nicht geladen oder gespeichert werden.'),{status:503});if(!data||data.error)throw Object.assign(new Error(data?.error||'Vertragsverwaltung vorübergehend nicht verfügbar.'),{status:data?.status||503});return data;}
export async function handleTrainerContracts(db,actor,body,{pdf,inspectSigned}={}){
 const action=String(body.action||'').replace(/^contract_/,''),rpc=payload=>contractRpc(db,actor,payload);
 if(action==='list')return rpc({action,season:compensationSeason(body.season)});
 if(['create','prepare_all'].includes(action)){
  const season=compensationSeason(body.season),context=await rpc({action:'source',season});
  const create=async p=>{const snapshot=validateTrainerContract(createTrainerContractDraft(context,season,p.personId,p.teamId,p.slot));return rpc({action:'create',season,personId:p.personId,teamId:p.teamId,slot:p.slot,snapshot});};
  if(action==='create')return create(body);
  const existing=new Set(context.contracts.filter(c=>c.status!=='cancelled').map(c=>[c.personId,c.teamId,c.slot].join(':'))),results=[];
  for(const row of contractCandidates(context,season).filter(r=>r.enabled&&!existing.has([r.personId,r.teamId,r.slot].join(':')))){
   try{const r=await create(row);results.push({...r,name:row.name});}catch(error){results.push({name:row.name,error:error.message});}
  }
  return {ok:results.every(r=>r.ok),results};
 }
 const id=uuid(body.id),c=await rpc({action:'get',id});
 if(action==='get')return publicRecord(c);
 if(action==='download'){
  if(!['issued','signed'].includes(body.kind))throw new Error('Bitte eine Vertragsfassung auswählen.');const path=body.kind==='signed'?c.signed_path:c.document_path;
  if(!path)throw new Error('Diese Vertragsfassung liegt noch nicht vor.');
  const {data,error}=await db.storage.from(TRAINER_CONTRACT_BUCKET).download(path);if(error||!data)throw new Error('Die Vertragsdatei konnte nicht geladen werden.');
  const bytes=new Uint8Array(await data.arrayBuffer());if(await receiptHash(bytes)!==(body.kind==='signed'?c.signed_hash:c.document_hash))throw new Error('Die Integritätsprüfung der Vertragsdatei ist fehlgeschlagen.');
  return {mime:'application/pdf',filename:number(c)+(body.kind==='signed'?'-unterzeichnet':'')+'.pdf',base64:encoded(bytes)};
 }
 if(!Number.isSafeInteger(body.version)||body.version!==c.version)throw Object.assign(new Error('Der Vertrag wurde inzwischen geändert. Bitte neu laden.'),{status:409});
 if(['delete','cancel'].includes(action))return rpc({action,id,version:c.version,confirmed:body.confirmed===true});
 if(['save','refresh'].includes(action)){
  if(c.status!=='draft')throw new Error('Freigegebene Verträge sind unveränderlich.');let snapshot;
  if(action==='refresh'){const context=await rpc({action:'source',season:c.season});snapshot={...createTrainerContractDraft(context,c.season,c.person_id,c.team_id,c.slot),bank:c.snapshot.bank};}
  else{const editable=['street','postcode','city','birthDate','guardianName','start','end','monthlyCents','grossMonthlyCents','share','license','paidMonths','bank','financialConfirmed'];snapshot={...c.snapshot};for(const key of editable)if(Object.hasOwn(body.details||{},key))snapshot[key]=body.details[key];}
  return rpc({action:'save',id,version:c.version,snapshot:validateTrainerContract(snapshot)});
 }
 if(action==='preview'){
  if(c.snapshot.templateVersion!==TRAINER_CONTRACT_VERSION)throw new Error('Bitte die archivierte freigegebene Fassung herunterladen.');
  const bytes=await pdf(trainerContractDocument(c.snapshot),{number:number(c),templateVersion:c.snapshot.templateVersion,draft:true});return {mime:'application/pdf',filename:number(c)+'-Entwurf.pdf',base64:encoded(bytes)};
 }
 if(action==='issue'){
  if(c.status!=='draft')throw new Error('Nur Entwürfe können freigegeben werden.');
  const snapshot=validateTrainerContract(c.snapshot),issues=trainerContractIssues(snapshot);if(issues.length)throw new Error(issues.join(' · '));
  const context=await rpc({action:'source',season:c.season});if(contractSourceChanged(snapshot,context))throw Object.assign(new Error('Stammdaten oder Gehaltsplanung wurden geändert. Bitte die Quelldaten neu übernehmen.'),{status:409});
  const annualIssues=trainerContractAnnualIssues(snapshot,context.annualTotals);if(annualIssues.length)throw new Error(annualIssues.join(' · '));
  const bytes=await pdf(trainerContractDocument(snapshot),{number:number(c),templateVersion:snapshot.templateVersion,draft:false});return storePdf('issued',bytes,{action:'issue'});
 }
 if(action==='upload_signed'){
  if(c.status!=='issued'||body.confirmed!==true)throw new Error('Bitte die erforderlichen Unterschriften am freigegebenen Vertrag bestätigen.');
  if(typeof body.file!=='string'||body.file.length>11200000||!/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/.test(body.file))throw new Error('Bitte ein unterzeichnetes PDF bis 8 MB auswählen.');
  const bytes=Uint8Array.from(atob(body.file.split(',')[1]),c=>c.charCodeAt(0));if(bytes.length>8388608||String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')throw new Error('Bitte ein gültiges Vertrags-PDF bis 8 MB auswählen.');
  try{await inspectSigned(bytes);}catch{throw new Error('Die Datei ist kein lesbares Vertrags-PDF.');}return storePdf('signed',bytes,{action:'signed',confirmed:true});
 }
 throw new Error('Unbekannte Vertragsaktion.');
 async function storePdf(kind,bytes,payload){
  const path=`${id}/${kind}/${c.version+1}-${crypto.randomUUID()}.pdf`,hash=await receiptHash(bytes),storage=db.storage.from(TRAINER_CONTRACT_BUCKET);
  const upload=await storage.upload(path,bytes,{contentType:'application/pdf',upsert:false,cacheControl:'0'});if(upload.error)throw new Error('Die Vertragsdatei konnte nicht sicher abgelegt werden.');
  try{return await rpc({...payload,id,version:c.version,path,hash});}catch(error){
   // A lost RPC response can follow a committed write. Never delete that PDF.
   try{const latest=await rpc({action:'get',id});if(latest.document_path===path||latest.signed_path===path)return {ok:true,id,version:latest.version};await storage.remove([path]);}catch{/* Retain a private orphan when the database outcome is unknown. */}
   throw error;
  }
 }
}
