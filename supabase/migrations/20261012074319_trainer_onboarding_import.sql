-- Only the authenticated website mail bridge can import accepted onboardings.
create table private.trainer_onboarding_bridge (
 singleton boolean primary key default true check(singleton), secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$')
);
create table private.trainer_onboarding_imports (
 reference text primary key check(reference ~ '^TR-[0-9]{8}-[A-F0-9]{6}$'),
 person_id uuid not null references public.social_people(id),team_id uuid not null references public.social_teams(id),
 imported_at timestamptz not null default now()
);
create index trainer_onboarding_imports_person on private.trainer_onboarding_imports(person_id);
create index trainer_onboarding_imports_team on private.trainer_onboarding_imports(team_id);
alter table private.trainer_onboarding_bridge enable row level security;
alter table private.trainer_onboarding_imports enable row level security;
revoke all on private.trainer_onboarding_bridge,private.trainer_onboarding_imports from public,anon,authenticated;
grant select on private.trainer_onboarding_bridge to service_role;
grant select,insert on private.trainer_onboarding_imports to service_role;

create function public.import_trainer_onboarding(secret_hash text,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
#variable_conflict use_variable
declare reference text:=payload->>'applicationNumber'; role_name text:=payload->>'role';
 first_name text:=trim(payload->>'firstName');last_name text:=trim(payload->>'lastName');email text:=lower(trim(payload->>'email'));
 person uuid;team uuid;profile private.trainer_profiles;slot text; existing private.trainer_onboarding_imports;
 path text;before_profile jsonb;new_profile boolean:=false;new_identity boolean:=false;matches int;candidate int;
begin
 if not exists(select 1 from private.trainer_onboarding_bridge b where b.secret_hash=import_trainer_onboarding.secret_hash) then return jsonb_build_object('error','unauthorized','status',401);end if;
 if reference is null or reference !~ '^TR-[0-9]{8}-[A-F0-9]{6}$' or coalesce(length(first_name),0) not between 1 and 80 or coalesce(length(last_name),0) not between 1 and 100 or role_name is null or role_name not in ('Trainer','Co-Trainer','Betreuer') or email is null or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or coalesce(length(email),0)>254 or coalesce(length(payload->>'mobile'),0)>50 or coalesce(length(payload->>'street'),0)>160 or coalesce(length(payload->>'postcode'),0)>20 or coalesce(length(payload->>'city'),0)>100 or coalesce(payload->>'birthDate','') !~ '^\d{4}-\d{2}-\d{2}$' then return jsonb_build_object('error','invalid_profile','status',400);end if;
 -- Keys map to the existing canonical website paths, never client-provided names.
 path:=case payload->>'teamKey' when 'fussball--alte-herren' then 'fussball/alte-herren' else replace(payload->>'teamKey','--','/') end;
 select id into team from public.social_teams where website_path=path;
 if team is null then return jsonb_build_object('error','unknown_team','status',400);end if;
 if payload->'dryRun'='true'::jsonb then return jsonb_build_object('ok',true,'dryRun',true);end if;
 perform pg_advisory_xact_lock(7041956);
 select * into existing from private.trainer_onboarding_imports i where i.reference=reference;
 if found then return jsonb_build_object('ok',true,'personId',existing.person_id,'duplicate',true);end if;
 -- Exact name and compatible birthday avoid merging different people sharing an email.
 select count(*),(array_agg(tp.person_id))[1] into matches,person from private.trainer_profiles tp join public.social_people p on p.id=tp.person_id
 where lower(tp.first_name)=lower(first_name) and lower(tp.last_name)=lower(last_name) and (p.birth_date is null or p.birth_date=(payload->>'birthDate')::date);
 if matches>1 then return jsonb_build_object('error','ambiguous_person','status',409);end if;
 if person is null then
  -- Reuse a shared identity when it unambiguously matches; no Suite login is created.
  select count(*),(array_agg(id))[1] into matches,person from public.social_people p where lower(p.display_name)=lower(first_name||' '||last_name) and (p.birth_date is null or p.birth_date=(payload->>'birthDate')::date);
  if matches>1 then return jsonb_build_object('error','ambiguous_person','status',409);end if;
 end if;
 if person is null then
  person:=gen_random_uuid();new_identity:=true;
 end if;
 select * into profile from private.trainer_profiles where person_id=person for update;
 before_profile:=case when found then to_jsonb(profile) else null end;new_profile:=before_profile is null;
 -- Select a vacant role slot; an occupied position is never overwritten.
 select staff_slot into slot from public.social_team_people where team_id=team and person_id=person and staff_slot is not null;
 if slot is null then
  if role_name='Trainer' and not exists(select 1 from public.social_team_people where team_id=team and staff_slot='trainer') then slot:='trainer';
  elsif role_name='Betreuer' and not exists(select 1 from public.social_team_people where team_id=team and staff_slot='betreuer') then slot:='betreuer';
  elsif role_name='Co-Trainer' then
   if not exists(select 1 from public.social_team_people where team_id=team and staff_slot='co1') then slot:='co1';
   elsif not exists(select 1 from public.social_team_people where team_id=team and staff_slot='co2') then slot:='co2';end if;
  end if;
  if slot is null then for candidate in 1..16 loop if not exists(select 1 from public.social_team_people where team_id=team and staff_slot='extra-'||candidate) then slot:='extra-'||candidate;exit;end if;end loop;end if;
  if slot is null then return jsonb_build_object('error','team_full','status',409);end if;
 end if;
 if new_identity then insert into public.social_people(id,slug,display_name,roles,active) values(person,'trainer-'||person::text,first_name||' '||last_name,array[role_name],true);end if;
 insert into private.trainer_profiles(person_id,first_name,last_name,email,mobile,street,postcode,city,active)
 values(person,first_name,last_name,email,coalesce(payload->>'mobile',''),coalesce(payload->>'street',''),coalesce(payload->>'postcode',''),coalesce(payload->>'city',''),true)
 on conflict(person_id) do update set email=case when trainer_profiles.email='' then excluded.email else trainer_profiles.email end,mobile=case when trainer_profiles.mobile='' then excluded.mobile else trainer_profiles.mobile end,street=case when trainer_profiles.street='' then excluded.street else trainer_profiles.street end,postcode=case when trainer_profiles.postcode='' then excluded.postcode else trainer_profiles.postcode end,city=case when trainer_profiles.city='' then excluded.city else trainer_profiles.city end,version=trainer_profiles.version+1,updated_at=now();
 update public.social_people set birth_date=coalesce(birth_date,(payload->>'birthDate')::date),roles=case when role_name=any(roles) then roles else roles||role_name end,updated_at=now() where id=person;
 if not exists(select 1 from public.social_team_people where team_id=team and person_id=person and staff_slot is not null) then
  insert into public.social_team_people(team_id,person_id,role,staff_slot,website_visible,website_role) values(team,person,role_name,slot,false,role_name)
  on conflict(team_id,person_id,role) do update set staff_slot=excluded.staff_slot,website_visible=false,website_role=excluded.website_role;
  update public.social_teams set trainer_managed=true,trainer_version=trainer_version+1 where id=team;
 end if;
 insert into private.trainer_onboarding_imports(reference,person_id,team_id) values(reference,person,team);
 insert into private.trainer_audit(action,person_id,team_id,before_data,after_data) values('onboarding_import',person,team,before_profile,jsonb_build_object('reference',reference,'role',role_name,'slot',slot,'newProfile',new_profile));
 return jsonb_build_object('ok',true,'personId',person,'newProfile',new_profile);
end $$;
revoke all on function public.import_trainer_onboarding(text,jsonb) from public,anon,authenticated;
grant execute on function public.import_trainer_onboarding(text,jsonb) to service_role;
