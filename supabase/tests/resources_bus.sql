begin;
set local role service_role;
do $$
declare actor uuid:=gen_random_uuid();other uuid:=gen_random_uuid();person uuid:=gen_random_uuid();team uuid:=gen_random_uuid();other_team uuid:=gen_random_uuid();bus uuid;result jsonb;book uuid;start_value timestamptz:=now()+interval '10 days';
begin
 insert into public.social_admins(user_id,role,is_active,is_blocked,person_id,first_name,last_name,username,access_areas) values(actor,'sm-team',true,false,person,'Trainer','Test','test',array['resources']), (other,'sm-team',true,false,null,'Andere','Person','andere',array['resources']);
 insert into private.trainer_profiles(person_id,active) values(person,true);
 insert into public.social_teams(id,name,slug,trainer_managed) values(team,'D1','u13-d1-junioren',true),(other_team,'C1','u15-c1-junioren',true);
 insert into public.social_team_people(team_id,person_id,staff_slot) values(team,person,'trainer');
 select id into bus from private.club_resources where slug='bus';
 result:=public.resource_request(actor,jsonb_build_object('action','_sync','matches',jsonb_build_array(jsonb_build_object('id','test-match','teamId',team,'sourceMatchId','test','kickoffAt',start_value,'home','BSV','away','Test','status','scheduled','isHome',true,'sourceUrl','https://example.org','matchMinutes',70))));
 if result->>'ok'<>'true' then raise exception 'ASSERT: schedule import failed';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','list','month',to_char(start_value at time zone 'Europe/Berlin','YYYY-MM')));
 if jsonb_array_length(result->'matches')<>1 or jsonb_array_length(result->'resources')<>1 then raise exception 'ASSERT: calendar incomplete: %',result;end if;
 result:=public.resource_request(actor,jsonb_build_object('action','book','resourceId',bus,'teamId',team,'matchId','test-match','expectedKickoff',start_value+interval '1 hour','startsAt',start_value-interval '1 hour','endsAt',start_value+interval '4 hours'));
 if result->>'status'<>'409' then raise exception 'ASSERT: changed kickoff accepted';end if;

 result:=public.resource_request(actor,jsonb_build_object('action','book','resourceId',bus,'teamId',other_team,'startsAt',start_value,'endsAt',start_value+interval '4 hours'));
 if result->>'status'<>'403' then raise exception 'ASSERT: trainer booked another team';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','book','resourceId',bus,'teamId',team,'startsAt',start_value,'endsAt',start_value+interval '4 hours'));
 if result->>'ok'<>'true' then raise exception 'ASSERT: own booking failed: %',result;end if;book:=(result->>'bookingId')::uuid;
 result:=public.resource_request(actor,jsonb_build_object('action','book','resourceId',bus,'teamId',team,'startsAt',start_value+interval '1 hour','endsAt',start_value+interval '5 hours'));
 if result->>'status'<>'409' then raise exception 'ASSERT: overlap accepted';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','book','resourceId',bus,'teamId',team,'startsAt',start_value+interval '4 hours','endsAt',start_value+interval '5 hours'));
 if result->>'ok'<>'true' then raise exception 'ASSERT: adjacent reservation rejected';end if;
 result:=public.resource_request(other,jsonb_build_object('action','cancel','resourceId',bus,'bookingId',book));
 if result->>'status'<>'403' then raise exception 'ASSERT: foreign cancellation';end if;
 result:=public.resource_request(actor,jsonb_build_object('action','cancel','resourceId',bus,'bookingId',book));
 if result->>'ok'<>'true' or not exists(select 1 from private.resource_bookings where id=book and cancelled_at is not null) then raise exception 'ASSERT: cancellation not recorded';end if;
 update private.trainer_profiles set active=false where person_id=person;
 result:=public.resource_request(actor,jsonb_build_object('action','authorize','teamId',team));if result->>'status'<>'403' then raise exception 'ASSERT: inactive trainer accepted';end if;
 update public.social_admins set is_blocked=true where user_id=actor;
 result:=public.resource_request(actor,'{"action":"list"}');if result->>'status'<>'403' then raise exception 'ASSERT: blocked member accepted';end if;
 if has_function_privilege('anon','public.resource_request(uuid,jsonb)','execute') or has_function_privilege('authenticated','public.resource_request(uuid,jsonb)','execute') or has_table_privilege('anon','private.resource_bookings','select') then raise exception 'ASSERT: direct client access';end if;
end $$;
rollback;
