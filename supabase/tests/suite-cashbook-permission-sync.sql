-- Isolated database only. Financial state and all fixture identities roll back.
begin;
create function pg_temp.cashbook_grant_check(ok boolean,label text) returns void language plpgsql as $$begin if ok is not true then raise exception 'Cashbook grant: %',label;end if;end $$;
do $$
declare admin_id uuid; trainer_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); cashier_id uuid:=gen_random_uuid(); missing_id uuid:=gen_random_uuid(); unlinked_id uuid:=gen_random_uuid();
 person uuid; second_person uuid; third_person uuid; missing_person uuid; team uuid; profile uuid; reused_profile uuid; result jsonb; count_before bigint; balance_before bigint; blocked boolean;
begin
 select user_id into admin_id from public.social_admins where role='admin' and is_active and not is_blocked limit 1;
 select team_id into team from private.cashbook_teams where enabled order by team_id limit 1;
 select count(*) into count_before from private.cashbook_entries;balance_before:=private.cashbook_balance();
 insert into auth.users(id,email) values(trainer_id,'grant-trainer@example.test'),(second_id,'grant-second@example.test'),(cashier_id,'grant-cashier@example.test'),(missing_id,'grant-missing@example.test'),(unlinked_id,'grant-unlinked@example.test');
 insert into public.social_people(slug,display_name,active) values('grant-test-trainer','Grant Trainer',true) returning id into person;
 insert into public.social_people(slug,display_name,active) values('grant-test-second','Grant Second',true) returning id into second_person;
 insert into public.social_people(slug,display_name,active) values('grant-test-unlinked','Grant Unlinked',true) returning id into third_person;
 insert into public.social_people(slug,display_name,active) values('grant-test-missing','Grant Missing',true) returning id into missing_person;
 insert into public.social_team_people(team_id,person_id,role) values(team,person,'Co-Trainer'),(team,second_person,'Trainer'),(team,third_person,'Trainer');
 set local role service_role;
 result:=public.suite_users_request(admin_id,jsonb_build_object('action','create_member','userId',trainer_id,'email','grant-trainer@example.test','roleKey','trainer','firstName','Grant','lastName','Trainer','username','granttrain','personId',person,'extraAreas','[]'::jsonb));
 perform pg_temp.cashbook_grant_check(result->>'ok'='true' and not exists(select 1 from private.cashbook_accounts where suite_user_id=trainer_id),'trainer without grant has no financial profile');
 result:=public.suite_users_request(admin_id,jsonb_build_object('action','save_member','userId',trainer_id,'roleKey','trainer','firstName','Grant','lastName','Trainer','username','granttrain','extraAreas','["cashbook"]'::jsonb));
 result:=public.cashbook_request(trainer_id,'{"action":"authorize"}');
 perform pg_temp.cashbook_grant_check((result->>'canBook')::boolean and (result->>'canWithdraw')::boolean and not (result->>'canDeposit')::boolean and jsonb_array_length(result->'teams')=1 and result->'teams'->0->>'id'=team::text,'checkbox creates a working own-team profile');
 select id into profile from private.cashbook_accounts where suite_user_id=trainer_id;
 result:=public.suite_users_request(admin_id,jsonb_build_object('action','save_member','userId',trainer_id,'roleKey','trainer','firstName','Grant','lastName','Trainer','username','grantnew','extraAreas','[]'::jsonb));
 update public.social_admins set extra_access_areas=array['cashbook'] where user_id=trainer_id;
 perform pg_temp.cashbook_grant_check((select id=profile and username='grantnew' from private.cashbook_accounts where suite_user_id=trainer_id),'repeat/rename preserves financial identity and alias');
 result:=public.suite_users_request(admin_id,jsonb_build_object('action','save_member','userId',trainer_id,'roleKey','trainer','firstName','Grant','lastName','Trainer','username','grantnew','extraAreas','[]'::jsonb));
 result:=public.cashbook_request(trainer_id,'{"action":"authorize"}');
 perform pg_temp.cashbook_grant_check(result->>'status'='403' and exists(select 1 from private.cashbook_accounts where id=profile),'revocation denies old sessions without deleting profile');
 result:=public.suite_users_request(admin_id,jsonb_build_object('action','save_member','userId',trainer_id,'roleKey','cashier','firstName','Grant','lastName','Trainer','username','grantnew','extraAreas','[]'::jsonb));
 result:=public.cashbook_request(trainer_id,'{"action":"authorize"}');
 perform pg_temp.cashbook_grant_check((result->>'canDeposit')::boolean and not (result->>'canWithdraw')::boolean and (select id=profile from private.cashbook_accounts where suite_user_id=trainer_id),'cashier role updates existing financial profile without duplication');
 result:=public.suite_users_request(admin_id,jsonb_build_object('action','save_member','userId',trainer_id,'roleKey','trainer','firstName','Grant','lastName','Trainer','username','grantnew','extraAreas','[]'::jsonb));
 update public.social_admins set extra_access_areas=array['cashbook'] where user_id=trainer_id;
 result:=public.cashbook_request(trainer_id,'{"action":"authorize"}');
 perform pg_temp.cashbook_grant_check((result->>'canWithdraw')::boolean and not (result->>'canDeposit')::boolean,'trainer role removes former cashier powers');

 -- Rights assigned through a role follow exactly the same path; legacy identities
 -- resolve by one unique full name without another manual financial setup step.
 insert into public.social_suite_roles(key,label,access_areas) values('grant-test-role','Test Finanzrecht','{}');
 result:=public.suite_users_request(admin_id,jsonb_build_object('action','create_member','userId',second_id,'email','grant-second@example.test','roleKey','grant-test-role','firstName','Grant','lastName','Second','username','grantsecond','extraAreas','[]'::jsonb));
 result:=public.suite_users_request(admin_id,'{"action":"save_role","key":"grant-test-role","accessAreas":["cashbook"]}');
 result:=public.cashbook_request(second_id,'{"action":"authorize"}');
 perform pg_temp.cashbook_grant_check((result->>'canBook')::boolean and (select person_id=second_person from public.social_admins where user_id=second_id),'role grant resolves canonical person and creates profile');

 insert into private.cashbook_accounts(person_id,username,role) values(third_person,'grantunlinked','trainer') returning id into reused_profile;
 result:=public.suite_users_request(admin_id,jsonb_build_object('action','create_member','userId',unlinked_id,'email','grant-unlinked@example.test','roleKey','trainer','firstName','Grant','lastName','Unlinked','username','grantunlinked','personId',third_person,'extraAreas','["cashbook"]'::jsonb));
 perform pg_temp.cashbook_grant_check((select id=reused_profile from private.cashbook_accounts where suite_user_id=unlinked_id),'existing unlinked profile is reused');
 update private.cashbook_accounts set active=false where id=reused_profile;
 update public.social_admins set username=username where user_id=unlinked_id;
 result:=public.cashbook_request(unlinked_id,'{"action":"authorize"}');
 perform pg_temp.cashbook_grant_check(result->>'status'='403' and (select not active from private.cashbook_accounts where id=reused_profile),'unrelated edits cannot reactivate blocked financial profile');

 result:=public.suite_users_request(admin_id,jsonb_build_object('action','create_member','userId',cashier_id,'email','grant-cashier@example.test','roleKey','cashier','firstName','Neue','lastName','Kassenperson','username','grantcashier','extraAreas','[]'::jsonb));
 result:=public.cashbook_request(cashier_id,'{"action":"authorize"}');
 perform pg_temp.cashbook_grant_check((result->>'canBook')::boolean and (result->>'canDeposit')::boolean and not (result->>'canWithdraw')::boolean and (select person_id is not null from public.social_admins where user_id=cashier_id),'new cashier automatically gets canonical financial identity and deposit rights');
 blocked:=false;
 begin
  perform public.suite_users_request(admin_id,jsonb_build_object('action','save_member','userId',cashier_id,'roleKey','trainer','firstName','Neue','lastName','Kassenperson','username','grantcashier','extraAreas','["cashbook"]'::jsonb));
 exception when raise_exception then blocked:=sqlerrm like '%keine im Kassenbuch freigeschaltete Mannschaft%';end;
 perform pg_temp.cashbook_grant_check(blocked and (select suite_role_key='cashier' from public.social_admins where user_id=cashier_id),'invalid trainer role change rolls back existing role and rights');

 result:=public.suite_users_request(admin_id,jsonb_build_object('action','create_member','userId',missing_id,'email','grant-missing@example.test','roleKey','trainer','firstName','Grant','lastName','Missing','username','grantmissing','personId',missing_person,'extraAreas','[]'::jsonb));
 blocked:=false;
 begin
  perform public.suite_users_request(admin_id,jsonb_build_object('action','save_member','userId',missing_id,'roleKey','trainer','firstName','Grant','lastName','Missing','username','grantmissing','extraAreas','["cashbook"]'::jsonb));
 exception when raise_exception then blocked:=sqlerrm like '%keine im Kassenbuch freigeschaltete Mannschaft%';end;
 perform pg_temp.cashbook_grant_check(blocked and (select not ('cashbook'=any(access_areas)) from public.social_admins where user_id=missing_id) and not exists(select 1 from private.cashbook_accounts where suite_user_id=missing_id),'missing team gives actionable error and grant rolls back atomically');

 -- A conflicting identity must never steal an existing financial account.
 blocked:=false;
 begin
  update public.social_admins set person_id=null,first_name='Grant',last_name='Second',extra_access_areas=array['cashbook'] where user_id=missing_id;
 exception when raise_exception then blocked:=sqlerrm like '%bereits einen anderen Suite-Zugang%';end;
 perform pg_temp.cashbook_grant_check(blocked and (select suite_user_id=second_id from private.cashbook_accounts where person_id=second_person),'cannot steal another member financial identity');
 perform pg_temp.cashbook_grant_check((select count(*)=count_before from private.cashbook_entries) and private.cashbook_balance()=balance_before,'permissions never change ledger or safe');
 perform pg_temp.cashbook_grant_check(not has_function_privilege('anon','private.suite_cashbook_access_sync()','execute') and not has_function_privilege('authenticated','private.suite_cashbook_access_sync()','execute'),'browser cannot invoke financial linking');
 reset role;
end $$;
rollback;
