export const BUS_ORIGIN={name:'BSV Nordstern',address:'Schlesierstraße 43, 78315 Radolfzell am Bodensee',coordinates:[8.9700514,47.7543133]};
export function resourceTeamGroup(team){
 const text=[team.slug,team.name,team.website_path].filter(Boolean).join(' ').toLowerCase();
 const age=text.match(/\bu(19|18|17|16|15|14|13|12|11|10|9|8|7|6)\b/)?.[1];
 if(age)return Number(age)>=18?'A':Number(age)>=16?'B':Number(age)>=14?'C':Number(age)>=12?'D':'younger';
 return /(?:alte.herren|\bu35\b)/.test(text)?'other':/herren|frauen|aktive/.test(text)?'senior':'other';
}
export function resourceMatchMinutes(team){return ({D:70,C:85,B:95,A:105,senior:105})[resourceTeamGroup(team)]||105;}
export function resourceTimeSuggestion({kickoffAt,travelMinutes,returnMinutes=travelMinutes,matchMinutes=105,beforeMinutes=45,afterMinutes=45}){
 const kickoff=Date.parse(kickoffAt);
 if(!Number.isFinite(kickoff)||![travelMinutes,returnMinutes,matchMinutes,beforeMinutes,afterMinutes].every(v=>Number.isFinite(v)&&v>=0&&v<=1440))throw new Error('Bitte Spiel- und Fahrzeiten prüfen.');
 return {startsAt:new Date(kickoff-(travelMinutes+beforeMinutes)*60000).toISOString(),endsAt:new Date(kickoff+(matchMinutes+afterMinutes+returnMinutes)*60000).toISOString()};
}
export function resourceOverlap(a,b){return Date.parse(a.startsAt)<Date.parse(b.endsAt)&&Date.parse(b.startsAt)<Date.parse(a.endsAt);}
export function resourceMonthDays(month){
 if(!/^\d{4}-\d{2}$/.test(month))throw new Error('Ungültiger Monat.');
 const date=new Date(month+'-01T12:00:00Z');if(!Number.isFinite(date.getTime()))throw new Error('Ungültiger Monat.');
 const offset=(date.getUTCDay()+6)%7;date.setUTCDate(1-offset);
 return Array.from({length:42},(_,i)=>new Date(date.getTime()+i*86400000).toISOString().slice(0,10));
}
export function resourceLocalTime(value){return new Date(value).toLocaleString('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(' ','T');}
export function resourceUtcTime(local){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))throw new Error('Bitte Datum und Uhrzeit eingeben.');
 const base=Date.parse(local+'Z');let utc=base;
 for(let i=0;i<3;i++){const rendered=resourceLocalTime(new Date(utc));const delta=Date.parse(rendered+'Z')-base;if(!delta)return new Date(utc).toISOString();utc-=delta;}
 throw new Error('Diese Uhrzeit existiert wegen der Zeitumstellung nicht. Bitte eine andere Uhrzeit wählen.');
}
export function validateResourceBooking(body){
 const startsAt=new Date(body.startsAt),endsAt=new Date(body.endsAt);
 if(!Number.isFinite(startsAt.getTime())||!Number.isFinite(endsAt.getTime())||endsAt<=startsAt||endsAt-startsAt>72*3600000)throw new Error('Bitte einen Zeitraum von höchstens 72 Stunden mit Rückgabe nach Abfahrt eingeben.');
 if(typeof body.teamId!=='string'||!body.teamId||typeof body.resourceId!=='string'||!body.resourceId)throw new Error('Bitte Bus und Mannschaft auswählen.');
 const note=String(body.note||'').trim();if(note.length>500)throw new Error('Der Hinweis darf höchstens 500 Zeichen enthalten.');
 return {resourceId:body.resourceId,teamId:body.teamId,matchId:body.matchId||null,expectedKickoff:body.expectedKickoff||null,startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString(),destination:String(body.destination||'').slice(0,400),routeKey:body.routeKey||null,note};
}
