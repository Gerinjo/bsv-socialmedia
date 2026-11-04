import {validatePortalSubmission,contractEvidencePages,contractPortalStatus,contractGuardianConsentPages} from '/trainer-contract-portal-model.mjs';
import {trainerContractDocument,trainerContractWaiverDocument} from '/trainer-contract-document.mjs';
import {trainerPreviewRaw} from '/preview-trainer-management.mjs';
const key='bsv-trainer-contracts-preview-v1';
const bytes=file=>Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));
const hash=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))].map(n=>n.toString(16).padStart(2,'0')).join('');
export function contractPreviewOwnPerson(){const r=trainerPreviewRaw(),team=r.teams.find(t=>/^u15/.test(t.slug)),a=r.assignments.find(a=>a.teamId===team?.id&&a.slot==='trainer');return a?.personId||r.people[0]?.id;}
export async function contractPortalPreviewApi(body,persona,administrator=false){
 const all=JSON.parse(localStorage.getItem(key)||'[]'),own=persona==='mustm'?contractPreviewOwnPerson():null,save=()=>localStorage.setItem(key,JSON.stringify(all));
 const decorate=c=>({...c,portalVersion:c.portalVersion||0,signatures:c.signatures||[],reference:'TV-'+c.season.replace('/','-')+'-'+String(c.number).padStart(5,'0'),documentHash:c.documentHash||'a'.repeat(64),hasDocument:!!c.issuedFile,hasSignedDocument:!!c.signedFile,guardianConfirmed:!!c.guardianFile,canAdminister:administrator,canCountersign:administrator});
 const render=async(pages,options,extra={})=>{const r=await fetch('/preview-contract-pdf',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pages,options,...extra})});if(!r.ok)throw new Error('PDF konnte nicht erzeugt werden.');return r.json();};
 const merge=async files=>{const r=await fetch('/preview-contract-merge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(files)});if(!r.ok)throw new Error('PDF konnte nicht verbunden werden.');return r.json();};
 const action=body.action.replace(/^my_contract_/,'');if(action==='list')return {contracts:all.filter(c=>c.person_id===own).map(decorate),linked:!!own};
 const raw=all.find(c=>c.id===body.id);if(!raw||!administrator&&raw.person_id!==own)throw new Error('Kein Zugriff auf diesen Vertrag.');let c=decorate(raw);
 if(action==='get')return c;
 if(action==='sign'){
  const v=validatePortalSubmission(body,c);if(v.part==='club'?!administrator:raw.person_id!==own)throw new Error('Nur persönlich zugeordnete Unterlagen dürfen unterschrieben werden.');
  if(raw.status==='cancelled'||!['issued','signed'].includes(raw.status)||!v.part.startsWith('waiver_')&&raw.status!=='issued')throw new Error('Vertrag ist nicht zur Unterschrift freigegeben.');
  if(v.part==='club'&&!contractPortalStatus(c).trainerComplete)throw new Error('Zuerst die drei Trainer-Unterschriften.');
  if(v.part.startsWith('waiver_')&&!contractPortalStatus(c).contractComplete)throw new Error('Zuerst den Vertrag vollständig abschließen.');
  raw.signatures||=[];const existing=raw.signatures.find(s=>s.part===v.part);if(existing){if(existing.request_id===body.requestId&&existing.place===v.place&&JSON.stringify(existing.values)===JSON.stringify(v.values)&&JSON.stringify(existing.strokes)===JSON.stringify(v.strokes))return c;throw new Error('Bereits unterzeichnet.');}
  if(body.version!==c.portalVersion||body.documentHash!==c.documentHash)throw new Error('Unterlagen inzwischen geändert.');
  if(v.part==='club'&&raw.signatures.find(s=>s.part==='agreement')?.actor===persona)throw new Error('Eigene Gegenzeichnung ist nicht möglich.');
  const s={...v,actor:persona,request_id:body.requestId,signer_name:v.part==='club'?'Anna Administration':c.snapshot.name,signed_at:new Date().toISOString(),document_hash:c.documentHash};s.evidence_hash=await hash(s);raw.signatures.push(s);raw.portalVersion=c.portalVersion+1;raw.version++;save();c=decorate(raw);
  if(v.part==='club'&&!contractPortalStatus(c).guardianRequired){raw.signedFile=await combined(false);raw.digitalSigned=true;raw.status='signed';save();c=decorate(raw);}return c;
 }
 if(action==='guardian_waiver_upload'){if(!administrator||!body.confirmed)throw new Error('Vertragsberechtigung und Bestätigung erforderlich.');raw.guardianConsents||={};raw.guardianConsents[body.part]={maxWaiverCents:body.maxWaiverCents};raw.guardianFiles||={};raw.guardianFiles[body.part]={base64:body.file.split(',')[1]};raw.portalVersion=c.portalVersion+1;save();return decorate(raw);}
 if(action==='guardian_upload'){if(!administrator||!body.confirmed)throw new Error('Vertragsberechtigung und Bestätigung erforderlich.');raw.guardianFile={base64:body.file.split(',')[1],filename:'Zustimmung.pdf'};raw.portalVersion=c.portalVersion+1;c=decorate(raw);if(contractPortalStatus(c).trainerComplete&&contractPortalStatus(c).clubComplete){raw.signedFile=await combined(false);raw.digitalSigned=true;raw.status='signed';}save();return decorate(raw);}
 if(action==='finalize')return c;
 if(action==='download'){
  const part=body.kind||'contract';let f;
  if(part==='guardian_template')f=await render(contractGuardianConsentPages(c),{number:c.reference,templateVersion:c.snapshot.templateVersion});else if(part==='original')f=raw.issuedFile;else if(['contract','all','agreement','allowance','conduct','club'].includes(part))f=await combined(part==='all');else if(part==='guardian'||part.startsWith('guardian_waiver_')){f=part==='guardian'?raw.guardianFile:raw.guardianFiles?.[part.slice(9)];if(!f)throw new Error('Zustimmung fehlt.');}
  else{const s=c.signatures.find(s=>s.part===part);f=s?await merge([await render(trainerContractWaiverDocument(c.snapshot,part.slice(7),s),{number:c.reference,templateVersion:c.snapshot.templateVersion,signatures:[s]}),await render(contractEvidencePages(c,[s]),{number:c.reference,templateVersion:c.snapshot.templateVersion})]):await render(trainerContractDocument(c.snapshot).slice(part.startsWith('waiver_')?6:0,part.startsWith('waiver_')?9:6),{number:c.reference,templateVersion:c.snapshot.templateVersion,draft:true});}
  return {...f,mime:'application/pdf',filename:c.reference+'-'+part+'.pdf'};
 }
 throw new Error('Unbekannte Aktion.');
 async function combined(waivers){const options={number:c.reference,templateVersion:c.snapshot.templateVersion},files=[];
  if(raw.signedFile&&!raw.digitalSigned)files.push(raw.signedFile);else{const pages=trainerContractDocument(c.snapshot).slice(0,6),core=c.signatures.filter(s=>!s.part.startsWith('waiver_'));let base=raw.issuedFile||await render(pages,{...options,draft:true});
   if(core.length||raw.guardianFile)base=await render(pages,{...options,guardianConfirmed:!!raw.guardianFile,legacyAppendix:trainerContractDocument(c.snapshot).slice(6)},{baseFile:base,signatures:core});files.push(base);
   if(core.length)files.push(await render(contractEvidencePages(c,core),options));if(raw.guardianFile)files.push(raw.guardianFile);}
  if(waivers)for(const s of c.signatures.filter(s=>s.part.startsWith('waiver_'))){files.push(await render(trainerContractWaiverDocument(c.snapshot,s.part.slice(7),s),{...options,signatures:[s]}));files.push(await render(contractEvidencePages(c,[s]),options));if(raw.guardianFiles?.[s.part])files.push(raw.guardianFiles[s.part]);}
  return files.length>1?merge(files):files[0];}
}
