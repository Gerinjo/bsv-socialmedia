import {trainerOnlyTeam,trainerAssignmentRole} from './trainer-team-roles.mjs';
export const COMPENSATION_AGES={bambini:'Bambini',f:'F-Jugend',e:'E-Jugend',d:'D-Jugend',c:'C-Jugend',b:'B-Jugend',a:'A-Jugend'};
export const COMPENSATION_RATES={bambini:{base:3000,licensed:5000,co:0},f:{base:5000,licensed:7500,co:0},e:{base:5000,licensed:7500,co:0},d:{base:7000,licensed:10500,co:3500},c:{base:9000,licensed:13500,co:4500},b:{base:10000,licensed:15000,co:5000},a:{base:10000,licensed:15000,co:5000}};
export const COMPENSATION_SENIORS=['herren-1','herren-2','frauen-1','frauen-2'];
export function compensationAge(team){
 const slug=team.slug||'';if(COMPENSATION_SENIORS.includes(slug))return 'senior';
 const age=Number(slug.match(/^u(\d+)(?:-|$)/)?.[1]);
 return age>=18?'a':age>=16?'b':age>=14?'c':age>=12?'d':age>=10?'e':age>=8?'f':age>0?'bambini':null;
}
export function compensationTeamLabel(team){const labels={'herren-1':'Herren · 1. Mannschaft','herren-2':'Herren · 2. Mannschaft','frauen-1':'Frauen · 1. Mannschaft','frauen-2':'Frauen · 2. Mannschaft'};return labels[team.slug]||team.name;}
export function compensationSeason(value){const s=String(value||'');if(!/^20\d{2}\/20\d{2}$/.test(s)||Number(s.slice(5))!==Number(s.slice(0,4))+1)throw new Error('Bitte eine Saison wie 2026/2027 angeben.');return s;}
export function compensationRole(a,team){if(trainerOnlyTeam(team)&&a.slot!=='betreuer'&&/^(trainer|co[12]|extra-[1-9][0-9]?)$/.test(a.slot||''))return 'trainer';if(a.slot==='trainer')return 'trainer';if(/^co[12]$/.test(a.slot))return 'co';if(/^extra-/.test(a.slot)&&/trainer|coach/i.test(a.websiteRole||''))return 'co';return null;}
export function compensationKey(a){return `${a.teamId}:${a.personId||'vacant'}:${a.slot}`;}
export function createCompensationPlan(roster,season='2026/2027'){
 return {schemaVersion:1,season:compensationSeason(season),youthRates:structuredClone(COMPENSATION_RATES),teams:Object.fromEntries(roster.teams.filter(t=>compensationAge(t)).map(t=>{const age=compensationAge(t);return [t.id,{included:true,age,payments:10,share:/\bSG\b|Spielgemeinschaft/i.test(t.name)?null:100,head:null,co:null,reserveVacancies:false}]})),assignments:{}};
}
export function validateCompensationPlan(value){
 if(!value||value.schemaVersion!==1)throw new Error('Unbekanntes Vergütungskonzept.');
 const plan={schemaVersion:1,season:compensationSeason(value.season),youthRates:{},teams:{},assignments:{}};
 const number=(n,max,nullable=false,integer=false)=>{if(nullable&&n===null)return null;if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>max||(integer&&!Number.isSafeInteger(n)))throw new Error('Bitte Beträge, Anteile und Anzahl der Zahlungen prüfen.');return n;};
 for(const age of Object.keys(COMPENSATION_AGES)){const r=value.youthRates?.[age];if(!r)throw new Error('Jugendsätze sind unvollständig.');plan.youthRates[age]=Object.fromEntries(['base','licensed','co'].map(k=>[k,number(r[k],10000000,false,true)]));if(r.licensed<r.base)throw new Error('Der Satz mit Lizenz darf den Grundbetrag nicht unterschreiten.');}
 if(!value.teams||Array.isArray(value.teams)||Object.keys(value.teams).length>150||!value.assignments||Array.isArray(value.assignments)||Object.keys(value.assignments).length>1000)throw new Error('Ungültige Vergütungszuordnungen.');
 for(const [id,t] of Object.entries(value.teams)){if(!/^[a-f\d-]{36}$/i.test(id)||!['senior',...Object.keys(COMPENSATION_AGES)].includes(t.age)||typeof t.included!=='boolean'||typeof t.reserveVacancies!=='boolean')throw new Error('Bitte die Mannschaftseinstellungen prüfen.');const share=number(t.share,100,true);if(share!==null&&Math.abs(share*100-Math.round(share*100))>.00001)throw new Error('BSV-Anteile dürfen höchstens zwei Nachkommastellen haben.');plan.teams[id]={age:t.age,included:t.included,reserveVacancies:t.reserveVacancies,payments:number(t.payments,12,true,true),share,head:number(t.head,10000000,true,true),co:number(t.co,10000000,true,true)};}
 for(const [key,a] of Object.entries(value.assignments)){if(!/^[a-f\d-]{36}:(?:[a-f\d-]{36}|vacant):(?:trainer|co[12]|extra-[1-9][0-9]?)$/i.test(key)||!['unknown','none','valid'].includes(a.license))throw new Error('Bitte die Trainerposition prüfen.');plan.assignments[key]={license:a.license,monthly:number(a.monthly,10000000,true,true),payments:number(a.payments,12,true,true)};}
 return plan;
}
export function compensationReport(roster,plan){
 const people=new Map(roster.people.map(p=>[p.id,p]));const teams=[];const totals={grossMin:0,grossMax:0,monthlyMin:0,monthlyMax:0,seasonMin:0,seasonMax:0,incomplete:0,uncertain:0,positions:0};
 for(const team of roster.teams){const config=plan.teams[team.id];if(!config)continue;const assigned=roster.assignments.filter(a=>a.teamId===team.id&&compensationRole(a,team));const positions=[...assigned];for(const slot of (trainerOnlyTeam(team)?['trainer']:['trainer','co1']))if(!assigned.some(a=>a.slot===slot))positions.push({teamId:team.id,personId:null,slot,websiteRole:slot==='trainer'?'Trainer':'Co-Trainer'});
  const rows=positions.map(a=>{const person=people.get(a.personId),key=compensationKey(a),override=plan.assignments[key]||{license:'unknown',monthly:null,payments:null},role=compensationRole(a,team),vacant=!person,enabled=config.included&&(vacant?config.reserveVacancies:person.active!==false),payments=override.payments??config.payments,issues=[];let min=null,max=null;
   if(override.monthly!==null){min=max=override.monthly;}else if(config.age==='senior'){min=max=role==='trainer'?config.head:config.co;}else{const rate=plan.youthRates[config.age];if(rate){if(role==='co')min=max=rate.co;else{min=override.license==='valid'?rate.licensed:rate.base;max=override.license==='none'?rate.base:rate.licensed;}}}
   if(enabled){if(min===null)issues.push('Monatsbetrag fehlt');if(payments===null)issues.push('Vergütungsmonate fehlen');if(config.share===null)issues.push('BSV-Anteil fehlt');}
   const grossMin=enabled&&min!==null&&payments!==null?min*payments:null,grossMax=enabled&&max!==null&&payments!==null?max*payments:null;
   const monthlyMin=enabled&&min!==null&&config.share!==null?Math.round(min*config.share/100):null,monthlyMax=enabled&&max!==null&&config.share!==null?Math.round(max*config.share/100):null;
   const seasonMin=monthlyMin!==null&&payments!==null?monthlyMin*payments:null,seasonMax=monthlyMax!==null&&payments!==null?monthlyMax*payments:null;
   return {...a,websiteRole:trainerAssignmentRole(team,a),key,role,name:person?.name||'Unbesetzt',qualification:person?.qualification||'',license:override.license,vacant,enabled,issues,rateMin:min,rateMax:max,payments,share:config.share,grossMin,grossMax,monthlyMin,monthlyMax,seasonMin,seasonMax,uncertain:enabled&&min!==null&&max!==null&&min!==max};
  });
  const sum={grossMin:0,grossMax:0,monthlyMin:0,monthlyMax:0,seasonMin:0,seasonMax:0,incomplete:0,uncertain:0,positions:0};
  for(const row of rows.filter(r=>r.enabled)){sum.positions++;if(row.issues.length)sum.incomplete++;if(row.uncertain)sum.uncertain++;for(const key of ['grossMin','grossMax','monthlyMin','monthlyMax','seasonMin','seasonMax'])sum[key]+=row[key]||0;}
  for(const key of Object.keys(totals))totals[key]+=sum[key];teams.push({...team,label:compensationTeamLabel(team),config,rows,totals:sum});
 }
 return {teams,totals};
}
export function compensationCsv(report){
 const amount=n=>n===null?'':(n/100).toFixed(2).replace('.',',');
 const cell=v=>'"'+String(v??'').replace(/^[=+\-@]/,"'$&").replaceAll('"','""')+'"';
 const rows=[['Mannschaft','Person','Funktion','Eingeplant','Lizenz','Vergütungsmonate','BSV-Anteil %','Monatsbetrag min EUR','Monatsbetrag max EUR','BSV Saison min EUR','BSV Saison max EUR','Offene Angaben']];
 for(const t of report.teams)for(const r of t.rows)rows.push([t.label,r.name,r.websiteRole,r.enabled?'Ja':'Nein',r.license,r.payments,r.share,amount(r.rateMin),amount(r.rateMax),amount(r.seasonMin),amount(r.seasonMax),r.issues.join(', ')]);
 return '\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n');
}

export function compensationCategories(team,role){const age=team.compensationAge||compensationAge(team),female=/frauen|juniorinnen|mädchen|damen/i.test((team.slug||'')+' '+(team.name||''));return {department:age==='senior'?'Aktive':age?'Jugend':'Nicht zugeordnet',age:age==='senior'?'Aktive':{bambini:'Bambini',f:'F-Jugend',e:'E-Jugend',d:'D-Jugend',c:'C-Jugend',b:'B-Jugend',a:'A-Jugend'}[age]||'Ohne Altersklasse',gender:female?'Frauen / Mädchen':age||/herren|junioren/i.test((team.slug||'')+' '+(team.name||''))?'Herren / Jungen':'Nicht zugeordnet',roleLabel:role==='co'?'Co-Trainer':'Trainer',cooperation:/\bSG\b|Spielgemeinschaft/i.test(team.name||'')?'Spielgemeinschaft':'BSV-Mannschaft'};}
