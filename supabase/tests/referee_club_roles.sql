-- Run in a disposable database after all referee migrations. All fixtures roll back.
begin;
insert into auth.users(id,email) values('a0000000-0000-4000-8000-000000000021','club-role-admin@example.invalid');
insert into public.social_admins(user_id,email,role,is_active,access_areas) values('a0000000-0000-4000-8000-000000000021','club-role-admin@example.invalid','referee-admin',true,array['referees']);
insert into public.social_teams(id,slug,name,competition,active) values
 ('b0000000-0000-4000-8000-000000000021','role-team-one','Team One','Test',false),
 ('b0000000-0000-4000-8000-000000000022','role-team-two','Team Two','Test',false);
insert into public.social_people(id,slug,display_name,birth_date) values
 ('c0000000-0000-4000-8000-000000000021','role-coach','Coach','1980-01-01'),
 ('c0000000-0000-4000-8000-000000000022','role-youth','Youth Leader','1980-01-01'),
 ('c0000000-0000-4000-8000-000000000023','role-treasurer','Treasurer','1980-01-01');
insert into public.social_team_people(team_id,person_id,role) values
 ('b0000000-0000-4000-8000-000000000021','c0000000-0000-4000-8000-000000000021','Trainer'),
 ('b0000000-0000-4000-8000-000000000021','c0000000-0000-4000-8000-000000000022','Co-Trainer');
insert into private.referee_club_roles(person_id,role) values
 ('c0000000-0000-4000-8000-000000000022','youth_leadership'),
 ('c0000000-0000-4000-8000-000000000023','treasurer');
insert into public.social_games(id,home_team,away_team,kickoff_at,status,team_id) values
 ('d0000000-0000-4000-8000-000000000021','BSV','Guest',now()-interval '1 day','finished','b0000000-0000-4000-8000-000000000022');
insert into public.referee_assignments(game_id,created_by) values('d0000000-0000-4000-8000-000000000021','a0000000-0000-4000-8000-000000000021');
insert into public.referee_fee_cases(id,source_match_id,source_url,team_id,home_team,away_team,kickoff_at,game_status,appointment_state,checked_at) values
 ('e0000000-0000-4000-8000-000000000021',repeat('Z',32),'https://example.invalid/club-roles','b0000000-0000-4000-8000-000000000022','BSV','Guest',now()-interval '1 day','finished','assigned',now());
do $$
declare
 credentials jsonb:='{"action":"list","personId":"c0000000-0000-4000-8000-000000000022","teamId":"b0000000-0000-4000-8000-000000000022","birthDate":"1980-01-01"}';
 result jsonb; person uuid; assignment uuid; role_name text;
begin
 foreach role_name in array array['anon','authenticated'] loop
   if has_table_privilege(role_name,'private.referee_club_roles','SELECT,INSERT,UPDATE,DELETE') or has_table_privilege(role_name,'public.referee_portal_people','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Browser can read/grant club roles'; end if;
 end loop;
 if not (select relrowsecurity from pg_class where oid='private.referee_club_roles'::regclass) then raise exception 'Club role RLS missing'; end if;
 if not (select reloptions @> array['security_invoker=true'] from pg_class where oid='public.referee_portal_people'::regclass) then raise exception 'Portal view bypasses invoker rights'; end if;
 if (select count(*) from public.referee_portal_people where person_id='c0000000-0000-4000-8000-000000000022')<>2 then raise exception 'Club person duplicated or missing team'; end if;
 if not exists(select 1 from public.referee_portal_people where person_id='c0000000-0000-4000-8000-000000000022' and team_id='b0000000-0000-4000-8000-000000000021' and role='Jugendleitung') then raise exception 'Coaching assignment hid leadership label'; end if;
 if (select count(*) from public.referee_portal_people where person_id='c0000000-0000-4000-8000-000000000021')<>1 then raise exception 'Ordinary coach gained global access'; end if;
 -- Existing global roles also apply to newly created teams with no coach assignment.
 insert into public.social_teams(id,slug,name,competition) values('b0000000-0000-4000-8000-000000000023','role-team-new','New Team','Test');
 if (select count(*) from public.referee_portal_people where team_id='b0000000-0000-4000-8000-000000000023')<>2 then raise exception 'New team lacks club roles'; end if;
 foreach person in array array['c0000000-0000-4000-8000-000000000022'::uuid,'c0000000-0000-4000-8000-000000000023'::uuid] loop
   result:=public.referee_coach_request(credentials || jsonb_build_object('personId',person));
   if result ? 'error' or jsonb_array_length(result->'assignments')<>1 then raise exception 'Club person cannot access another team: %',result; end if;
   result:=public.referee_expense_coach_request(credentials || jsonb_build_object('personId',person,'action','expense_list'));
   if result ? 'error' or jsonb_array_length(result->'cases')<>1 then raise exception 'Club person cannot access reimbursements'; end if;
 end loop;
 result:=public.referee_coach_request(credentials || '{"birthDate":"1981-01-01"}');
 if result->>'status'<>'403' then raise exception 'Leadership bypassed birthday'; end if;
 result:=public.referee_coach_request(credentials || '{"personId":"c0000000-0000-4000-8000-000000000021"}');
 if result->>'status'<>'403' then raise exception 'Ordinary coach can access another team'; end if;
 select id into assignment from public.referee_assignments where game_id='d0000000-0000-4000-8000-000000000021';
 result:=public.referee_coach_request(credentials || jsonb_build_object('action','save','id',assignment,'version',1,'refereeName','Test Referee','fieldSize',9));
 if result ? 'error' or not exists(select 1 from public.referee_assignments where id=assignment and assigned_by='c0000000-0000-4000-8000-000000000022') then raise exception 'Leadership cannot save or missing actor'; end if;
 result:=public.referee_expense_coach_request(credentials || jsonb_build_object('personId','c0000000-0000-4000-8000-000000000023','action','expense_submit','caseId','e0000000-0000-4000-8000-000000000021','amountCents',3740,'confirmed',true,'receiptPath','test/role-receipt.png','receiptSha256',repeat('b',64),'receiptMime','image/png'));
 if result ? 'error' or not exists(select 1 from public.referee_expenses where case_id='e0000000-0000-4000-8000-000000000021' and person_id='c0000000-0000-4000-8000-000000000023') then raise exception 'Treasurer reimbursement failed: %',result; end if;
 result:=public.referee_admin_request('a0000000-0000-4000-8000-000000000021','{"action":"referee_birthdate","personId":"c0000000-0000-4000-8000-000000000023","birthDate":"1980-01-01"}');
 if result ? 'error' then raise exception 'Treasurer birthday cannot be maintained'; end if;
 result:=public.referee_expense_admin_request('a0000000-0000-4000-8000-000000000021','{"action":"referee_import_account","personId":"c0000000-0000-4000-8000-000000000023","encryptedDetails":"fake-ciphertext","ibanLast4":"3000","sourceMessageId":"fake-message"}');
 if result ? 'error' then raise exception 'Treasurer account cannot be maintained'; end if;
 result:=public.referee_admin_request('c0000000-0000-4000-8000-000000000023',jsonb_build_object('action','referee_pay','id',assignment,'version',2));
 if not result ? 'error' then raise exception 'Club role silently granted admin privileges'; end if;
 update private.referee_club_roles set active=false where person_id='c0000000-0000-4000-8000-000000000022';
 result:=public.referee_coach_request(credentials);
 if result->>'status'<>'403' then raise exception 'Revoked role still grants access'; end if;
 result:=public.referee_coach_request(credentials || '{"teamId":"b0000000-0000-4000-8000-000000000021"}');
 if result ? 'error' then raise exception 'Revoking leadership removed existing coach access'; end if;
 update private.referee_club_roles set active=true where person_id='c0000000-0000-4000-8000-000000000022';
 update public.social_people set active=false where id='c0000000-0000-4000-8000-000000000022';
 result:=public.referee_coach_request(credentials);
 if result->>'status'<>'403' then raise exception 'Inactive leadership accepted'; end if;
 update public.social_people set active=true where id='c0000000-0000-4000-8000-000000000022';
 update public.social_teams set referee_enabled=false where id='b0000000-0000-4000-8000-000000000022';
 result:=public.referee_coach_request(credentials);
 if result->>'status'<>'403' then raise exception 'Leadership bypassed disabled team'; end if;
 update public.social_teams set referee_enabled=true where id='b0000000-0000-4000-8000-000000000022';
end $$;
set local role service_role;
do $$ begin
 if (select count(*) from public.referee_portal_people where person_id='c0000000-0000-4000-8000-000000000023')<>3 then raise exception 'Service selector inaccessible'; end if;
 if public.referee_coach_request('{"action":"list","personId":"c0000000-0000-4000-8000-000000000023","teamId":"b0000000-0000-4000-8000-000000000022","birthDate":"1980-01-01"}') ? 'error' then raise exception 'Service role global access failed'; end if;
end $$;
rollback;
