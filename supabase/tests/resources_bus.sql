begin;
set local role service_role;
do $$
declare actor uuid:=gen_random_uuid();other uuid:=gen_random_uuid();person uuid:=gen_random_uuid();team uuid:=gen_random_uuid();other_team uuid:=gen_random_uuid();bus uuid;result jsonb;book uuid;event_book uuid;event_payload jsonb;start_value timestamptz:=now()+interval '10 days';
begin
 insert into public.social_admins(user_id,role,is_active,is_blocked,person_id,first_name,last_name,username,access_areas) values(actor,'sm-team',true,false,person,'Trainer','Test','test',array['resources']), (other,'sm-team',true,false,null,'Andere','Person','andere',array['resources']);
 insert into private.trainer_profiles(person_id,active) values(person,true);
 insert into public.social_teams(id,name,slug,trainer_managed) values(team,'D1','u13-d1-junioren',true),(other_team,'C1','u15-c1-junioren',true);
 insert into public.social_team_people(team_id,person_id,staff_slot) values(team,person,'trainer');
 select id into bus from private.club_resources where slug='bus';
 result:=public.resource_request(actor,jsonb_build_object('action','_sync','matches',jsonb_build_array(jsonb_build_object('id','test-match','teamId',team,'sourceMatchId','test','kickoffAt',start_value,'home','BSV','away','Test','status','scheduled','isHome',false,'sourceUrl','https://example.org','matchMinutes',70))));
 if result->>'ok' is distinct from 'true' then raise exception 'ASSERT: schedule import failed';end if;
 insert into private.resource_matches select 'test-home',team_id,'home',kickoff_at,home_team,away_team,status,true,venue,source_url,match_minutes,fetched_at from private.resource_matches where id='test-match';
 insert into private.resource_matches select 'test-adjacent',team_id,'adjacent',kickoff_at+interval '4 hours',home_team,away_team,status,false,venue,source_url,match_minutes,fetched_at from private.resource_matches where id='test-match';
 result:=public.resource_request(actor,jsonb_build_object('action','_match','matchId','test-home'));if result->>'status' is distinct from '409' then raise exception 'ASSERT: home venue lookup allowed';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','book','resourceId',bus,'teamId',team,'matchId','test-home','expectedKickoff',start_value,'startsAt',start_value-interval '1 hour','endsAt',start_value+interval '4 hours'));if result->>'status' is distinct from '409' then raise exception 'ASSERT: home booking accepted';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','book','resourceId',bus,'teamId',team,'startsAt',start_value,'endsAt',start_value+interval '4 hours'));if result->>'status' is distinct from '400' then raise exception 'ASSERT: missing game accepted';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','list','month',to_char(start_value at time zone 'Europe/Berlin','YYYY-MM')));
 if jsonb_array_length(result->'matches')<>3 or jsonb_array_length(result->'resources')<>1 then raise exception 'ASSERT: calendar incomplete: %',result;end if;
 result:=public.resource_request(actor,jsonb_build_object('action','book','resourceId',bus,'teamId',team,'matchId','test-match','expectedKickoff',start_value+interval '1 hour','startsAt',start_value-interval '1 hour','endsAt',start_value+interval '4 hours'));
 if result->>'status' is distinct from '409' then raise exception 'ASSERT: changed kickoff accepted';end if;


 -- A resource-area member with no team can reserve an independent club event.
 event_payload:=jsonb_build_object('action','book','bookingKind','event','resourceId',bus,'startsAt',start_value-interval '1 hour','endsAt',start_value+interval '1 hour','event',jsonb_build_object('title','Stadtfest – Getränkestand','category','city_event','organizer','Förderverein','contact','Erika Muster'));
 result:=public.resource_request(other,event_payload);
 if result->>'ok' is distinct from 'true' then raise exception 'ASSERT: unassigned member event failed: %',result;end if;event_book:=(result->>'bookingId')::uuid;
 if not exists(select 1 from private.resource_bookings where id=event_book and team_id is null and match_id is null and booking_kind='event' and event->>'organizer'='Förderverein') then raise exception 'ASSERT: free event details lost';end if;
 result:=public.resource_request(other,jsonb_build_object('action','list','month',to_char(start_value at time zone 'Europe/Berlin','YYYY-MM')));
 if not exists(select 1 from jsonb_array_elements(result->'bookings') b where b->>'id'=event_book::text and (b->>'canManage')::boolean and b->>'bookingKind'='event') then raise exception 'ASSERT: free event omitted from calendar';end if;
 result:=public.resource_request(actor,event_payload);if result->>'status' is distinct from '409' then raise exception 'ASSERT: event overlap accepted';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','book','resourceId',bus,'teamId',team,'matchId','test-match','expectedKickoff',start_value,'startsAt',start_value,'endsAt',start_value+interval '4 hours'));if result->>'status' is distinct from '409' then raise exception 'ASSERT: match overlaps free event';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','cancel','resourceId',bus,'bookingId',event_book));if result->>'status' is distinct from '403' then raise exception 'ASSERT: another trainer cancelled free event';end if;
 result:=public.resource_request(other,event_payload||jsonb_build_object('matchId','test-home'));if result->>'status' is distinct from '400' then raise exception 'ASSERT: home match disguised as free event';end if;
 result:=public.resource_request(other,event_payload||jsonb_build_object('event',jsonb_build_object('title','Missing contact','category','other')));if result->>'status' is distinct from '400' then raise exception 'ASSERT: invalid event accepted';end if;
 result:=public.resource_request(other,jsonb_build_object('action','cancel','resourceId',bus,'bookingId',event_book));if result->>'ok' is distinct from 'true' then raise exception 'ASSERT: event creator cannot release reservation';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','book','resourceId',bus,'teamId',other_team,'startsAt',start_value,'endsAt',start_value+interval '4 hours'));
 if result->>'status' is distinct from '403' then raise exception 'ASSERT: trainer booked another team';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','book','resourceId',bus,'teamId',team,'matchId','test-match','expectedKickoff',start_value,'planning',jsonb_build_object('example','timing-snapshot'),'startsAt',start_value,'endsAt',start_value+interval '4 hours'));
 if result->>'ok' is distinct from 'true' then raise exception 'ASSERT: own booking failed: %',result;end if;book:=(result->>'bookingId')::uuid;
 if (select planning->>'example' from private.resource_bookings where id=book)<>'timing-snapshot' then raise exception 'ASSERT: timing snapshot lost';end if;
 if exists(select 1 from jsonb_array_elements(public.resource_request(actor,jsonb_build_object('action','list','month',to_char(start_value,'YYYY-MM')))->'matches') g where g->>'id'='test-home' and (g->>'canBook')::boolean) then raise exception 'ASSERT: calendar marks home as bookable';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','book','resourceId',bus,'teamId',team,'matchId','test-match','expectedKickoff',start_value,'planning',jsonb_build_object('example','timing-snapshot'),'startsAt',start_value,'endsAt',start_value+interval '5 hours'));
 if result->>'status' is distinct from '409' then raise exception 'ASSERT: overlap accepted';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','book','resourceId',bus,'teamId',team,'matchId','test-adjacent','expectedKickoff',start_value+interval '4 hours','startsAt',start_value+interval '4 hours','endsAt',start_value+interval '5 hours'));
 if result->>'ok' is distinct from 'true' then raise exception 'ASSERT: adjacent reservation rejected';end if;
 result:=public.resource_request(other,jsonb_build_object('action','cancel','resourceId',bus,'bookingId',book));
 if result->>'status' is distinct from '403' then raise exception 'ASSERT: foreign cancellation';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','cancel','resourceId',bus,'bookingId',book));
 if result->>'ok' is distinct from 'true' or not exists(select 1 from private.resource_bookings where id=book and cancelled_at is not null) then raise exception 'ASSERT: cancellation not recorded';end if;

 result:=public.resource_request(actor,event_payload);if result->>'ok' is distinct from 'true' then raise exception 'ASSERT: trainer free event failed';end if;event_book:=(result->>'bookingId')::uuid;
 update public.social_admins set role='admin' where user_id=other;
 result:=public.resource_request(other,jsonb_build_object('action','cancel','resourceId',bus,'bookingId',event_book));if result->>'ok' is distinct from 'true' then raise exception 'ASSERT: admin cannot cancel another member event';end if;
 update private.trainer_profiles set active=false where person_id=person;
 result:=public.resource_request(actor,jsonb_build_object('action','authorize','teamId',team));if result->>'status' is distinct from '403' then raise exception 'ASSERT: inactive trainer accepted';end if;
 update public.social_admins set is_blocked=true where user_id=actor;
 result:=public.resource_request(actor,'{"action":"list"}');if result->>'status' is distinct from '403' then raise exception 'ASSERT: blocked member accepted';end if;
 if has_function_privilege('anon','public.resource_request(uuid,jsonb)','execute') or has_function_privilege('authenticated','public.resource_request(uuid,jsonb)','execute') or has_table_privilege('anon','private.resource_bookings','select') then raise exception 'ASSERT: direct client access';end if;
end $$;
rollback;
