begin;
create function pg_temp.onboarding_check(ok boolean,label text) returns void language plpgsql as $$begin if ok is not true then raise exception 'Trainer onboarding: %',label;end if;end $$;
insert into private.trainer_onboarding_bridge(secret_hash) values(repeat('f',64));
set local role service_role;
do $$
declare body jsonb:=jsonb_build_object('applicationNumber','TR-20261012-ABCDEF','firstName','Lea Marie','lastName','Onboardingtest','email','lea@example.org','mobile','+49 123 4567','birthDate','1990-03-18','street','Teststraße 1','postcode','78315','city','Radolfzell','teamKey','jugend--u15-c1','role','Trainer');
 result jsonb;target uuid;existing uuid;before_assignments bigint;before_balance bigint;before_logins bigint;before_people bigint;
begin
 select count(*) into before_assignments from public.social_team_people where staff_slot is not null;
 select count(*) into before_logins from public.social_admins;select count(*) into before_people from private.trainer_profiles;before_balance:=private.cashbook_balance();
 result:=public.import_trainer_onboarding(repeat('a',64),body);perform pg_temp.onboarding_check(result->>'status'='401','wrong bridge key denied');
 result:=public.import_trainer_onboarding(repeat('f',64),body||'{"teamKey":"invalid"}');perform pg_temp.onboarding_check(result->>'status'='400','unknown team denied');
 result:=public.import_trainer_onboarding(repeat('f',64),body);perform pg_temp.onboarding_check(result->>'ok'='true','import accepted');target:=(result->>'personId')::uuid;
 perform pg_temp.onboarding_check((select first_name='Lea Marie' and last_name='Onboardingtest' and mobile='+49 123 4567' and email='lea@example.org' and street='Teststraße 1' and not public_phone and not public_email from private.trainer_profiles where person_id=target),'validated contacts retained privately');
 perform pg_temp.onboarding_check((select not website_visible and website_role='Trainer' and staff_slot like 'extra-%' from public.social_team_people where person_id=target),'occupied head coach retained; new assignment unpublished');
 perform pg_temp.onboarding_check(not exists(select 1 from jsonb_array_elements(public.website_trainers_feed()->'teams') t,jsonb_array_elements(t->'coaches') c where c->>'name'='Lea Marie Onboardingtest'),'new person absent on public homepage');
 result:=public.import_trainer_onboarding(repeat('f',64),body);perform pg_temp.onboarding_check(result->>'duplicate'='true' and result->>'personId'=target::text,'transport retry is idempotent');
 result:=public.import_trainer_onboarding(repeat('f',64),body||'{"applicationNumber":"TR-20261012-123ABC"}');perform pg_temp.onboarding_check(result->>'personId'=target::text,'resubmission recognized by full name and birthday');
 perform pg_temp.onboarding_check((select count(*)=before_people+1 from private.trainer_profiles) and (select count(*)=before_assignments+1 from public.social_team_people where staff_slot is not null),'no duplicated profile or membership');
 -- Onboarding an existing published coach does not undo prior editorial approval.
 select p.id into existing from public.social_people p where slug='axel-schauble';
 result:=public.import_trainer_onboarding(repeat('f',64),body||jsonb_build_object('applicationNumber','TR-20261012-456DEF','firstName','Axel','lastName','Schäuble','birthDate',(select birth_date::text from public.social_people where id=existing)));
 perform pg_temp.onboarding_check(result->>'personId'=existing::text,'existing trainer recognized');
 perform pg_temp.onboarding_check(exists(select 1 from public.social_team_people where person_id=existing and website_visible),'existing publication not revoked');
 -- All three roles can be associated without displacing another trainer.
 for body in select value from jsonb_array_elements(jsonb_build_array(body||'{"applicationNumber":"TR-20261012-111AAA","firstName":"Mara","role":"Co-Trainer"}',body||'{"applicationNumber":"TR-20261012-222BBB","firstName":"Nora","role":"Betreuer"}')) loop
  result:=public.import_trainer_onboarding(repeat('f',64),body);perform pg_temp.onboarding_check(result->>'ok'='true','co-trainer and supervisor import');
  perform pg_temp.onboarding_check(exists(select 1 from public.social_team_people where person_id=(result->>'personId')::uuid and role=body->>'role' and not website_visible),'assigned role retained and private');
 end loop;
 perform pg_temp.onboarding_check((select count(*)=before_logins from public.social_admins) and before_balance=private.cashbook_balance(),'no automatic accounts or cash mutations');
 perform pg_temp.onboarding_check(exists(select 1 from private.trainer_audit where person_id=target and action='onboarding_import' and created_at is not null),'import audited');
end $$;
reset role;
select pg_temp.onboarding_check(not has_function_privilege('anon','public.import_trainer_onboarding(text,jsonb)','EXECUTE') and not has_table_privilege('authenticated','private.trainer_onboarding_bridge','SELECT'),'no public import or secret access');
rollback;
