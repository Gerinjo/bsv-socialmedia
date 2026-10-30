import {previewSuiteProfile} from '/preview-suite-users.mjs';
import {resourceOverlap,validateResourceBooking} from '/resources-model.mjs';
const key='bsv-resource-preview-v2';
const teams=[{id:'demo-resource-c1',name:'U15 C1-Junioren',slug:'u15-c1-junioren'},{id:'demo-resource-d1',name:'U13 D1-Junioren',slug:'u13-d1-junioren'},{id:'demo-resource-h1',name:'1. Herren',slug:'herren-1'},{id:'demo-resource-e1',name:'U11 E1-Junioren',slug:'u11-e1-junioren'}];
function initial(){const date=new Date();date.setDate(date.getDate()+2);date.setHours(16,0,0,0);return {bookings:[],lastSync:new Date().toISOString(),matches:[{id:'demo-resource-match-c1',teamId:teams[0].id,kickoffAt:date.toISOString(),home:'FC Beispiel',away:'BSV Nordstern',isHome:false,status:'scheduled',venue:'Sportstraße 12, 78315 Radolfzell',matchMinutes:85},{id:'demo-resource-match-h1',teamId:teams[2].id,kickoffAt:new Date(date.getTime()+7200000).toISOString(),home:'SC Beispiel',away:'BSV Nordstern',isHome:false,status:'scheduled',venue:'Schlesierstraße 43, Radolfzell',matchMinutes:105},{id:'demo-resource-match-d1-home',teamId:teams[1].id,kickoffAt:new Date(date.getTime()+3600000).toISOString(),home:'BSV Nordstern',away:'FC Beispiel',isHome:true,status:'scheduled',matchMinutes:70}]};}
export async function resourcePreviewApi(body,persona){
 const user=previewSuiteProfile(persona),admin=user.role==='admin';if(!user.accessAreas.includes('resources'))throw new Error('Keine Berechtigung für Ressourcen.');
 const state=JSON.parse(localStorage.getItem(key)||'null')||initial(),own=admin?teams.map(t=>t.id):persona==='mustm'?teams.filter(t=>t.slug!=='herren-1').map(t=>t.id):[];
 const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};const action=body.action.replace(/^resource_/,'');
 const resource={id:'demo-bus',name:'Vereinsbus',originAddress:'Schlesierstraße 43, 78315 Radolfzell am Bodensee',coordinates:[8.9700514,47.7543133]};
 if(action==='list')return {admin,teams:teams.map(t=>({...t,canBook:own.includes(t.id)})),resources:[resource],matches:state.matches.map(match=>({...match,canBook:own.includes(match.teamId)&&!match.isHome})),bookings:state.bookings.filter(b=>!b.cancelled).map(b=>({...b,canManage:admin||own.includes(b.teamId)})),lastSync:state.lastSync};
 if(action==='sync'){state.lastSync=new Date().toISOString();localStorage.setItem(key,JSON.stringify(state));return {fetched:teams.slice(0,3).map(t=>({team:t.name,count:1})),warnings:[]};}
 if(action==='match'){const match=state.matches.find(m=>m.id===body.matchId);if(!match||!own.includes(match.teamId))fail('Nur eigene Mannschaften.',403);if(match.isHome)fail('Für Heimspiele ist der Bus nicht reservierbar.');return {match:{...match,venue:match.venue},warning:''};}
 if(action==='route'){
  if(!own.includes(body.teamId))fail('Nur eigene Mannschaften.',403);
  if(!body.coordinates)return {candidates:[{label:'Sportstraße 12, 78315 Radolfzell (Beispielort)',coordinates:[8.8,47.8]}]};
  return {route:{key:'demo-route',destination:body.destination,coordinates:body.coordinates,distanceKm:28.4,travelMinutes:35,returnMinutes:38,provider:'Lokales Routenbeispiel',calculatedAt:new Date().toISOString()}};
 }
 if(action==='book'){
  if(!own.includes(body.teamId))fail('Nur eigene Mannschaften.',403);
  const match=state.matches.find(m=>m.id===body.matchId);if(!match||match.teamId!==body.teamId||match.isHome)fail('Bitte ein zukünftiges Auswärtsspiel auswählen.');
  body={...body,...validateResourceBooking(body)};
  if(state.bookings.some(b=>!b.cancelled&&resourceOverlap(b,body)))fail('Der Bus ist in diesem Zeitraum bereits reserviert.');
  state.bookings.push({...body,id:crypto.randomUUID(),teamName:teams.find(t=>t.id===body.teamId).name,matchKickoff:body.expectedKickoff,trainerName:user.name});
 }else if(action==='cancel'){
  const booking=state.bookings.find(b=>b.id===body.bookingId);if(!booking||!own.includes(booking.teamId))fail('Keine Berechtigung.',403);booking.cancelled=true;
 }else fail('Unbekannte Ressourcen-Aktion.',400);
 localStorage.setItem(key,JSON.stringify(state));return {ok:true};
}
