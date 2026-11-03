import {validatePortalSubmission,contractEvidencePages,contractPortalStatus,contractPortalBatches} from '../../../src/trainer-contract-portal.mjs';
import {trainerContractDocument} from '../../../src/trainer-contract-document.mjs';
import {receiptHash} from './referee-receipts.mjs';
const bucket='trainer-contracts';
const encoded=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);};
export async function handleContractPortal(db,actor,body,{pdf,merge,inspectSigned}={}){
 const action=String(body.action||'').replace(/^my_contract_/,''),rpc=async payload=>{const {data,error}=await db.rpc('trainer_contract_portal_request',{actor,payload});if(error)throw Object.assign(new Error('Die Vertragsunterlagen konnten nicht geladen oder gespeichert werden.'),{status:503});if(!data||data.error)throw Object.assign(new Error(data?.error||'Vertragszugriff vorübergehend nicht möglich.'),{status:data?.status||503});return data;};
 if(action==='list')return rpc({action:'list'});
 if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(body.id||''))throw new Error('Bitte einen gültigen Vertrag auswählen.');
 let c=await rpc({action:'get',id:body.id});
 if(action==='get')return c;
 const storage=db.storage.from(bucket),file=async kind=>{const info=await rpc({action:'file',id:c.id,kind});if(!info.path)return null;const {data,error}=await storage.download(info.path);if(error||!data)throw new Error('Die private Vertragsdatei konnte nicht geladen werden.');const bytes=new Uint8Array(await data.arrayBuffer());if(await receiptHash(bytes)!==info.hash)throw new Error('Die Integritätsprüfung der Vertragsdatei ist fehlgeschlagen.');return bytes;};
 async function store(bytes,path,commit){const hash=await receiptHash(bytes),upload=await storage.upload(path,bytes,{contentType:'application/pdf',upsert:false,cacheControl:'0'});if(upload.error)throw new Error('Die Vertragsdatei konnte nicht sicher abgelegt werden.');try{return await rpc({...commit,id:c.id,path,hash});}catch(error){/* Preserve private files on an unknown database outcome. */throw error;}}
 async function artifact(s){const existing=await file(s.part);if(existing)return existing;const pages=contractEvidencePages(c,[s]),bytes=await pdf(pages,{number:c.reference,templateVersion:c.snapshot.templateVersion});if(c.status==='cancelled')return bytes;await store(bytes,c.id+'/signatures/'+s.part+'-'+s.evidence_hash+'-'+crypto.randomUUID()+'.pdf',{action:'artifact',part:s.part,evidenceHash:s.evidence_hash});return await file(s.part)||bytes;}
 async function envelope(includeWaivers){let base=await file('signed');if(!base){base=await file('base');if(!base)base=await pdf(trainerContractDocument(c.snapshot).slice(0,6),{number:c.reference,templateVersion:c.snapshot.templateVersion,draft:true});const files=[base];for(const s of c.signatures.filter(s=>!s.part.startsWith('waiver_')))files.push(await artifact(s));const guardian=await file('guardian');if(guardian)files.push(guardian);base=files.length>1?await merge(files):base;}
  const files=[base];if(includeWaivers)for(const s of c.signatures.filter(s=>s.part.startsWith('waiver_'))){files.push(await artifact(s));const consent=await file('guardian_'+s.part);if(consent)files.push(consent);}return files.length>1?merge(files):base;}
 async function seal(){const status=contractPortalStatus(c);if(c.status==='issued'&&status.trainerComplete&&status.clubComplete&&(!status.guardianRequired||c.guardianConfirmed)){await rpc({action:'authorize_seal',id:c.id,version:c.portalVersion});const bytes=await envelope(false);c=await store(bytes,c.id+'/signed/digital-'+c.portalVersion+'-'+crypto.randomUUID()+'.pdf',{action:'seal',version:c.portalVersion});}return c;}
 if(action==='sign'){
  if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(body.requestId||'')||!Number.isSafeInteger(body.version)||body.version<0)throw new Error('Bitte die Unterlagen neu öffnen.');
  const submission=validatePortalSubmission(body,c);c=await rpc({action:'sign',id:c.id,version:body.version,requestId:body.requestId,documentHash:body.documentHash,...submission});
  try{await artifact(c.signatures.find(s=>s.part===submission.part));if(submission.part==='club')await seal();}catch{c={...c,documentNotice:'Die Unterschrift ist gespeichert. Die PDF-Ablage kann über „Dokumente aktualisieren“ erneut abgeschlossen werden.'};}return c;
 }
 if(action==='finalize'){if(c.canAdminister||c.canCountersign)c=await seal();return c;}
 if(action==='guardian_upload'||action==='guardian_waiver_upload'){
  const waiver=action==='guardian_waiver_upload';if(waiver&&(!/^waiver_(november|maerz|juni)$/.test(body.part||'')||!Number.isSafeInteger(body.maxWaiverCents)||body.maxWaiverCents<=0))throw new Error('Bitte Auszahlungsblock und bestätigten maximalen Verzicht prüfen.');
  await rpc({action:waiver?'authorize_guardian_waiver':'authorize_guardian',id:c.id,version:body.version});
  if(body.confirmed!==true||typeof body.file!=='string'||body.file.length>11200000||!/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/.test(body.file))throw new Error('Bitte die tatsächlich unterzeichnete Zustimmung als PDF bestätigen.');
  const bytes=Uint8Array.from(atob(body.file.split(',')[1]),v=>v.charCodeAt(0));if(bytes.length>8388608)throw new Error('PDF bis 8 MB auswählen.');await inspectSigned(bytes);
  c=await store(bytes,c.id+'/guardian/'+crypto.randomUUID()+'.pdf',{action:waiver?'guardian_waiver':'guardian',version:body.version,confirmed:true,part:body.part,maxWaiverCents:body.maxWaiverCents});return seal();
 }
 if(action==='download'){
  const kind=body.kind||'contract';let bytes;
  if(kind==='all')bytes=await envelope(true);else if(kind==='contract')bytes=await envelope(false);else if(kind==='guardian'||/^guardian_waiver_(november|maerz|juni)$/.test(kind)){bytes=await file(kind);if(!bytes)throw new Error('Diese Zustimmung liegt noch nicht vor.');}
  else if(['agreement','allowance','conduct','club'].includes(kind)){const s=c.signatures.find(s=>s.part===kind);if(s){const proof=await artifact(s),base=await file('base');bytes=base?await merge([base,proof]):proof;}else bytes=await envelope(false);}
  else if(/^waiver_(november|maerz|juni)$/.test(kind)){const batch=contractPortalBatches(c.snapshot).find(b=>'waiver_'+b.key===kind);if(!batch)throw new Error('Für diesen Zeitraum besteht kein Vergütungsanspruch.');const s=c.signatures.find(s=>s.part===kind);if(s)bytes=await artifact(s);else{const section=trainerContractDocument(c.snapshot).find(p=>p.title.startsWith('Auszahlungsabfrage')&&p.blocks.some(b=>b.label==='Fälligkeit'&&b.text===batch.due.split('-').reverse().join('.')));bytes=await pdf(section?[section]:[{title:'Auszahlungsabfrage',blocks:[{kind:'p',text:'Noch nicht unterzeichnet. Fälligkeit '+batch.due}]}],{number:c.reference,templateVersion:c.snapshot.templateVersion,draft:true});}}
  else throw new Error('Bitte ein Vertragsdokument auswählen.');
  return {mime:'application/pdf',filename:c.reference+'-'+kind+'.pdf',base64:encoded(bytes)};
 }
 throw new Error('Unbekannte Aktion für Mein Vertrag.');
}
