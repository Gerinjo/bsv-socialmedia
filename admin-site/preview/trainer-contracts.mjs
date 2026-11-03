import {trainerPersonalPreviewApi} from '/preview-trainer-management.mjs';
import {compensationPreviewApi} from '/preview-trainer-compensation.mjs';
import {contractCandidates,createTrainerContractDraft,validateTrainerContract,trainerContractIssues,contractSourceChanged} from '/trainer-contracts-model.mjs';
import {trainerContractDocument} from '/trainer-contract-document.mjs';
const key='bsv-trainer-contracts-preview-v1';
export async function trainerContractsPreviewApi(body){
 let all;try{all=JSON.parse(localStorage.getItem(key)||'[]');}catch{all=[];}const persist=()=>localStorage.setItem(key,JSON.stringify(all)),action=body.action.replace(/^contract_/,'');
 const context=async season=>{const data=await compensationPreviewApi({action:'salary_list',season});data.people=await Promise.all(data.people.map(async p=>{const d=await trainerPersonalPreviewApi({action:'trainer_private_get',personId:p.id});return {...p,...d.details,birth_date:d.details.birthDate,personalBank:d.details.bank,personalVersion:d.version};}));return {...data,contracts:all.filter(c=>c.season===season).map(c=>({id:c.id,number:c.number,season:c.season,personId:c.person_id,teamId:c.team_id,slot:c.slot,name:c.snapshot.name,teamName:c.snapshot.teamName,status:c.status,version:c.version,updatedAt:c.updated_at,periodStart:c.snapshot.start,periodEnd:c.snapshot.end,periodMonths:c.snapshot.paidMonths,periodMonthly:c.snapshot.monthlyCents,digitalComplete:c.status==='signed',signatureCount:(c.signatures||[]).filter(s=>['agreement','allowance','conduct'].includes(s.part)).length,declarations:(c.signatures||[]).filter(s=>s.part.startsWith('waiver_')).map(s=>({part:s.part,choice:s.values.choice}))})),annualTotals:[]};};
 if(action==='list')return context(body.season);
 const create=(data,p)=>{if(all.some(c=>c.season===body.season&&c.person_id===p.personId&&c.team_id===p.teamId&&c.slot===p.slot&&c.status!=='cancelled'))throw new Error('Für diese Position besteht bereits ein Vertrag.');const snapshot=createTrainerContractDraft(data,body.season,p.personId,p.teamId,p.slot),c={id:crypto.randomUUID(),number:all.length+1,season:body.season,person_id:p.personId,team_id:p.teamId,slot:p.slot,status:'draft',version:1,snapshot,updated_at:new Date().toISOString()};all.push(c);persist();return {ok:true,id:c.id,version:c.version};};
 if(action==='create')return create(await context(body.season),body);
 if(action==='prepare_all'){const data=await context(body.season),results=[];for(const p of contractCandidates(data,body.season).filter(r=>r.enabled&&!all.some(c=>c.season===body.season&&c.person_id===r.personId&&c.team_id===r.teamId&&c.slot===r.slot&&c.status!=='cancelled')))results.push(create(data,p));return {ok:true,results};}
 const c=all.find(c=>c.id===body.id);if(!c)throw new Error('Vertrag nicht gefunden.');
 if(action==='get')return {...c,reference:'TV-'+c.season.replace('/','-')+'-'+String(c.number).padStart(5,'0'),hasDocument:Boolean(c.issuedFile),hasSignedDocument:Boolean(c.signedFile)};
 if(action==='download'){const file=body.kind==='signed'?c.signedFile:c.issuedFile;if(!file)throw new Error('Datei nicht vorhanden.');return file;}
 if(body.version!==c.version)throw new Error('Der Vertrag wurde inzwischen geändert. Bitte neu laden.');
 if(action==='preview'||action==='issue'){
  if(action==='issue'){if(c.status!=='draft')throw new Error('Nur Entwürfe können freigegeben werden.');const issues=trainerContractIssues(c.snapshot);if(issues.length)throw new Error(issues.join(' · '));if(contractSourceChanged(c.snapshot,await context(c.season)))throw new Error('Die Quelldaten wurden geändert.');}
  const response=await fetch('/preview-contract-pdf',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pages:trainerContractDocument(c.snapshot),options:{number:'TV-'+c.number,templateVersion:c.snapshot.templateVersion,draft:action==='preview'}})});if(!response.ok)throw new Error('PDF konnte nicht erstellt werden.');const file=await response.json();if(action==='preview')return file;c.issuedFile=file;c.status='issued';
 }else if(action==='save'){if(c.status!=='draft')throw new Error('Freigegebene Verträge sind unveränderlich.');c.snapshot=validateTrainerContract(body.details);}
 else if(action==='refresh'){if(c.status!=='draft')throw new Error('Freigegebene Verträge sind unveränderlich.');c.snapshot={...createTrainerContractDraft(await context(c.season),c.season,c.person_id,c.team_id,c.slot)};}
 else if(action==='upload_signed'){if(c.status!=='issued'||!body.confirmed||!body.file?.startsWith('data:application/pdf;base64,JVBERi0'))throw new Error('Bitte ein unterzeichnetes PDF bestätigen.');c.signedFile={mime:'application/pdf',filename:'BSV-Vertrag-unterzeichnet.pdf',base64:body.file.split(',')[1]};c.status='signed';}
 else if(action==='cancel'&&body.confirmed)c.status='cancelled';
 else if(action==='delete'&&body.confirmed&&c.status==='draft')all=all.filter(row=>row.id!==c.id);
 else throw new Error('Ungültige Vertragsaktion.');
 c.version++;c.updated_at=new Date().toISOString();persist();return {ok:true,id:c.id,version:c.version};
}
