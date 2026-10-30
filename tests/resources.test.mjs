import test from 'node:test';import assert from 'node:assert/strict';import {load} from 'cheerio';
import {resourceTeamGroup,resourceMatchMinutes,resourceTimeSuggestion,resourceOverlap,resourceMonthDays,resourceLocalTime,resourceUtcTime,validateResourceBooking} from '../src/resources.mjs';
import {parseResourceVenue,resourceRoute,handleResources} from '../supabase/functions/_shared/resources.mjs';
test('D through active teams use their actual match durations and travel/45-minute buffers across midnight and DST',()=>{
 for(const [slug,group,minutes] of [['u13-d1-junioren','D',70],['u15-c1-junioren','C',85],['u17-juniorinnen','B',95],['u19-junioren','A',105],['herren-2','senior',105],['frauen-1','senior',105]]){assert.equal(resourceTeamGroup({slug}),group);assert.equal(resourceMatchMinutes({slug}),minutes);}
 assert.equal(resourceTeamGroup({slug:'u11-e1-junioren'}),'younger');assert.equal(resourceTeamGroup({slug:'alte-herren'}),'other');
 const suggestion=resourceTimeSuggestion({kickoffAt:'2026-11-07T13:00:00Z',travelMinutes:30,returnMinutes:35,matchMinutes:70});
 assert.deepEqual(suggestion,{startsAt:'2026-11-07T11:45:00.000Z',endsAt:'2026-11-07T15:30:00.000Z'});
 assert.equal(resourceUtcTime('2026-07-01T12:00'),'2026-07-01T10:00:00.000Z');assert.equal(resourceUtcTime('2026-12-01T12:00'),'2026-12-01T11:00:00.000Z');assert.throws(()=>resourceUtcTime('2027-03-28T02:30'));
 assert.equal(resourceLocalTime('2026-11-07T13:00:00Z'),'2026-11-07T14:00');assert.equal(resourceMonthDays('2026-11').length,42);assert.equal(new Date(resourceMonthDays('2026-11')[0]+'T12:00Z').getUTCDay(),1);
 assert.ok(resourceOverlap({startsAt:'2026-11-01T10:00Z',endsAt:'2026-11-01T12:00Z'},{startsAt:'2026-11-01T11:59Z',endsAt:'2026-11-01T14:00Z'}));
 assert.ok(!resourceOverlap({startsAt:'2026-11-01T10:00Z',endsAt:'2026-11-01T12:00Z'},{startsAt:'2026-11-01T12:00Z',endsAt:'2026-11-01T14:00Z'}));
 assert.throws(()=>validateResourceBooking({teamId:'x',resourceId:'b',startsAt:'2026-11-01',endsAt:'2026-11-10'}));
});
test('venue extraction reads only the actual official location link and decodes the street address',()=>{
 const venue=parseResourceVenue('<nav><a href="https://google.com/">Other</a></nav><a class="location" href="https://www.google.de/maps?q=Sportgel%C3%A4nde+8%2C+78247+Hilzingen">Kunstrasenplatz, Sportgelände 8</a>',load);
 assert.equal(venue.address,'Sportgelände 8, 78247 Hilzingen');assert.equal(parseResourceVenue('<a class="location" href="https://evil.org/maps?q=wrong">Wrong</a>',load),null);
});
test('routes calculate both road legs, never trust browser durations, cache results and authorize before any external request',async()=>{
 const calls=[],cache=new Map();let external=0;
 const db={rpc:async(_name,{payload})=>{calls.push(payload);if(payload.action==='_route_get')return {data:{route:cache.get(payload.key)||null}};if(payload.action==='_route_put')cache.set(payload.key,payload.route);return {data:{ok:true}};}};
 const input={resource:{id:'bus',originAddress:'BSV',coordinates:[8.97,47.75]},query:'Sportgelände 8, Hilzingen',coordinates:[8.78,47.76]};
 const fetcher=async url=>{external++;assert.ok(String(url).includes('8.97,47.75;8.78,47.76;8.97,47.75'));return Response.json({code:'Ok',routes:[{legs:[{distance:23000,duration:1261},{distance:23500,duration:1290}]}]});};
 const result=await resourceRoute(db,'actor',input,{fetcher});assert.equal(result.route.distanceKm,23);assert.equal(result.route.travelMinutes,22);assert.equal(result.route.returnMinutes,22);
 assert.equal((await resourceRoute(db,'actor',input,{fetcher})).route.travelMinutes,22);assert.equal(external,1);assert.equal(calls.filter(c=>c.action==='_provider').length,1);
 const denied={rpc:async()=>({data:{error:'Keine Berechtigung',status:403}})};
 await assert.rejects(()=>handleResources(denied,'other',{action:'resource_route',teamId:'foreign'},{fetcher:()=>{throw Error('must not fetch');}}),/Keine Berechtigung/);
 await assert.rejects(()=>handleResources(db,'actor',{action:'resource__route_put'}),/Unbekannte/);
});
