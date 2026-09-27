-- Run in a disposable database with the migration applied. Fixtures are rolled back.
begin;
insert into auth.users(id,email) values ('a0000000-0000-4000-8000-000000000001','referee-test@example.invalid'),('a0000000-0000-4000-8000-000000000002','other-test@example.invalid');
insert into public.social_admins(user_id,email,role,is_active,access_areas) values
 ('a0000000-0000-4000-8000-000000000001','referee-test@example.invalid','referee-admin',true,array['referees']),
 ('a0000000-0000-4000-8000-000000000002','other-test@example.invalid','sm-team',true,array['social_media']);
insert into public.social_teams(id,slug,name,competition) values
 ('b0000000-0000-4000-8000-000000000001','referee-test-one','D1 Test','Test'),
 ('b0000000-0000-4000-8000-000000000002','referee-test-two','D2 Test','Test');
insert into public.social_people(id,slug,display_name,birth_date) values
 ('c0000000-0000-4000-8000-000000000001','referee-test-coach','Test Coach','1980-01-01'),
 ('c0000000-0000-4000-8000-000000000002','referee-test-helper','Test Helper','1980-01-01');
insert into public.social_team_people(team_id,person_id,role) values
 ('b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','Trainer'),
 ('b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','Betreuer');
insert into public.social_games(id,home_team,away_team,kickoff_at,status,team_id) values
 ('d0000000-0000-4000-8000-000000000001','BSV','Gast',now()-interval '1 day','finished','b0000000-0000-4000-8000-000000000001'),
 ('d0000000-0000-4000-8000-000000000002','BSV','Gast 2',now()+interval '1 day','scheduled','b0000000-0000-4000-8000-000000000002');
do $$
declare
 admin_id uuid := 'a0000000-0000-4000-8000-000000000001';
 other_id uuid := 'a0000000-0000-4000-8000-000000000002';
 target_game uuid := 'd0000000-0000-4000-8000-000000000001';
 assignment_id uuid;
 other_assignment uuid;
 result jsonb;
 credentials jsonb := '{"action":"list","personId":"c0000000-0000-4000-8000-000000000001","teamId":"b0000000-0000-4000-8000-000000000001","birthDate":"1980-01-01"}';
 save_request jsonb;
 role_name text;
 state text;
begin
 foreach role_name in array array['anon','authenticated'] loop
   if has_table_privilege(role_name,'public.referee_assignments','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Browser table access'; end if;
   if has_function_privilege(role_name,'public.referee_coach_request(jsonb)','EXECUTE') or has_function_privilege(role_name,'public.referee_admin_request(uuid,jsonb)','EXECUTE') then raise exception 'Browser RPC access'; end if;
 end loop;
 if exists(select 1 from pg_class where oid in ('public.referee_assignments'::regclass,'private.referee_login_attempts'::regclass) and not relrowsecurity) then raise exception 'RLS missing'; end if;
 result := public.referee_admin_request(other_id,jsonb_build_object('action','referee_register','gameId',target_game));
 if not result ? 'error' then raise exception 'Unprivileged admin created record'; end if;
 perform public.referee_admin_request(admin_id,jsonb_build_object('action','referee_register','gameId',target_game));
 perform public.referee_admin_request(admin_id,jsonb_build_object('action','referee_register','gameId',target_game));
 if (select count(*) from public.referee_assignments where referee_assignments.game_id=target_game) <> 1 then raise exception 'Registration not idempotent'; end if;
 select id into assignment_id from public.referee_assignments where referee_assignments.game_id=target_game;
 perform public.referee_admin_request(admin_id,'{"action":"referee_register","gameId":"d0000000-0000-4000-8000-000000000002"}');
 select id into other_assignment from public.referee_assignments where referee_assignments.game_id='d0000000-0000-4000-8000-000000000002';
 result := public.referee_coach_request(credentials);
 if jsonb_array_length(result->'assignments') <> 1 or result::text like '%birth_date%' or result::text like '%1980-01-01%' then raise exception 'Leaked team data or birthday'; end if;
 result := public.referee_coach_request(credentials || '{"birthDate":"1981-01-01"}');
 if result->>'status' <> '403' then raise exception 'Wrong birthday accepted'; end if;
 result := public.referee_coach_request(credentials || '{"teamId":"b0000000-0000-4000-8000-000000000002"}');
 if result->>'status' <> '403' then raise exception 'Foreign team accepted'; end if;
 result := public.referee_coach_request(credentials || '{"personId":"c0000000-0000-4000-8000-000000000002"}');
 if result->>'status' <> '403' then raise exception 'Non-coach accepted'; end if;
 save_request := credentials || jsonb_build_object('action','save','id',assignment_id,'refereeName','Robin Test','fieldSize',9,'version',1);
 result := public.referee_coach_request(save_request || jsonb_build_object('id',other_assignment));
 if result->>'status' <> '403' then raise exception 'Foreign record editable'; end if;
 result := public.referee_coach_request(save_request || '{"fieldSize":11}');
 if result->>'status' <> '400' then raise exception 'Invalid field size accepted'; end if;
 result := public.referee_admin_request(admin_id,jsonb_build_object('action','referee_pay','id',assignment_id,'version',1));
 if not result ? 'error' then raise exception 'Paid without referee'; end if;
 result := public.referee_coach_request(save_request);
 if result ? 'error' then raise exception 'Valid assignment failed: %',result; end if;
 result := public.referee_coach_request(save_request);
 if result->>'status' <> '409' then raise exception 'Stale edit accepted'; end if;
 foreach state in array array['scheduled','live','postponed','cancelled','aborted'] loop
   update public.social_games set status=state where id=target_game;
   result := public.referee_admin_request(admin_id,jsonb_build_object('action','referee_pay','id',assignment_id,'version',2));
   if not result ? 'error' then raise exception 'Paid non-finished game %',state; end if;
 end loop;
 update public.social_games set status='finished',kickoff_at=now()+interval '1 day' where id=target_game;
 result := public.referee_admin_request(admin_id,jsonb_build_object('action','referee_pay','id',assignment_id,'version',2));
 if not result ? 'error' then raise exception 'Paid future game'; end if;
 update public.social_games set kickoff_at=now()-interval '1 day' where id=target_game;
 result := public.referee_admin_request(other_id,jsonb_build_object('action','referee_pay','id',assignment_id,'version',2));
 if not result ? 'error' then raise exception 'Unprivileged payout'; end if;
 result := public.referee_admin_request(admin_id,jsonb_build_object('action','referee_pay','id',assignment_id,'version',1));
 if not result ? 'error' then raise exception 'Stale payout accepted'; end if;
 result := public.referee_admin_request(admin_id,jsonb_build_object('action','referee_pay','id',assignment_id,'version',2));
 if result ? 'error' then raise exception 'Valid payout failed: %',result; end if;
 if not exists(select 1 from public.referee_assignments where id=assignment_id and paid_at is not null and paid_by=admin_id and paid_game_snapshot->>'referee_name'='Robin Test') then raise exception 'Payout audit missing'; end if;
 result := public.referee_coach_request(save_request || '{"version":3,"refereeName":"Changed"}');
 if result->>'status' <> '409' then raise exception 'Paid record editable'; end if;
 result := public.referee_admin_request(admin_id,jsonb_build_object('action','referee_pay','id',assignment_id,'version',3));
 if not result ? 'error' then raise exception 'Double payout accepted'; end if;
 begin
   delete from public.social_games where id=target_game;
   raise exception 'Payout history deleted';
 exception when foreign_key_violation then null; end;
 -- Invalid credentials remain counted, even when the public handler returns 403.
 for i in 1..5 loop perform public.referee_coach_request(credentials || '{"birthDate":"1981-01-01"}'); end loop;
 result := public.referee_coach_request(credentials);
 if result->>'status' <> '429' then raise exception 'Birthday guessing is not rate limited'; end if;
 update private.referee_login_attempts set window_started_at=now()-interval '16 minutes';
 result := public.referee_coach_request(credentials);
 if result ? 'error' then raise exception 'Rate limit did not expire'; end if;
 update public.social_people set active=false where id='c0000000-0000-4000-8000-000000000001';
 result := public.referee_coach_request(credentials);
 if result->>'status' <> '403' then raise exception 'Inactive coach accepted'; end if;
 update public.social_people set active=true where id='c0000000-0000-4000-8000-000000000001';
end $$;
set local role service_role;
do $$ begin
 if public.referee_coach_request('{"action":"list","personId":"c0000000-0000-4000-8000-000000000001","teamId":"b0000000-0000-4000-8000-000000000001","birthDate":"1980-01-01"}') ? 'error' then raise exception 'Service role cannot use coach RPC'; end if;
end $$;
rollback;
