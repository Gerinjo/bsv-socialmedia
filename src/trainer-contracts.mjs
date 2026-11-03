import {createCompensationPlan,validateCompensationPlan,compensationReport,compensationSeason} from './trainer-compensation.mjs';

export const TRAINER_CONTRACT_VERSION='2026-11-03.1';
export const TRAINER_CONTRACT_STATUSES={draft:'Entwurf',issued:'Zur Unterschrift',signed:'Unterzeichnete Fassung hinterlegt',cancelled:'Storniert'};
export const TRAINER_CONTRACT_MONTHS=[7,8,9,10,11,12,1,2,3,4,5,6];
export const TRAINER_CONTRACT_DEFAULT_MONTHS=[7,9,10,11,1,2,3,4,5,6];
export const contractMoney=cents=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(cents/100);
export const contractDate=iso=>iso?iso.split('-').reverse().join('.'):'Noch offen';
export function contractPlan(context,season){const defaults=createCompensationPlan(context,season);return context.plan?validateCompensationPlan({...context.plan,teams:{...defaults.teams,...context.plan.teams}}):defaults;}
export function contractCandidates(context,season){return compensationReport(context,contractPlan(context,season)).teams.flatMap(t=>t.rows.filter(r=>!r.vacant).map(r=>({...r,teamName:t.label,teamSlug:t.slug,person:context.people.find(p=>p.id===r.personId)})));}
export function createTrainerContractDraft(context,season,personId,teamId,slot){
 compensationSeason(season);const row=contractCandidates(context,season).find(r=>r.personId===personId&&r.teamId===teamId&&r.slot===slot);
 if(!row||!row.enabled)throw new Error('Bitte eine aktive, eingeplante Trainerposition auswählen.');
 const p=row.person,sourceBank=p.personalBank??p.previousBank,start=season.slice(0,4)+'-07-01',end=season.slice(5)+'-06-30';
 return {templateVersion:TRAINER_CONTRACT_VERSION,season,personId,teamId,slot,name:p.name,street:p.street||'',postcode:p.postcode||'',city:p.city||'',email:p.email||'',birthDate:p.birth_date||'',guardianName:'',role:row.role==='trainer'?'Trainer':'Co-Trainer',teamName:row.teamName,start,end,
  monthlyCents:row.monthlyMin!==null&&row.monthlyMin===row.monthlyMax?row.monthlyMin:null,grossMonthlyCents:row.rateMin===row.rateMax?row.rateMin:null,share:row.share,license:row.license,
  paidMonths:row.payments===10?[...TRAINER_CONTRACT_DEFAULT_MONTHS]:[],expectedPayments:row.payments,bank:{holder:sourceBank?.holder??p.name,iban:sourceBank?.iban??'',name:sourceBank?.name??''},financialConfirmed:false,
  source:{personalVersion:p.personalVersion||0,birthDate:p.birth_date||'',teamName:context.teams.find(t=>t.id===teamId)?.name||'',personVersion:p.version||0,planVersion:context.version||0,teamVersion:context.teams.find(t=>t.id===teamId)?.version||0},sourceIssues:[...row.issues,...(row.uncertain?['Lizenzstatus und Monatsbetrag klären']:[])]};
}
export function validateTrainerContract(value){
 if(!value||value.templateVersion!==TRAINER_CONTRACT_VERSION)throw new Error('Bitte einen aktuellen Vertragsentwurf öffnen.');
 const result=structuredClone(value);compensationSeason(result.season);
 const lengths={name:180,street:160,postcode:20,city:100,email:254,birthDate:10,guardianName:180,role:100,teamName:180,start:10,end:10};
 for(const [key,max] of Object.entries(lengths)){if(typeof result[key]!=='string'||result[key].length>max||/[\u0000-\u001f]/.test(result[key]))throw new Error('Bitte die Vertragsdaten prüfen und Eingaben kürzen.');result[key]=result[key].trim();}
 const validDate=s=>/^20\d{2}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(!validDate(result.start)||!validDate(result.end)||result.end<result.start||result.start<result.season.slice(0,4)+'-07-01'||result.end>result.season.slice(5)+'-06-30')throw new Error('Die Vertragslaufzeit muss innerhalb der gewählten Saison liegen.');
 if(result.birthDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(result.birthDate)||Number.isNaN(Date.parse(result.birthDate))||new Date(result.birthDate).toISOString().slice(0,10)!==result.birthDate||result.birthDate>result.start))throw new Error('Bitte das Geburtsdatum prüfen.');
 for(const key of ['monthlyCents','grossMonthlyCents'])if(result[key]!==null&&(!Number.isSafeInteger(result[key])||result[key]<0||result[key]>10000000))throw new Error('Bitte einen gültigen Monatsbetrag eingeben.');
 if(result.share!==null&&(typeof result.share!=='number'||!Number.isFinite(result.share)||result.share<0||result.share>100||Math.abs(result.share*100-Math.round(result.share*100))>.00001))throw new Error('Bitte den BSV-Anteil prüfen.');
 if(!['unknown','none','valid'].includes(result.license)||!Array.isArray(result.paidMonths)||result.paidMonths.some(m=>!TRAINER_CONTRACT_MONTHS.includes(m))||new Set(result.paidMonths).size!==result.paidMonths.length)throw new Error('Bitte Lizenz und Vergütungsmonate prüfen.');
 result.paidMonths=TRAINER_CONTRACT_MONTHS.filter(m=>result.paidMonths.includes(m));
 result.bank=Object.fromEntries(['holder','iban','name'].map(k=>{const s=result.bank?.[k];if(typeof s!=='string'||s.length>(k==='iban'?42:160)||/[\u0000-\u001f]/.test(s))throw new Error('Bitte die Bankverbindung prüfen.');return [k,s.trim()];}));result.bank.iban=result.bank.iban.replace(/[\s-]/g,'').toUpperCase();
 if(result.bank.iban&&!contractValidIban(result.bank.iban))throw new Error('Bitte eine gültige IBAN eingeben.');
 result.monthlyCents=result.grossMonthlyCents!==null&&result.share!==null?Math.round(result.grossMonthlyCents*result.share/100):null;
 result.financialConfirmed=result.financialConfirmed===true;return result;
}
export function contractValidIban(value){if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value))return false;const lengths={DE:22,AT:20,CH:21,FR:27,IT:27,ES:24,NL:18,BE:16,GB:22};if(lengths[value.slice(0,2)]&&value.length!==lengths[value.slice(0,2)])return false;let n=0;for(const char of value.slice(4)+value.slice(0,4))for(const digit of /[A-Z]/.test(char)?String(char.charCodeAt(0)-55):char)n=(n*10+Number(digit))%97;return n===1;}
export function contractIsMinor(value){return Boolean(value.birthDate&&value.start<`${Number(value.birthDate.slice(0,4))+18}${value.birthDate.slice(4)}`);}
export function contractMonthIso(value,month){return (month>=7?value.season.slice(0,4):value.season.slice(5))+'-'+String(month).padStart(2,'0');}
// TARGET banking holidays relevant to the March, June and November payment dates.
export function contractBankDueDate(year,month){
 const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),easterMonth=Math.floor((h+l-7*m+114)/31),easterDay=(h+l-7*m+114)%31+1;
 const easter=Date.UTC(year,easterMonth-1,easterDay),holiday=new Set([-2,1].map(offset=>new Date(easter+offset*86400000).toISOString().slice(0,10)));
 for(const suffix of ['01-01','05-01','12-25','12-26'])holiday.add(year+'-'+suffix);
 let day=new Date(Date.UTC(year,month,0)),count=0;for(;;day=new Date(day.getTime()-86400000)){const iso=day.toISOString().slice(0,10);if(![0,6].includes(day.getUTCDay())&&!holiday.has(iso)&&++count===3)return iso;}
}
export function trainerContractBatches(value){return [{key:'november',year:Number(value.season.slice(0,4)),month:11,months:[7,8,9,10,11]},{key:'maerz',year:Number(value.season.slice(5)),month:3,months:[12,1,2,3]},{key:'juni',year:Number(value.season.slice(5)),month:6,months:[4,5,6]}].map(b=>({...b,months:b.months.filter(m=>value.paidMonths.includes(m)),due:contractBankDueDate(b.year,b.month),amount:value.monthlyCents===null?null:value.monthlyCents*b.months.filter(m=>value.paidMonths.includes(m)).length})).filter(b=>b.months.length);}
export function trainerContractIssues(value){
 const issues=[];for(const [key,label] of Object.entries({name:'Name',street:'Straße und Hausnummer',postcode:'Postleitzahl',city:'Wohnort',birthDate:'Geburtsdatum'}))if(!value[key])issues.push(label+' fehlt');
 if(contractIsMinor(value)&&!value.guardianName)issues.push('Sorgeberechtigte Person fehlt');
 if(!value.bank?.holder||!value.bank?.iban||!value.bank?.name)issues.push('Bankverbindung ist unvollständig');
 if(value.grossMonthlyCents===null||value.monthlyCents===null)issues.push('Eindeutiger Monatsbetrag fehlt');if(value.share===null)issues.push('BSV-Anteil fehlt');
 if(value.role==='Trainer'&&value.license==='unknown')issues.push('Lizenzstatus ist ungeklärt');
 if(!value.paidMonths.length)issues.push('Vergütungsmonate fehlen');
 for(const month of value.paidMonths){const iso=contractMonthIso(value,month),last=new Date(Date.UTC(Number(iso.slice(0,4)),Number(iso.slice(5)),0)).toISOString().slice(0,10);if(iso+'-01'>value.end||last<value.start)issues.push('Vergütungsmonat liegt außerhalb der Laufzeit');}
 if(!value.financialConfirmed)issues.push('Vergütung und Vergütungsmonate bitte ausdrücklich prüfen');return [...new Set(issues)];
}
export function contractSourceChanged(snapshot,context){const p=context.people.find(p=>p.id===snapshot.personId),t=context.teams.find(t=>t.id===snapshot.teamId);return !p||(p.personalVersion||0)!==(snapshot.source.personalVersion||0)||p.active===false||!t||(p.birth_date||'')!==snapshot.source.birthDate||t.name!==snapshot.source.teamName||p.version!==snapshot.source.personVersion||(context.version||0)!==snapshot.source.planVersion||(t.version||0)!==snapshot.source.teamVersion||!context.assignments.some(a=>a.personId===snapshot.personId&&a.teamId===snapshot.teamId&&a.slot===snapshot.slot);}
export function trainerContractAnnualIssues(snapshot,totals=[]){
 const proposed=new Map();for(const b of trainerContractBatches(snapshot))if(b.amount!==null)proposed.set(b.year,(proposed.get(b.year)||0)+b.amount);
 return [...proposed].filter(([year,cents])=>cents+Number(totals.find(t=>t.personId===snapshot.personId&&t.year===year)?.cents||0)>(year>=2026?330000:300000)).map(([year])=>'Die bekannten BSV-Vergütungen überschreiten den Übungsleiterfreibetrag im Auszahlungsjahr '+year+'. Diese Vertragsvorlage kann dafür nicht freigegeben werden.');
}
