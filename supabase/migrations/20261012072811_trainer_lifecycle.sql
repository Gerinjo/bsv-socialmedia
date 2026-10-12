-- Trainer availability is separate from shared identities and Suite access rights.
alter table private.trainer_profiles add column active boolean not null default true;
update private.trainer_profiles tp set active=p.active from public.social_people p where p.id=tp.person_id;
grant delete on private.trainer_profiles to service_role;

create or replace function public.trainer_management_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 member public.social_admins; act text:=payload->>'action'; person uuid; team uuid; expected bigint; profile private.trainer_profiles;
 before_profile jsonb; before_team jsonb; item jsonb; assignments jsonb; result jsonb; old_assignment public.social_team_people;
 v_first_name text; v_last_name text; label text; slot text; current_version bigint;
begin
 select * into member from public.social_admins where user_id=actor for share;
 if not found or not member.is_active or member.is_blocked or (member.role<>'admin' and not 'trainer_management'=any(member.access_areas)) then return jsonb_build_object('error','Keine Berechtigung für die Trainerverwaltung.','status',403); end if;
 -- Serialize directory writes so a team cannot attach a concurrently removed profile.
 if act in ('save_person','save_photo','save_team','set_active','delete_person') then perform pg_advisory_xact_lock(7041956);end if;
 if act in ('set_active','delete_person') then
  person:=nullif(payload->>'personId','')::uuid;expected:=(payload->>'version')::bigint;
  select * into profile from private.trainer_profiles where person_id=person for update;
  if not found then return jsonb_build_object('error','Person nicht gefunden.','status',404);end if;
  if profile.version is distinct from expected then return jsonb_build_object('error','Die Person wurde inzwischen geändert. Bitte neu laden.','status',409);end if;
  before_profile:=to_jsonb(profile);
  if act='set_active' then
   if jsonb_typeof(payload->'active') is distinct from 'boolean' then return jsonb_build_object('error','Bitte den Trainerstatus auswählen.','status',400);end if;
   update private.trainer_profiles set active=(payload->>'active')::boolean,version=version+1,updated_at=now(),updated_by=actor where person_id=person;
   update public.social_teams set trainer_version=trainer_version+1 where id in (select team_id from public.social_team_people where person_id=person and staff_slot is not null);
   select to_jsonb(p) into result from private.trainer_profiles p where person_id=person;
  else
   if payload->'confirmed' is distinct from 'true'::jsonb then return jsonb_build_object('error','Bitte das Löschen ausdrücklich bestätigen.','status',400);end if;
   -- Financial identity, shared club roles and logins are retained. Finish pending refunds first.
   perform 1 from private.cashbook_accounts where person_id=person for update;
   if exists(select 1 from private.cashbook_accounts a where a.person_id=person and jsonb_array_length(private.cashbook_open_advances(a.id,false))>0) then return jsonb_build_object('error','Diese Person hat offene Erstattungen. Bitte zuerst abschließen oder den Trainer passiv schalten.','status',409);end if;
   select coalesce(jsonb_agg(to_jsonb(a)),'[]') into before_team from public.social_team_people a where person_id=person and staff_slot is not null;
   before_profile:=before_profile||jsonb_build_object('assignments',before_team);
   update public.social_teams set trainer_version=trainer_version+1 where id in (select team_id from public.social_team_people where person_id=person and staff_slot is not null);
   delete from public.social_team_people where person_id=person and staff_slot is not null;
   delete from private.trainer_profiles where person_id=person;
   result:=jsonb_build_object('deleted',true);
  end if;
  insert into private.trainer_audit(actor,action,person_id,before_data,after_data) values(actor,act,person,before_profile,result);
  return jsonb_build_object('ok',true,'personId',person,'version',result->'version');
 end if;
 if act='authorize' then
  person:=nullif(payload->>'personId','')::uuid;
  if not exists(select 1 from private.trainer_profiles where person_id=person) then return jsonb_build_object('error','Person nicht gefunden.','status',404);end if;
  return jsonb_build_object('ok',true);
 end if;
 if act in ('save_person','save_photo') then
  if act='save_person' and (coalesce(length(trim(payload->>'firstName')),0) not between 1 and 80 or coalesce(length(trim(payload->>'lastName')),0) not between 1 and 100) then return jsonb_build_object('error','Bitte Vor- und Nachname eingeben.','status',400);end if;
  person:=nullif(payload->>'personId','')::uuid;expected:=coalesce((payload->>'version')::bigint,0);
  if person is null then
   if act<>'save_person' or expected<>0 then return jsonb_build_object('error','Person fehlt.','status',400);end if;
   person:=gen_random_uuid();
   insert into public.social_people(id,slug,display_name,roles,active) values(person,'trainer-'||person::text,trim(payload->>'firstName')||' '||trim(payload->>'lastName'),array['Trainer'],true);
  else
   select * into profile from private.trainer_profiles where person_id=person for update;
   if not found then return jsonb_build_object('error','Person nicht gefunden.','status',404);end if;
   if profile.version<>expected then return jsonb_build_object('error','Die Person wurde inzwischen geändert. Bitte neu laden.','status',409);end if;
   before_profile:=to_jsonb(profile);
  end if;
  if act='save_photo' then
   if coalesce(payload->>'photoPath','') !~ ('^'||person::text||'/[a-f0-9]{64}\.(jpg|png|webp)$') then return jsonb_build_object('error','Ungültiges Foto.','status',400);end if;
   update private.trainer_profiles set photo_path=payload->>'photoPath',version=version+1,updated_at=now(),updated_by=actor where person_id=person;
  else
   v_first_name:=trim(payload->>'firstName');v_last_name:=trim(payload->>'lastName');
   if coalesce(length(v_first_name),0) not between 1 and 80 or coalesce(length(v_last_name),0) not between 1 and 100 then return jsonb_build_object('error','Bitte Vor- und Nachname eingeben.','status',400);end if;
   insert into private.trainer_profiles(person_id,first_name,last_name,website_name,email,phone,mobile,street,postcode,city,qualification,club,notes,public_email,public_phone,active,version,updated_by)
   values(person,v_first_name,v_last_name,trim(coalesce(payload->>'websiteName','')),lower(trim(coalesce(payload->>'email',''))),trim(coalesce(payload->>'phone','')),trim(coalesce(payload->>'mobile','')),trim(coalesce(payload->>'street','')),trim(coalesce(payload->>'postcode','')),trim(coalesce(payload->>'city','')),trim(coalesce(payload->>'qualification','')),trim(coalesce(payload->>'club','')),trim(coalesce(payload->>'notes','')),coalesce((payload->>'publicEmail')::boolean,false),coalesce((payload->>'publicPhone')::boolean,false),coalesce((payload->>'active')::boolean,true),1,actor)
   on conflict(person_id) do update set first_name=excluded.first_name,last_name=excluded.last_name,website_name=excluded.website_name,email=excluded.email,phone=excluded.phone,mobile=excluded.mobile,street=excluded.street,postcode=excluded.postcode,city=excluded.city,qualification=excluded.qualification,club=excluded.club,notes=excluded.notes,public_email=excluded.public_email,public_phone=excluded.public_phone,active=excluded.active,version=trainer_profiles.version+1,updated_at=now(),updated_by=actor;
   update public.social_people set display_name=v_first_name||' '||v_last_name,birth_date=nullif(payload->>'birthDate','')::date,updated_at=now() where id=person;
   if before_profile is not null and (before_profile->>'active')::boolean is distinct from coalesce((payload->>'active')::boolean,true) then update public.social_teams set trainer_version=trainer_version+1 where id in (select team_id from public.social_team_people where person_id=person and staff_slot is not null);end if;
   -- Linked logins keep their username, password and rights; their name follows the person.
   update public.social_admins s set first_name=v_first_name,last_name=v_last_name from private.cashbook_accounts a where a.person_id=person and a.suite_user_id=s.user_id;
  end if;
  select to_jsonb(p) into result from private.trainer_profiles p where person_id=person;
  insert into private.trainer_audit(actor,action,person_id,before_data,after_data) values(actor,act,person,before_profile,result);
  return jsonb_build_object('ok',true,'personId',person,'version',(result->>'version')::bigint);
 end if;
 if act='save_team' then
  team:=(payload->>'teamId')::uuid;expected:=(payload->>'version')::bigint;assignments:=payload->'assignments';
  select trainer_version into current_version from public.social_teams where id=team for update;
  if not found then return jsonb_build_object('error','Mannschaft nicht gefunden.','status',404);end if;
  if current_version is distinct from expected then return jsonb_build_object('error','Die Mannschaft wurde inzwischen geändert. Bitte neu laden.','status',409);end if;
  if coalesce(jsonb_typeof(assignments),'')<>'array' or jsonb_array_length(assignments)>20 then return jsonb_build_object('error','Ungültige Zuordnung.','status',400);end if;
  if exists(select 1 from jsonb_array_elements(assignments) a where coalesce(a->>'slot','') not in ('trainer','co1','co2','betreuer') and coalesce(a->>'slot','') !~ '^extra-[1-9][0-9]?$') or exists(select 1 from jsonb_array_elements(assignments) a group by a->>'slot' having count(*)>1) or exists(select 1 from jsonb_array_elements(assignments) a group by a->>'personId' having count(*)>1) then return jsonb_build_object('error','Jede Person und Position darf pro Mannschaft nur einmal belegt sein.','status',400);end if;
  for item in select value from jsonb_array_elements(assignments) loop
   if not exists(select 1 from private.trainer_profiles tp join public.social_people p on p.id=tp.person_id where tp.person_id=(item->>'personId')::uuid and p.active and (tp.active or exists(select 1 from public.social_team_people old where old.team_id=team and old.person_id=tp.person_id and old.staff_slot=item->>'slot'))) then return jsonb_build_object('error','Bitte aktive Personen auswählen.','status',400);end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(tp)),'[]') into before_team from public.social_team_people tp where team_id=team and staff_slot is not null;
  delete from public.social_team_people where team_id=team and staff_slot is not null;
  for item in select value from jsonb_array_elements(assignments) loop
   slot:=item->>'slot';person:=(item->>'personId')::uuid;
   label:=trim(coalesce(item->>'websiteRole',''));
   if label='' then label:=case slot when 'trainer' then 'Trainer' when 'co1' then 'Co-Trainer 1' when 'co2' then 'Co-Trainer 2' when 'betreuer' then 'Betreuer' else 'Trainer' end;end if;
   insert into public.social_team_people(team_id,person_id,role,staff_slot,website_visible,website_role) values(team,person,case slot when 'trainer' then 'Trainer' when 'co1' then 'Co-Trainer' when 'co2' then 'Co-Trainer' when 'betreuer' then 'Betreuer' else 'Trainer' end,slot,coalesce((item->>'websiteVisible')::boolean,false),label);
  end loop;
  update public.social_teams set trainer_managed=true,trainer_version=trainer_version+1 where id=team;
  insert into private.trainer_audit(actor,action,team_id,before_data,after_data) values(actor,act,team,before_team,assignments);
  return jsonb_build_object('ok',true,'version',current_version+1);
 end if;
 if act='list' then
  return jsonb_build_object('people',(select coalesce(jsonb_agg(to_jsonb(tp)||jsonb_build_object('id',p.id,'name',p.display_name,'active',tp.active,'birth_date',p.birth_date,'source_photo_url',coalesce(nullif(tp.website_photo_url,''),p.source_photo_url),'updated_by_name',(select trim(first_name||' '||last_name) from public.social_admins where user_id=tp.updated_by)) order by lower(tp.last_name),lower(tp.first_name)),'[]') from private.trainer_profiles tp join public.social_people p on p.id=tp.person_id),
   'teams',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug,'website_path',t.website_path,'version',t.trainer_version,'managed',t.trainer_managed) order by t.sort_order,t.name),'[]') from public.social_teams t),
   'assignments',(select coalesce(jsonb_agg(jsonb_build_object('teamId',team_id,'personId',person_id,'slot',staff_slot,'websiteVisible',website_visible,'websiteRole',website_role)),'[]') from public.social_team_people where staff_slot is not null));
 end if;
 return jsonb_build_object('error','Unbekannte Traineraktion.','status',400);
end $$;

create or replace function public.website_trainers_feed() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('teams',coalesce(jsonb_agg(jsonb_build_object('path',t.website_path,'coaches',(
  select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(nullif(tp.website_name,''),p.display_name),'role',a.website_role,'qualification',tp.qualification,'club',tp.club,
    'image',coalesce(nullif(tp.website_photo_url,''),p.source_photo_url),'photoPath',tp.photo_path,
    'phone',case when tp.public_phone then coalesce(nullif(tp.mobile,''),tp.phone) else '' end,'email',case when tp.public_email then tp.email else '' end)
    order by case a.staff_slot when 'trainer' then 0 when 'co1' then 1 when 'co2' then 2 when 'betreuer' then 3 else 4 end,a.staff_slot),'[]')
   from public.social_team_people a join public.social_people p on p.id=a.person_id and p.active join private.trainer_profiles tp on tp.person_id=p.id and tp.active where a.team_id=t.id and a.staff_slot is not null and a.website_visible
 )) order by t.sort_order,t.name),'[]')) from public.social_teams t where t.trainer_managed and nullif(t.website_path,'') is not null;
$$;
