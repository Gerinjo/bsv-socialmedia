import test from 'node:test';import assert from 'node:assert/strict';import {load} from 'cheerio';
import {resourceTeamGroup,resourceMatchMinutes,resourceTimeSuggestion,resourceTimePlan,resourceTimeRounding,resourceCanBookMatch,resourceBookingLabel,resourceBookingConflicts,resourceCalendarMatches,resourceCalendarBookings,resourceDayOccupancy,validateResourceTimeChange,resourceOverlap,resourceMonthDays,resourceLocalTime,resourceUtcTime,validateResourceBooking} from '../src/resources.mjs';
import {parseResourceVenue,resourceRoute,handleResources} from '../supabase/functions/_shared/resources.mjs';
test('D through active teams use match durations and the detailed arrival and return buffers across midnight and DST',()=>{
 for(const [slug,group,minutes] of [['u13-d1-junioren','D',70],['u15-c1-junioren','C',85],['u17-juniorinnen','B',95],['u19-junioren','A',105],['herren-2','senior',105],['frauen-1','senior',105]]){assert.equal(resourceTeamGroup({slug}),group);assert.equal(resourceMatchMinutes({slug}),minutes);}
 assert.equal(resourceTeamGroup({slug:'u11-e1-junioren'}),'younger');assert.equal(resourceTeamGroup({slug:'alte-herren'}),'other');
 const suggestion=resourceTimeSuggestion({kickoffAt:'2026-11-07T13:00:00Z',travelMinutes:30,returnMinutes:35,matchMinutes:70});
 assert.deepEqual(suggestion,{startsAt:'2026-11-07T11:15:00.000Z',endsAt:'2026-11-07T16:00:00.000Z'});
 assert.equal(resourceUtcTime('2026-07-01T12:00'),'2026-07-01T10:00:00.000Z');assert.equal(resourceUtcTime('2026-12-01T12:00'),'2026-12-01T11:00:00.000Z');assert.throws(()=>resourceUtcTime('2027-03-28T02:30'));
 assert.equal(resourceLocalTime('2026-11-07T13:00:00Z'),'2026-11-07T14:00');assert.equal(resourceMonthDays('2026-11').length,42);assert.equal(new Date(resourceMonthDays('2026-11')[0]+'T12:00Z').getUTCDay(),1);
 assert.ok(resourceOverlap({startsAt:'2026-11-01T10:00Z',endsAt:'2026-11-01T12:00Z'},{startsAt:'2026-11-01T11:59Z',endsAt:'2026-11-01T14:00Z'}));
 assert.ok(!resourceOverlap({startsAt:'2026-11-01T10:00Z',endsAt:'2026-11-01T12:00Z'},{startsAt:'2026-11-01T12:00Z',endsAt:'2026-11-01T14:00Z'}));
 assert.throws(()=>validateResourceBooking({teamId:'x',resourceId:'b',startsAt:'2026-11-01',endsAt:'2026-11-10'}));
});
test('16:00 Konstanz example reserves until 19:30 while retaining the calculated 19:20 return deadline',()=>{
 const plan=resourceTimePlan({kickoffAt:'2026-11-07T15:00:00Z',travelMinutes:30,matchMinutes:105});
 assert.equal(resourceLocalTime(plan.startsAt),'2026-11-07T14:15');assert.equal(resourceLocalTime(plan.endsAt),'2026-11-07T19:30');
 assert.equal(resourceLocalTime(plan.rounding.endsAt.calculatedAt),'2026-11-07T19:20');
 assert.deepEqual(plan.events.map(e=>resourceLocalTime(e.at).slice(11)),['14:15','14:30','15:00','15:15','16:00','17:45','18:00','18:30','19:00','19:20']);
 assert.equal(resourceLocalTime(resourceTimePlan({kickoffAt:plan.kickoffAt,travelMinutes:30,returnMinutes:40,matchMinutes:70}).endsAt),'2026-11-07T19:00');
 assert.throws(()=>resourceTimePlan({kickoffAt:plan.kickoffAt,travelMinutes:-1}));assert.throws(()=>resourceTimePlan({kickoffAt:plan.kickoffAt,travelMinutes:30,matchMinutes:0}));
 const match={canBook:true,isHome:false,status:'scheduled',kickoffAt:'2027-01-01T15:00:00Z'};assert.ok(resourceCanBookMatch(match,0));
 for(const change of [{isHome:true},{isHome:undefined},{canBook:false},{status:'cancelled'},{kickoffAt:'1970-01-01T00:00:00Z'}])assert.equal(resourceCanBookMatch({...match,...change},1),false);
 const booking={teamId:'team',resourceId:'bus',matchId:'away',expectedKickoff:plan.kickoffAt,startsAt:plan.startsAt,endsAt:plan.endsAt,timing:plan.timing};
 assert.deepEqual(validateResourceBooking(booking).planning,plan);assert.throws(()=>validateResourceBooking({...booking,matchId:null}));
});
test('quarter-hour rounding expands the period only inside the ten-minute catch window, including its exact limit',()=>{
 const iso=value=>`2027-01-01T${value}Z`;
 assert.deepEqual(resourceTimeRounding(iso('14:25:00'),'start'),{calculatedAt:iso('14:25:00.000'),earliestAt:iso('14:15:00.000'),latestAt:iso('14:25:00.000'),suggestedAt:iso('14:15:00.000')});
 assert.equal(resourceTimeRounding(iso('14:25:01'),'start').suggestedAt,iso('14:25:01.000'));
 assert.deepEqual(resourceTimeRounding(iso('19:20:00'),'end'),{calculatedAt:iso('19:20:00.000'),earliestAt:iso('19:20:00.000'),latestAt:iso('19:30:00.000'),suggestedAt:iso('19:30:00.000')});
 assert.equal(resourceTimeRounding(iso('19:19:59'),'end').suggestedAt,iso('19:19:59.000'));
 for(const boundary of ['start','end'])assert.equal(resourceTimeRounding(iso('14:15:00'),boundary).suggestedAt,iso('14:15:00.000'));
 assert.throws(()=>resourceTimeRounding('invalid','start'));assert.throws(()=>resourceTimeRounding(iso('14:15:00'),'nearest'));
});
test('rounding preserves every calculated minute and handles midnight and Berlin daylight-saving transitions',()=>{
 assert.equal(resourceTimeRounding('2027-01-01T23:56:00Z','end').suggestedAt,'2027-01-02T00:00:00.000Z');
 assert.equal(resourceTimeRounding('2027-01-02T00:04:00Z','start').suggestedAt,'2027-01-02T00:00:00.000Z');
 for(const kickoffAt of ['2027-03-28T01:00:00Z','2027-10-31T01:00:00Z'])for(let travelMinutes=0;travelMinutes<60;travelMinutes++){
  const plan=resourceTimePlan({kickoffAt,travelMinutes});
  for(const [key,direction] of [['startsAt',-1],['endsAt',1]]){
   const raw=Date.parse(plan.rounding[key].calculatedAt),selected=Date.parse(plan[key]),difference=(selected-raw)*direction;
   assert.ok(difference>=0&&difference<=10*60000);
   assert.ok(selected===raw||new Date(selected).getUTCMinutes()%15===0);
   assert.equal(resourceUtcTime(resourceLocalTime(selected)),new Date(selected).toISOString());
  }
 }
});
test('the rounded reservation blocks its additional buffer while explicit user times and free events remain exact',()=>{
 const plan=resourceTimePlan({kickoffAt:'2026-11-07T15:00Z',travelMinutes:30});
 const occupied={id:'next',resourceId:'bus',startsAt:'2026-11-07T18:25Z',endsAt:'2026-11-07T19:00Z'};
 assert.equal(resourceBookingConflicts([occupied],{...plan,resourceId:'bus'})[0].overlap.minutes,5);
 assert.deepEqual(resourceBookingConflicts([{...occupied,startsAt:plan.endsAt}],{...plan,resourceId:'bus'}),[]);
 const body={resourceId:'bus',teamId:'team',matchId:'away',expectedKickoff:plan.kickoffAt,startsAt:'2026-11-07T13:17Z',endsAt:'2026-11-07T18:24Z',timing:plan.timing};
 const saved=validateResourceBooking(body);assert.equal(saved.startsAt,'2026-11-07T13:17:00.000Z');assert.equal(saved.endsAt,'2026-11-07T18:24:00.000Z');assert.deepEqual(saved.planning,plan);
 const event=validateResourceBooking({...body,bookingKind:'event',teamId:null,matchId:null,timing:undefined,event:{title:'Fortbildung',category:'training',organizer:'Trainerteam',contact:'Kontakt'}});
 assert.equal(event.startsAt,saved.startsAt);assert.equal(event.endsAt,saved.endsAt);assert.equal(event.planning,null);
});
test('home games are rejected before venue fetching and before booking reaches the mutation RPC',async()=>{
 const actions=[];const db={rpc:async(_,{payload})=>{actions.push(payload.action);return {data:payload.action==='_match'?{match:{is_home:true}}:{ok:true}};}};
 const options={fetcher:()=>{throw Error('must not fetch');}};
 await assert.rejects(()=>handleResources(db,'actor',{action:'resource_match',matchId:'home'},options),/Heimspiele/);
 await assert.rejects(()=>handleResources(db,'actor',{action:'resource_book',matchId:'home',teamId:'team',resourceId:'bus',expectedKickoff:'2027-01-01T15:00:00Z',startsAt:'2027-01-01T13:00:00Z',endsAt:'2027-01-01T19:00:00Z'},options),/Heimspiele/);
 assert.ok(!actions.includes('book'));
});
test('bus calendar contains only away games and time changes preserve the originally loaded booking period',async()=>{
 const matches=[{id:'home',isHome:true,teamId:'A'},{id:'away',isHome:false,teamId:'A'},{id:'other',isHome:false,teamId:'B'},{id:'unknown',teamId:'A'}];
 assert.deepEqual(resourceCalendarMatches(matches).map(m=>m.id),['away','other']);assert.deepEqual(resourceCalendarMatches(matches,'A').map(m=>m.id),['away']);
 const body={resourceId:'bus',bookingId:'booking',startsAt:'2027-01-01T12:00Z',endsAt:'2027-01-01T20:00Z',expectedStartsAt:'2027-01-01T13:00Z',expectedEndsAt:'2027-01-01T19:00Z'};
 const normalized=validateResourceTimeChange(body);assert.equal(normalized.startsAt,'2027-01-01T12:00:00.000Z');assert.equal(normalized.expectedStartsAt,'2027-01-01T13:00:00.000Z');
 for(const values of [{expectedStartsAt:null},{startsAt:'invalid'},{endsAt:body.startsAt},{endsAt:'2027-01-10T00:00Z'}])assert.throws(()=>validateResourceTimeChange({...body,...values}));
 const calls=[];const db={rpc:async(_,{payload})=>{calls.push(payload);return {data:{ok:true}};}};
 await handleResources(db,'actor',{action:'resource_reschedule',...body});assert.deepEqual(calls.map(p=>p.action),['authorize','reschedule']);assert.equal(calls[1].expectedEndsAt,normalized.expectedEndsAt);
});
test('conflict comparison uses a shared proportional axis and exact critical intervals, excluding self, cancelled and other-resource bookings',()=>{
 const planned={resourceId:'bus',startsAt:'2027-01-01T12:00Z',endsAt:'2027-01-01T20:00Z'},booking={id:'occupied',resourceId:'bus',teamName:'D1',startsAt:'2027-01-01T14:00Z',endsAt:'2027-01-01T18:00Z'};
 const [conflict]=resourceBookingConflicts([booking],planned);assert.equal(conflict.label,'D1');assert.equal(conflict.occupied.startPercent,25);assert.equal(conflict.occupied.endPercent,75);assert.equal(conflict.planned.startPercent,0);assert.equal(conflict.planned.endPercent,100);assert.equal(conflict.overlap.minutes,240);assert.equal(conflict.overlap.startsAt,'2027-01-01T14:00:00.000Z');
 assert.deepEqual(resourceBookingConflicts([booking],planned,booking.id),[]);assert.deepEqual(resourceBookingConflicts([{...booking,cancelled:true},{...booking,resourceId:'other'}],planned),[]);assert.deepEqual(resourceBookingConflicts([booking],{...planned,startsAt:booking.endsAt}),[]);assert.deepEqual(resourceBookingConflicts([booking],{...planned,endsAt:'invalid'}),[]);
 const night={resourceId:'bus',startsAt:'2027-01-01T23:00Z',endsAt:'2027-01-02T02:00Z'},occupied={...booking,startsAt:'2027-01-02T00:00Z',endsAt:'2027-01-02T01:00Z'};
 assert.equal(resourceBookingConflicts([occupied],night)[0].overlap.minutes,60);
 const next={...booking,id:'next',startsAt:'2027-01-01T19:00Z',endsAt:'2027-01-01T21:00Z'};assert.deepEqual(resourceBookingConflicts([next,booking],planned).map(c=>c.id),['occupied','next']);
});
test('personal and team filters remove duplicate match cards while all reservations block their actual daily intervals',()=>{
 const teams=[{id:'A',isOwn:true,canBook:true},{id:'B',isOwn:false,canBook:true}],matches=[{id:'a',teamId:'A',isHome:false},{id:'b',teamId:'B',isHome:false}];
 const booking={id:'bus-b',bookingKind:'match',matchId:'b',teamId:'B',teamName:'Team B',startsAt:'2026-11-01T12:00Z',endsAt:'2026-11-01T17:00Z'},event={...booking,id:'event',bookingKind:'event',teamId:null,matchId:null,event:{title:'Stadtfest'}};
 assert.deepEqual(resourceCalendarMatches(matches,'__own__',teams).map(m=>m.id),['a']);
 assert.deepEqual(resourceCalendarMatches(matches,'',teams,[booking]).map(m=>m.id),['a']);assert.deepEqual(resourceCalendarMatches(matches,'B',teams,[booking]),[]);
 assert.deepEqual(resourceCalendarBookings([booking,event],'__own__',teams).map(b=>b.id),['event']);assert.deepEqual(resourceCalendarBookings([booking],'B',teams).map(b=>b.id),['bus-b']);
 const occupied=resourceDayOccupancy([booking],'2026-11-01');assert.equal(occupied.length,1);assert.equal(occupied[0].startLabel,'13:00');assert.equal(occupied[0].endLabel,'18:00');assert.equal(occupied[0].heightPercent,100*5/24);
 assert.deepEqual(resourceCalendarMatches(matches,'B',teams,[{...booking,cancelledAt:'2026-10-30T00:00Z'}]).map(m=>m.id),['b']);assert.deepEqual(resourceDayOccupancy([{...booking,cancelledAt:'2026-10-30T00:00Z'}],'2026-11-01'),[]);
 const night={...booking,startsAt:'2026-10-24T21:00Z',endsAt:'2026-10-25T04:00Z'};
 assert.equal(resourceDayOccupancy([night],'2026-10-24')[0].endLabel,'24:00');const dst=resourceDayOccupancy([night],'2026-10-25')[0];assert.equal(dst.startLabel,'00:00');assert.equal(dst.endLabel,'05:00');assert.equal(dst.heightPercent,24); // Six real hours on a 25-hour day.
 assert.equal(resourceDayOccupancy([{...booking,startsAt:'2026-10-31T23:00Z',endsAt:'2026-11-01T23:00Z'}],'2026-11-01')[0].heightPercent,100);
});
test('free club events need a title and responsible person, work without a team and cannot masquerade as match bookings',async()=>{
 const input={bookingKind:'event',resourceId:'bus',startsAt:'2027-01-01T08:00Z',endsAt:'2027-01-01T18:00Z',event:{title:' Stadtfest – Getränkestand ',category:'city_event',organizer:'Förderverein',contact:'Erika Muster'}};
 const event=validateResourceBooking(input);assert.equal(event.teamId,null);assert.equal(event.matchId,null);assert.equal(event.planning,null);assert.equal(event.event.title,'Stadtfest – Getränkestand');assert.equal(resourceBookingLabel(event),'Stadtfest – Getränkestand');
 for(const changed of [{event:{...input.event,title:''}},{event:{...input.event,contact:''}},{event:{...input.event,category:'__proto__'}},{teamId:'foreign'},{matchId:'home'},{bookingKind:'bogus'}])assert.throws(()=>validateResourceBooking({...input,...changed}));
 const calls=[];const db={rpc:async(_,{payload})=>{calls.push(payload);return {data:{ok:true}};}};
 await handleResources(db,'actor',{action:'resource_book',...input});assert.deepEqual(calls.map(p=>p.action),['authorize','book']);assert.ok(!Object.hasOwn(calls[0],'teamId'));assert.equal(calls[1].bookingKind,'event');
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
