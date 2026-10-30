export const BUS_ORIGIN={name:'BSV Nordstern',address:'Schlesierstraße 43, 78315 Radolfzell am Bodensee',coordinates:[8.9700514,47.7543133]};
export const RESOURCE_EVENT_CATEGORIES={training:'Trainerweiterbildung',supporters:'Förderverein',city_event:'Stadtevent / Verkauf',other:'Sonstiges'};
export function resourceBookingLabel(booking){return booking.bookingKind==='event'?booking.event?.title||'Freies Event':booking.teamName||'Mannschaft';}
export function resourceTeamGroup(team){
 const text=[team.slug,team.name,team.website_path].filter(Boolean).join(' ').toLowerCase();
 const age=text.match(/\bu(19|18|17|16|15|14|13|12|11|10|9|8|7|6)\b/)?.[1];
 if(age)return Number(age)>=18?'A':Number(age)>=16?'B':Number(age)>=14?'C':Number(age)>=12?'D':'younger';
 return /(?:alte.herren|\bu35\b)/.test(text)?'other':/herren|frauen|aktive/.test(text)?'senior':'other';
}
export function resourceMatchMinutes(team){return ({D:70,C:85,B:95,A:105,senior:105})[resourceTeamGroup(team)]||105;}
export const RESOURCE_TIMING_DEFAULTS={meetingMinutes:15,changeBeforeMinutes:15,warmupMinutes:45,matchMinutes:105,cooldownMinutes:15,changeAfterMinutes:30,toleranceMinutes:20};
export function resourceCanBookMatch(match,now=Date.now()){
 return Boolean(match?.canBook&&match.isHome===false&&match.status==='scheduled'&&Date.parse(match.kickoffAt)>now);
}
export function resourceTimePlan({kickoffAt,travelMinutes,returnMinutes=travelMinutes,...values}){
 const timing={...RESOURCE_TIMING_DEFAULTS,...Object.fromEntries(Object.keys(RESOURCE_TIMING_DEFAULTS).filter(key=>values[key]!==undefined).map(key=>[key,values[key]])),travelMinutes,returnMinutes},kickoff=Date.parse(kickoffAt);
 if(!Number.isFinite(kickoff)||!Object.values(timing).every(v=>Number.isInteger(v)&&v>=0&&v<=1440)||timing.matchMinutes<1||timing.matchMinutes>360)throw new Error('Bitte Spiel-, Fahr- und Pufferzeiten als ganze Minuten prüfen.');
 const at=minutes=>new Date(kickoff+minutes*60000).toISOString(),arrival=-timing.changeBeforeMinutes-timing.warmupMinutes,departure=arrival-travelMinutes,meeting=departure-timing.meetingMinutes,gameEnd=timing.matchMinutes,changeAfter=gameEnd+timing.cooldownMinutes,returnDeparture=changeAfter+timing.changeAfterMinutes,back=returnDeparture+returnMinutes,end=back+timing.toleranceMinutes;
 const events=[
  ['Treffpunkt beim BSV · Packen',meeting,timing.meetingMinutes],['Abfahrt beim BSV · Hinfahrt',departure,travelMinutes],['Ankunft am Spielort · Umziehen',arrival,timing.changeBeforeMinutes],['Aufwärmen',-timing.warmupMinutes,timing.warmupMinutes],['Anpfiff',0,null],['Voraussichtliches Spielende · Auslaufen / Nachspiel',gameEnd,timing.cooldownMinutes],['Umziehen nach dem Spiel',changeAfter,timing.changeAfterMinutes],['Rückfahrt',returnDeparture,returnMinutes],['Ankunft beim BSV · Toleranz',back,timing.toleranceMinutes],['Bus zurückgeben',end,null],
 ].map(([label,minutes,duration])=>({label,at:at(minutes),duration}));
 return {startsAt:at(meeting),endsAt:at(end),kickoffAt:new Date(kickoff).toISOString(),timing,events};
}
export function resourceTimeSuggestion(input){
 const {startsAt,endsAt}=resourceTimePlan(input);return {startsAt,endsAt};
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
 if(typeof body.resourceId!=='string'||!body.resourceId)throw new Error('Bitte einen Bus auswählen.');
 const bookingKind=body.bookingKind??'match';if(!['match','event'].includes(bookingKind))throw new Error('Ungültige Buchungsart.');
 if(bookingKind==='match'&&(typeof body.teamId!=='string'||!body.teamId))throw new Error('Bitte eine Mannschaft auswählen.');
 if(bookingKind==='match'&&(typeof body.matchId!=='string'||!body.matchId||!Number.isFinite(Date.parse(body.expectedKickoff))))throw new Error('Bitte ein zukünftiges Auswärtsspiel im Kalender auswählen.');
 let event=null;
 if(bookingKind==='event'){
  if(body.matchId||body.teamId)throw new Error('Ein freies Event wird unabhängig von einem Spiel oder einer Mannschaft gebucht.');
  const value=body.event;
  if(!value||!Object.hasOwn(RESOURCE_EVENT_CATEGORIES,value.category))throw new Error('Bitte eine Veranstaltungsart auswählen.');
  event=Object.fromEntries(['title','organizer','contact','category'].map(key=>[key,String(value[key]??'').trim()]));
  if(!event.title||event.title.length>160||!event.contact||event.contact.length>160||event.organizer.length>120)throw new Error('Bitte Anlass und verantwortliche Person angeben (höchstens 160 Zeichen; Gruppe höchstens 120 Zeichen).');
 }
 const note=String(body.note||'').trim();if(note.length>500)throw new Error('Der Hinweis darf höchstens 500 Zeichen enthalten.');
 const planning=bookingKind==='match'&&body.timing?resourceTimePlan({...body.timing,kickoffAt:body.expectedKickoff}):null;
 return {bookingKind,event,resourceId:body.resourceId,teamId:bookingKind==='event'?null:body.teamId,matchId:bookingKind==='event'?null:body.matchId,expectedKickoff:bookingKind==='event'?null:body.expectedKickoff,startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString(),destination:String(body.destination||'').slice(0,400),routeKey:bookingKind==='match'?body.routeKey||null:null,planning,timing:planning?.timing||null,note};
}
