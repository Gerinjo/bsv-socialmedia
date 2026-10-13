begin;
create function pg_temp.check_trainer_email(ok boolean,label text) returns void language plpgsql as $$begin if ok is not true then raise exception 'Trainer email contact: %',label;end if;end $$;
set local role service_role;
do $$
declare target uuid; feed jsonb; coach jsonb; approved boolean;
begin
 select p.id into target from public.social_people p
 join private.trainer_profiles tp on tp.person_id=p.id and tp.active
 join public.social_team_people a on a.person_id=p.id and a.website_visible and a.staff_slot is not null
 join public.social_teams t on t.id=a.team_id and t.trainer_managed and nullif(t.website_path,'') is not null
 where p.active limit 1;
 perform pg_temp.check_trainer_email(target is not null,'published active trainer exists');
 foreach approved in array array[false,true] loop
  update private.trainer_profiles set email='hidden-trainer@example.test',public_email=approved,phone='+49 123 4567',mobile='',public_phone=true,website_name='Email Privacy Test' where person_id=target;
  feed:=public.website_trainers_feed();
  perform pg_temp.check_trainer_email(not exists(select 1 from jsonb_array_elements(feed->'teams') t,jsonb_array_elements(t->'coaches') c where c ? 'email') and feed::text not like '%hidden-trainer@example.test%','email omitted regardless of stored approval');
  select c into coach from jsonb_array_elements(feed->'teams') t,jsonb_array_elements(t->'coaches') c where c->>'name'='Email Privacy Test' limit 1;
  perform pg_temp.check_trainer_email(coach->>'phone'='+49 123 4567','published trainer and approved phone retained');
  perform pg_temp.check_trainer_email((select email='hidden-trainer@example.test' and public_email=approved from private.trainer_profiles where person_id=target),'internal email and existing approval retained');
 end loop;
 update private.trainer_profiles set public_phone=false where person_id=target;
 select c into coach from jsonb_array_elements(public.website_trainers_feed()->'teams') t,jsonb_array_elements(t->'coaches') c where c->>'name'='Email Privacy Test' limit 1;
 perform pg_temp.check_trainer_email(coach->>'phone'='','unapproved phone remains private');
end $$;
reset role;
select pg_temp.check_trainer_email(not has_function_privilege('anon','public.website_trainers_feed()','EXECUTE') and not has_function_privilege('authenticated','public.website_trainers_feed()','EXECUTE') and has_function_privilege('service_role','public.website_trainers_feed()','EXECUTE'),'feed remains service-only');
rollback;
