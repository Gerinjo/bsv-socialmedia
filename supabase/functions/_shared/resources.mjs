import {BUS_ORIGIN,resourceTeamGroup,resourceMatchMinutes,validateResourceBooking} from '../../../src/resources.mjs';
import {discoverSportsWidget} from '../../../src/editorial-sports.mjs';
import {extractWidgetPageProps,parseNextMatches} from './fussball-de-widget-parser.mjs';
import {refereeYouthSources} from '../../../src/referee-source.mjs';
export async function resourceRpc(db,actor,payload){
 const {data,error}=await db.rpc('resource_request',{actor,payload});
 if(error)throw new Error('Ressourcen konnten nicht geladen oder gespeichert werden.');
 if(!data||data.error)throw Object.assign(new Error(data?.error||'Ressourcen sind vorübergehend nicht verfügbar.'),{status:data?.status||503});return data;
}
export function parseResourceVenue(html,load){
 const $=load(html);let result=null;
 $('a.location[href]').each((_index,element)=>{
  try{const url=new URL($(element).attr('href'));if(!['www.google.de','www.google.com','maps.google.com'].includes(url.hostname))return;const address=url.searchParams.get('q');if(address&&!/^[-\d., ]+$/.test(address))result={address:address.trim(),label:$(element).text().replace(/\s+/g,' ').trim()};}catch{}
 });return result;
}
export async function readResourceSource(value,fetcher=fetch){
 let url=new URL(value);const signal=AbortSignal.timeout(12000);
 for(let i=0;i<4;i++){
  if(url.protocol!=='https:'||url.username||url.password||url.port||!['bsvnordstern.de','www.fussball.de','next.fussball.de'].includes(url.hostname))throw new Error('Ungültige Spielplanquelle.');
  const response=await fetcher(url,{redirect:'manual',signal,headers:{referer:'https://bsvnordstern.de/'}});
  if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();if(!next)throw new Error('Ungültige Weiterleitung.');url=new URL(next,url);continue;}
  if(!response.ok)throw new Error(`Spielplan nicht erreichbar (HTTP ${response.status}).`);return response;
 }throw new Error('Zu viele Spielplanweiterleitungen.');
}
export async function syncResourceMatches(db,actor,{parseFont,fetcher=fetch}={}){
 await resourceRpc(db,actor,{action:'_provider',provider:'sync'});
 const {teams}=await resourceRpc(db,actor,{action:'_teams'});const selected=teams.filter(team=>['A','B','C','D','senior'].includes(resourceTeamGroup(team)));
 const warnings=[],fetched=[];let index=0;
 const worker=async()=>{while(index<selected.length){const team=selected[index++];try{
  const known=refereeYouthSources.find(row=>row[0]===team.website_path);let widget=known?.[1]||team.fussball_de_widget_id;
  if(!widget&&team.website_path){const page=new URL(team.website_path.replace(/^\//,''),'https://bsvnordstern.de/');const html=await(await readResourceSource(page,fetcher)).text();widget=discoverSportsWidget(html,'team-matches');}
  if(!widget||!/^[a-f\d-]{36}$/i.test(widget))throw new Error('Kein Spielplan hinterlegt.');
  const props=extractWidgetPageProps(await(await readResourceSource(`https://next.fussball.de/widget/team-matches/${widget}`,fetcher)).text());
  const font=props.obfuscatedFont?parseFont(await(await readResourceSource(`https://www.fussball.de/export.fontface/-/format/ttf/id/${encodeURIComponent(props.obfuscatedFont)}/type/font`,fetcher)).arrayBuffer()):null;
  const raw=[...(props.previousMatches||[]),...props.nextMatches].filter(match=>!match.prePublished&&!match.notAllocated&&match.kickoff?.time);
  const parsed=parseNextMatches({...props,nextMatches:raw},character=>font?.charToGlyph(character)?.name);
  const permanent=known?.[2]||team.fussball_de_team_id;
  const matches=parsed.filter(match=>!permanent||[match.homeTeam.teamPermanentId,match.awayTeam.teamPermanentId].includes(permanent)).filter(match=>!/spielfrei|freilos/i.test(match.homeTeam.name+' '+match.awayTeam.name)).map(match=>({id:team.id+':'+match.sourceMatchId,teamId:team.id,sourceMatchId:match.sourceMatchId,kickoffAt:match.kickoffAt,home:match.homeTeam.name,away:match.awayTeam.name,isHome:permanent?match.homeTeam.teamPermanentId===permanent:match.homeTeam.name===team.name,status:match.status,matchMinutes:resourceMatchMinutes(team),sourceUrl:`https://www.fussball.de/spiel/-/spiel/${match.sourceMatchId}`}));
  if(matches.length)await resourceRpc(db,actor,{action:'_sync',matches});fetched.push({team:team.name,count:matches.length});await resourceRpc(db,actor,{action:'_sync_state',teamId:team.id});
 }catch(error){warnings.push(team.name+': '+error.message);await resourceRpc(db,actor,{action:'_sync_state',teamId:team.id,error:error.message});}}};
 await Promise.all([worker(),worker(),worker()]);return {fetched,warnings};
}
export async function resourceRoute(db,actor,{resource,query,coordinates},{fetcher=fetch,geocoder='https://photon.komoot.io/api/',router='https://routing.openstreetmap.de/routed-car/route/v1/driving/'}={}){
 query=String(query||'').trim();if(query.length<4||query.length>400)throw new Error('Bitte den Spielort mit Straße und Ort eingeben.');
 if(coordinates&&(!Array.isArray(coordinates)||coordinates.length!==2||!coordinates.every(Number.isFinite)||Math.abs(coordinates[0])>180||Math.abs(coordinates[1])>90))throw new Error('Ungültige Spielortkoordinaten.');
 const key=[resource.id,...resource.coordinates,query.toLocaleLowerCase('de'),...(coordinates||[])].join('|');
 const cached=await resourceRpc(db,actor,{action:'_route_get',key});if(cached.route)return cached.route.candidates?{candidates:cached.route.candidates}:{route:{...cached.route,key}};
 const headers={'user-agent':'BSV-Club-Suite/1.0 (+https://bsvnordstern.de; info@bsvnordstern.de)'};
 if(!coordinates){
  await resourceRpc(db,actor,{action:'_provider',provider:'geocoding'});
  const url=new URL(geocoder);url.search=new URLSearchParams({q:query,limit:'3',lang:'de',lat:String(resource.coordinates[1]),lon:String(resource.coordinates[0])}).toString();
  const response=await fetcher(url,{headers,signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('Die Spielortsuche ist vorübergehend nicht verfügbar.');
  const result=await response.json();const candidates=(result.features||[]).filter(feature=>feature.geometry?.type==='Point').map(feature=>({coordinates:feature.geometry.coordinates,label:[feature.properties.name,[feature.properties.street,feature.properties.housenumber].filter(Boolean).join(' '),[feature.properties.postcode,feature.properties.city||feature.properties.town||feature.properties.village].filter(Boolean).join(' '),feature.properties.country].filter(Boolean).join(', ')}));
  if(!candidates.length)throw new Error('Spielort nicht gefunden. Bitte eine genauere Adresse eingeben.');
  await resourceRpc(db,actor,{action:'_route_put',key,route:{candidates}});return {candidates};
 }
 await resourceRpc(db,actor,{action:'_provider',provider:'routing'});
 const routeUrl=new URL(router+`${resource.coordinates.join(',')};${coordinates.join(',')};${resource.coordinates.join(',')}`);routeUrl.search='overview=false&steps=false&generate_hints=false';
 const response=await fetcher(routeUrl,{headers,signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Die Routenberechnung ist vorübergehend nicht verfügbar.');
 const result=await response.json(),legs=result.routes?.[0]?.legs;
 if(result.code!=='Ok'||!legs||legs.length!==2||legs.some(leg=>!Number.isFinite(leg.duration)||leg.duration<0||!Number.isFinite(leg.distance)))throw new Error('Für diesen Spielort konnte keine Straßenroute berechnet werden.');
 const route={key,destination:query,coordinates,originAddress:resource.originAddress,origin:resource.coordinates,distanceKm:Math.round(legs[0].distance/100)/10,travelMinutes:Math.ceil(legs[0].duration/60),returnMinutes:Math.ceil(legs[1].duration/60),provider:'OSRM / FOSSGIS · OpenStreetMap',calculatedAt:new Date().toISOString()};
 await resourceRpc(db,actor,{action:'_route_put',key,route});return {route};
}
export async function handleResources(db,actor,body,{parseFont,load,fetcher=fetch,geocoder,router}={}){
 const action=String(body.action||'').replace(/^resource_/,'');if(!['list','sync','match','route','book','cancel'].includes(action))throw new Error('Unbekannte Ressourcen-Aktion.');
 await resourceRpc(db,actor,{action:'authorize',...(['route','book'].includes(action)?{teamId:body.teamId}:{})});
 if(action==='list'){if(body.month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month))throw new Error('Ungültiger Kalendermonat.');return resourceRpc(db,actor,{action,month:body.month});}
 if(action==='sync')return syncResourceMatches(db,actor,{parseFont,fetcher});
 if(action==='book'){
  const booking=validateResourceBooking(body);
  const {match}=await resourceRpc(db,actor,{action:'_match',matchId:booking.matchId});
  if(match.is_home!==false)throw Object.assign(new Error('Für Heimspiele ist der Bus nicht reservierbar.'),{status:409});
  return resourceRpc(db,actor,{action,...booking});
 }
 if(action==='cancel')return resourceRpc(db,actor,{action,resourceId:body.resourceId,bookingId:body.bookingId});
 if(action==='match'){
  const {match}=await resourceRpc(db,actor,{action:'_match',matchId:body.matchId});let venue=match.venue;
  if(match.is_home!==false)throw Object.assign(new Error('Für Heimspiele ist der Bus nicht reservierbar.'),{status:409});
  if(!venue){try{const result=parseResourceVenue(await(await readResourceSource(match.source_url,fetcher)).text(),load);venue=result?.address;if(venue)await resourceRpc(db,actor,{action:'_venue',matchId:match.id,venue});}catch{}}
  return {match:{...match,venue:venue||''},warning:venue?'':'Spieladresse konnte nicht gelesen werden. Bitte den tatsächlichen Spielort eingeben.'};
 }
 const data=await resourceRpc(db,actor,{action:'list'}),resource=data.resources.find(resource=>resource.id===body.resourceId);if(!resource)throw new Error('Bus nicht verfügbar.');
 return resourceRoute(db,actor,{resource,query:body.destination,coordinates:body.coordinates},{fetcher,geocoder,router});
}
