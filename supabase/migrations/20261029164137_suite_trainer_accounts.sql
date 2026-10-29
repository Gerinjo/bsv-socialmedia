begin;
-- General Suite identity does not require a financial account.
alter table public.social_admins add column person_id uuid references public.social_people(id) on delete set null;
create unique index social_admins_person_unique on public.social_admins(person_id) where person_id is not null;
update public.social_admins m set person_id=a.person_id from private.cashbook_accounts a where a.suite_user_id=m.user_id;
-- Reconcile a unique full-name match with the canonical trainer profile; keep financial identities intact.
update public.social_admins m set person_id=p.person_id from private.trainer_profiles p
 where lower(trim(m.first_name))=lower(trim(p.first_name)) and lower(trim(m.last_name))=lower(trim(p.last_name))
 and (select count(*) from private.trainer_profiles x where lower(trim(x.first_name))=lower(trim(p.first_name)) and lower(trim(x.last_name))=lower(trim(p.last_name)))=1
 and (select count(*) from public.social_admins x where lower(trim(x.first_name))=lower(trim(p.first_name)) and lower(trim(x.last_name))=lower(trim(p.last_name)))=1;

-- Preserve the existing financial-account linking flow for later Suite accounts.
create function private.suite_member_person_link() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.person_id is null then select a.person_id into new.person_id from private.cashbook_accounts a where a.suite_user_id=new.user_id;end if;
 return new;
end $$;
create trigger social_admins_person_link before insert or update on public.social_admins for each row execute function private.suite_member_person_link();
revoke all on function private.suite_member_person_link() from public,anon,authenticated;
grant execute on function private.suite_member_person_link() to service_role;

-- Snapshot and preserve existing financial access before changing the default trainer role.
create temporary table trainer_cashbook_rights_before on commit drop as select user_id,'cashbook'=any(access_areas) as allowed from public.social_admins;
update public.social_admins set extra_access_areas=extra_access_areas||'cashbook'::text
 where suite_role_key='trainer' and 'cashbook'=any(access_areas) and not 'cashbook'=any(extra_access_areas);
update public.social_suite_roles set access_areas=array_remove(access_areas,'cashbook'),updated_at=now() where key='trainer';
update public.social_admins set suite_role_key=suite_role_key where suite_role_key='trainer';
do $$begin
 if exists(select 1 from trainer_cashbook_rights_before b join public.social_admins m using(user_id) where b.allowed is distinct from ('cashbook'=any(m.access_areas))) then
  raise exception 'Bestehende Kassenbuchrechte dürfen nicht geändert werden.';
 end if;
end $$;

create function private.suite_trainer_name_sync() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 update public.social_admins set first_name=new.first_name,last_name=new.last_name where person_id=new.person_id
  and (first_name,last_name) is distinct from (new.first_name,new.last_name);
 return new;
end $$;
create trigger suite_trainer_name_sync after update of first_name,last_name on private.trainer_profiles for each row execute function private.suite_trainer_name_sync();
revoke all on function private.suite_trainer_name_sync() from public,anon,authenticated;
grant execute on function private.suite_trainer_name_sync() to service_role;

create or replace function private.suite_users_request_base(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare act text:=payload->>'action'; member public.social_admins; target public.social_admins; selected uuid[]; target_role text; extras text[]; areas text[]; role_row public.social_suite_roles; roles jsonb; operation text; ids jsonb;
begin
 if act='identity' then
  select * into member from public.social_admins where user_id=actor and is_active and not is_blocked;
  if not found then return jsonb_build_object('error','not_authorized','status',403);end if;
  return (select jsonb_build_object('userId',member.user_id,'personId',member.person_id,'email',case when member.email like '%@suite.bsvnordstern.invalid' then '' else member.email end,'firstName',member.first_name,'lastName',member.last_name,'name',trim(member.first_name||' '||member.last_name),'username',member.username,'role',member.role,'roleKey',member.suite_role_key,'roleLabel',r.label,'accessAreas',member.access_areas,'roleAreas',r.access_areas,'extraAreas',member.extra_access_areas,'birthDate',p.birth_date,'teams',case when member.person_id is not null then private.hall_training_teams(member.person_id) when a.id is not null then private.cashbook_current_teams(a.person_id) else '[]'::jsonb end,'createdAt',member.created_at)
   from public.social_suite_roles r left join private.cashbook_accounts a on a.suite_user_id=member.user_id left join public.social_people p on p.id=coalesce(member.person_id,a.person_id) where r.key=member.suite_role_key);
 end if;
 -- Serialize admin changes, so concurrent demotions/deletions cannot remove the last admin.
 perform pg_advisory_xact_lock(1956,1101);
 select * into member from public.social_admins where user_id=actor and is_active and not is_blocked and role='admin' for update;
 if not found then return jsonb_build_object('error','Nur Super-Admins verwalten Benutzer und Rollen.','status',403);end if;
 if act='roles' then return jsonb_build_object('roles',(select jsonb_agg(to_jsonb(r) order by r.label) from public.social_suite_roles r));
 elsif act='save_role' then
  select * into role_row from public.social_suite_roles where key=payload->>'key' for update;
  if not found then return jsonb_build_object('error','Rolle wurde nicht gefunden.','status',404);end if;
  if role_row.protected then return jsonb_build_object('error','Die Super-Admin-Rolle bleibt unveränderlich.','status',403);end if;
  select coalesce(array_agg(distinct a),'{}'::text[]) into areas from jsonb_array_elements_text(payload->'accessAreas') a;
  if 'user_management'=any(areas) then return jsonb_build_object('error','Benutzerverwaltung bleibt Super-Admins vorbehalten.','status',403);end if;
  update public.social_suite_roles set access_areas=areas,updated_at=now() where key=role_row.key;
  update public.social_admins set suite_role_key=suite_role_key where suite_role_key=role_row.key;
 elsif act in ('save_member','create_member') then
  target_role:=payload->>'roleKey';
  select * into role_row from public.social_suite_roles where key=target_role;
  if not found then return jsonb_build_object('error','Rolle wurde nicht gefunden.','status',400);end if;
  if (payload->>'userId')::uuid=actor then return jsonb_build_object('error','Der eigene Super-Admin-Zugang kann hier nicht verändert werden.','status',403);end if;
  select coalesce(array_agg(distinct a),'{}'::text[]) into extras from jsonb_array_elements_text(payload->'extraAreas') a where a<>all(role_row.access_areas);
  if 'user_management'=any(extras) then return jsonb_build_object('error','Benutzerverwaltung bleibt Super-Admins vorbehalten.','status',403);end if;
  select * into target from public.social_admins where user_id=(payload->>'userId')::uuid;
  if coalesce(payload->>'username','') !~ '^[a-z]{2,30}$' or (not (act='save_member' and target.first_name='' and target.last_name='' and coalesce(payload->>'firstName','')='' and coalesce(payload->>'lastName','')='') and (coalesce(length(trim(payload->>'firstName')),0)<1 or coalesce(length(trim(payload->>'lastName')),0)<1)) then return jsonb_build_object('error','Vorname, Nachname und ein Login aus 2 bis 30 Buchstaben sind erforderlich.','status',400);end if;
  if act='create_member' then
   insert into public.social_admins(user_id,email,role,is_active,first_name,last_name,username,suite_role_key,extra_access_areas,access_areas,person_id)
    values((payload->>'userId')::uuid,payload->>'email',case when target_role='admin' then 'admin' else 'sm-team' end,coalesce((payload->>'isActive')::boolean,true),trim(payload->>'firstName'),trim(payload->>'lastName'),payload->>'username',target_role,extras,role_row.access_areas||extras,nullif(payload->>'personId','')::uuid);
  else
   update public.social_admins set first_name=trim(payload->>'firstName'),last_name=trim(payload->>'lastName'),username=payload->>'username',suite_role_key=target_role,extra_access_areas=extras where user_id=(payload->>'userId')::uuid;
   if not found then return jsonb_build_object('error','Benutzer wurde nicht gefunden.','status',404);end if;
  end if;
  -- Keep the cashbook alias in sync; immutable ledger names/timestamps stay untouched.
  update private.cashbook_accounts set username=payload->>'username' where suite_user_id=(payload->>'userId')::uuid;
  update public.social_people set display_name=trim(payload->>'firstName')||' '||trim(payload->>'lastName') where id=(select person_id from private.cashbook_accounts where suite_user_id=(payload->>'userId')::uuid);
 elsif act in ('bulk_state','prepare_delete') then
  select array_agg(distinct id::uuid) into selected from jsonb_array_elements_text(payload->'userIds') id;
  if coalesce(cardinality(selected),0)<1 or cardinality(selected)>100 then return jsonb_build_object('error','Bitte 1 bis 100 Benutzer auswählen.','status',400);end if;
  if actor=any(selected) then return jsonb_build_object('error','Der eigene Super-Admin-Zugang kann nicht ausgewählt werden.','status',403);end if;
  if (select count(*) from public.social_admins where user_id=any(selected))<>cardinality(selected) then return jsonb_build_object('error','Die Auswahl ist veraltet. Bitte neu laden.','status',409);end if;
  operation:=case when act='prepare_delete' then 'delete' else payload->>'operation' end;
  if operation not in ('activate','deactivate','block','unblock','delete') then return jsonb_build_object('error','Unbekannte Benutzeraktion.','status',400);end if;
  update public.social_admins set is_active=case when operation in ('deactivate','block','delete') then false when operation in ('activate','unblock') then true else is_active end,
   is_blocked=operation in ('block','delete') where user_id=any(selected);
  return jsonb_build_object('ok',true,'userIds',to_jsonb(selected));
 else return jsonb_build_object('error','Unbekannte Benutzeraktion.','status',400);end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.hall_training_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 member public.social_admins; target public.social_admins; day private.hall_training_days; booking private.hall_training_bookings;
 act text:=payload->>'action'; is_admin boolean; own_person uuid; person uuid; trainer_user uuid; trainer_name text;
 start_value integer; end_value integer; block_value integer; date_value date; selected_team uuid; team_name text; result jsonb; trainers jsonb;
begin
 select * into member from public.social_admins where user_id=actor for share;
 if not found or not member.is_active or member.is_blocked or (member.role<>'admin' and not 'hall_training'=any(member.access_areas)) then
  return jsonb_build_object('error','Keine Berechtigung für Hallentraining.','status',403);
 end if;
 is_admin:=member.role='admin';
 own_person:=member.person_id;
 if act='list' then
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'date',d.date,'startMinute',d.start_minute,'endMinute',d.end_minute,'blockMinutes',d.block_minutes,'version',d.version,
   'slots',(select coalesce(jsonb_agg(jsonb_build_object('startMinute',s,'endMinute',s+d.block_minutes,
    'past',d.date::timestamp+s*interval '1 minute'<=clock_timestamp() at time zone 'Europe/Berlin',
    'bookingId',b.id,'teamId',b.team_id,'teamName',coalesce(t.name,b.team_name),'trainerName',b.trainer_name,'own',coalesce(b.trainer_user_id=actor or b.trainer_person_id=own_person,false)) order by s),'[]')
    from generate_series(d.start_minute,d.end_minute-d.block_minutes,d.block_minutes) s
    left join private.hall_training_bookings b on b.day_id=d.id and b.start_minute=s left join public.social_teams t on t.id=b.team_id)) order by d.date),'[]') into result from private.hall_training_days d;
  if is_admin then
   select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') into trainers from (
    select p.person_id as "personId",null::uuid as "userId",trim(p.first_name||' '||p.last_name) as name,private.hall_training_teams(p.person_id) as teams from private.trainer_profiles p where p.active
    union all
    select null::uuid,m.user_id,coalesce(nullif(trim(m.first_name||' '||m.last_name),''),m.username),private.hall_training_teams(m.person_id) from public.social_admins m
     where m.is_active and not m.is_blocked and m.suite_role_key='trainer'
     and not exists(select 1 from private.trainer_profiles p where p.person_id=m.person_id)
   ) t;
  end if;
  return jsonb_build_object('hall','BSZ','hallName','Berufsschulzentrum','admin',is_admin,'days',result,'trainers',coalesce(trainers,'[]'),'teams',private.hall_training_teams(own_person,is_admin));
 end if;
 if act in ('save_day','delete_day') and not is_admin then return jsonb_build_object('error','Nur Admins verwalten Trainingstage.','status',403);end if;
 if act='save_day' then
  date_value:=(payload->>'date')::date;start_value:=(payload->>'startMinute')::integer;end_value:=(payload->>'endMinute')::integer;block_value:=(payload->>'blockMinutes')::integer;
  if date_value is null or start_value is null or end_value is null or block_value is null or start_value not between 0 and 1439 or end_value not between 1 and 1439 or end_value<=start_value or block_value not between 15 and 720 then
   return jsonb_build_object('error','Bitte Datum, Start, Ende und Blocklänge prüfen.','status',400);
  end if;
  if (end_value-start_value)%block_value<>0 then return jsonb_build_object('error','Die Blocklänge muss den Zeitraum vollständig aufteilen.','status',400);end if;
  if nullif(payload->>'dayId','') is null then
   insert into private.hall_training_days(date,start_minute,end_minute,block_minutes) values(date_value,start_value,end_value,block_value) returning * into day;
  else
   select * into day from private.hall_training_days where id=(payload->>'dayId')::uuid for update;
   if not found then return jsonb_build_object('error','Trainingstag nicht gefunden.','status',404);end if;
   if day.version is distinct from (payload->>'version')::integer then return jsonb_build_object('error','Der Trainingstag wurde geändert. Bitte neu laden.','status',409);end if;
   if (day.date,day.start_minute,day.end_minute,day.block_minutes) is distinct from (date_value,start_value,end_value,block_value)
    and exists(select 1 from private.hall_training_bookings where day_id=day.id) then
    return jsonb_build_object('error','Bitte zuerst die bestehenden Buchungen freigeben, bevor Datum oder Zeitblöcke geändert werden.','status',409);
   end if;
   update private.hall_training_days set date=date_value,start_minute=start_value,end_minute=end_value,block_minutes=block_value,version=version+1 where id=day.id returning * into day;
  end if;
 elsif act in ('delete_day','book','release') then
  -- All operations on a day lock the same row, including timetable edits and cancellations.
  select * into day from private.hall_training_days where id=(payload->>'dayId')::uuid for update;
  if not found then return jsonb_build_object('error','Trainingstag nicht gefunden.','status',404);end if;
  if act='delete_day' then
   if day.version is distinct from (payload->>'version')::integer then return jsonb_build_object('error','Der Trainingstag wurde geändert. Bitte neu laden.','status',409);end if;
   if exists(select 1 from private.hall_training_bookings where day_id=day.id) then return jsonb_build_object('error','Bitte zuerst die Buchungen dieses Tages freigeben.','status',409);end if;
   delete from private.hall_training_days where id=day.id;
  elsif act='release' then
   select * into booking from private.hall_training_bookings where id=(payload->>'bookingId')::uuid and day_id=day.id;
   if not found then return jsonb_build_object('error','Diese Buchung besteht nicht mehr. Bitte neu laden.','status',409);end if;
   if not is_admin and not coalesce(booking.trainer_user_id=actor or booking.trainer_person_id=own_person,false) then return jsonb_build_object('error','Du kannst nur eigene Buchungen freigeben.','status',403);end if;
   delete from private.hall_training_bookings where id=booking.id;
  else
   start_value:=(payload->>'startMinute')::integer;
   if day.version is distinct from (payload->>'version')::integer then return jsonb_build_object('error','Die Zeitblöcke wurden geändert. Bitte neu laden.','status',409);end if;
   if start_value is null or start_value<day.start_minute or start_value+day.block_minutes>day.end_minute or (start_value-day.start_minute)%day.block_minutes<>0 then return jsonb_build_object('error','Ungültiger Zeitblock.','status',400);end if;
   if day.date::timestamp+start_value*interval '1 minute'<=clock_timestamp() at time zone 'Europe/Berlin' then return jsonb_build_object('error','Vergangene Zeitblöcke können nicht gebucht werden.','status',400);end if;
   if exists(select 1 from private.hall_training_bookings where day_id=day.id and start_minute=start_value) then return jsonb_build_object('error','Dieser Zeitblock wurde bereits gebucht. Bitte neu laden.','status',409);end if;
   if not is_admin and (nullif(payload->>'trainerPersonId','') is not null or nullif(payload->>'trainerUserId','') is not null) then return jsonb_build_object('error','Nur Admins dürfen für andere Trainer buchen.','status',403);end if;
   person:=nullif(payload->>'trainerPersonId','')::uuid;trainer_user:=nullif(payload->>'trainerUserId','')::uuid;
   if person is not null and trainer_user is not null then return jsonb_build_object('error','Bitte genau einen Trainer auswählen.','status',400);end if;
   if person is not null then
    select trim(p.first_name||' '||p.last_name) into trainer_name from private.trainer_profiles p where p.person_id=person and p.active for share;
    if not found then return jsonb_build_object('error','Dieser Trainer ist nicht aktiv.','status',400);end if;
    select m.user_id into trainer_user from public.social_admins m where m.person_id=person;
   else
    trainer_user:=coalesce(trainer_user,actor);
    select * into target from public.social_admins where user_id=trainer_user and is_active and not is_blocked for share;
    if not found or (trainer_user<>actor and target.suite_role_key<>'trainer') then return jsonb_build_object('error','Dieser Trainerzugang ist nicht aktiv.','status',400);end if;
    person:=target.person_id;
    if person is not null and exists(select 1 from private.trainer_profiles p where p.person_id=person and not p.active) then return jsonb_build_object('error','Dieser Trainer ist nicht aktiv.','status',400);end if;
    trainer_name:=coalesce(nullif(trim(target.first_name||' '||target.last_name),''),target.username,'Trainer');
   end if;
   selected_team:=nullif(payload->>'teamId','')::uuid;
   if selected_team is null then return jsonb_build_object('error','Bitte eine Mannschaft auswählen.','status',400);end if;
   select t.name into team_name from public.social_teams t where t.id=selected_team and t.trainer_managed for share;
   if not found then return jsonb_build_object('error','Diese Mannschaft ist nicht für das Hallentraining verfügbar.','status',400);end if;
   if not is_admin and not exists(select 1 from public.social_team_people tp where tp.team_id=selected_team and tp.person_id=person and tp.staff_slot is not null) then
    return jsonb_build_object('error','Du kannst nur für deine zugeordneten Mannschaften buchen.','status',403);
   end if;
   insert into private.hall_training_bookings(day_id,start_minute,trainer_user_id,trainer_person_id,trainer_name,created_by,team_id,team_name) values(day.id,start_value,trainer_user,person,trainer_name,actor,selected_team,team_name) returning * into booking;
  end if;
 else return jsonb_build_object('error','Unbekannte Hallentraining-Aktion.','status',400);
 end if;
 return jsonb_build_object('ok',true,'dayId',day.id,'bookingId',booking.id);
exception
 when unique_violation then return jsonb_build_object('error','Dieser Tag oder Zeitblock ist bereits belegt. Bitte neu laden.','status',409);
 when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return jsonb_build_object('error','Bitte gültige Daten eingeben.','status',400);
end $$;

grant select(id,email,raw_app_meta_data) on auth.users to service_role;

-- Operator-created, short-lived jobs. The worker uses Auth Admin; no Auth table writes or invitation emails.
create table private.suite_trainer_account_jobs(
 id uuid primary key default gen_random_uuid(), actor_id uuid not null,
 token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz not null,
 state text not null default 'queued' check(state in ('queued','running','done')),
 plan jsonb not null default '[]', result jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table private.suite_trainer_account_jobs enable row level security;
revoke all on private.suite_trainer_account_jobs from public,anon,authenticated;
grant select,insert,update on private.suite_trainer_account_jobs to service_role;
create function public.suite_trainer_account_job(job_id uuid,token_hash text,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job private.suite_trainer_account_jobs; p private.trainer_profiles; item jsonb; job_plan jsonb:='[]';
 act text:=payload->>'action'; login text; base text; used text[]; suffix integer; result jsonb; new_user uuid;
begin
 select * into job from private.suite_trainer_account_jobs j where j.id=job_id and j.token_hash=suite_trainer_account_job.token_hash and j.expires_at>clock_timestamp() for update;
 if not found or not exists(select 1 from public.social_admins where user_id=job.actor_id and role='admin' and is_active and not is_blocked) then return jsonb_build_object('error','Nicht berechtigt.','status',403);end if;
 if act='claim' then
  if job.state<>'queued' then return jsonb_build_object('error','Auftrag wurde bereits gestartet.','status',409);end if;
  perform pg_advisory_xact_lock(1956,1101);
  select coalesce(array_agg(username),'{}') into used from public.social_admins;
  for p in select t.* from private.trainer_profiles t where t.active and not exists(select 1 from public.social_admins m where m.person_id=t.person_id) order by t.last_name,t.first_name,t.person_id loop
   base:=private.cashbook_username(split_part(p.first_name,' ',1)||' '||p.last_name);login:=base;suffix:=0;
   if length(base)<2 then return jsonb_build_object('error','Login kann nicht gebildet werden.','status',400);end if;
   while login=any(used) loop
    if suffix>=676 then return jsonb_build_object('error','Keine freien Logins.','status',409);end if;
    login:=base||chr(97+suffix/26)||chr(97+suffix%26);suffix:=suffix+1;
   end loop;
   used:=array_append(used,login);
   job_plan:=job_plan||jsonb_build_array(jsonb_build_object('personId',p.person_id,'firstName',p.first_name,'lastName',p.last_name,'username',login,'email','trainer-'||p.person_id::text||'@suite.bsvnordstern.invalid'));
  end loop;
  update private.suite_trainer_account_jobs set state='running',plan=job_plan where id=job.id;
  return jsonb_build_object('people',job_plan);
 end if;
 if job.state<>'running' then return jsonb_build_object('error','Auftrag ist nicht aktiv.','status',409);end if;
 if act='finish_person' then
  select value into item from jsonb_array_elements(job.plan) where value->>'personId'=payload->>'personId';
  if item is null then return jsonb_build_object('error','Person fehlt im Auftrag.','status',400);end if;
  select * into p from private.trainer_profiles where person_id=(item->>'personId')::uuid and active for share;
  if not found then return jsonb_build_object('error','Trainer ist nicht aktiv.','status',409);end if;
  new_user:=(payload->>'userId')::uuid;
  if not exists(select 1 from auth.users u where u.id=new_user and u.email=item->>'email' and u.raw_app_meta_data->>'trainer_person_id'=item->>'personId') then
   return jsonb_build_object('error','Auth-Zugang passt nicht zum Trainer.','status',403);
  end if;
  -- A role edit while the job was running must not silently grant financial access.
  if exists(select 1 from public.social_suite_roles where key='trainer' and access_areas<>array['hall_training']::text[]) then return jsonb_build_object('error','Trainer-Rollenrechte wurden geändert.','status',409);end if;
  return public.suite_users_request(job.actor_id,jsonb_build_object('action','create_member','personId',p.person_id,'userId',new_user,'email',item->>'email','firstName',p.first_name,'lastName',p.last_name,'username',item->>'username','roleKey','trainer','extraAreas','[]'::jsonb,'isActive',true));
 elsif act='complete' then
  update private.suite_trainer_account_jobs set state='done',result=payload->'result' where id=job.id;
  return jsonb_build_object('ok',true);
 end if;
 return jsonb_build_object('error','Unbekannte Aktion.','status',400);
exception when unique_violation then return jsonb_build_object('error','Zugang oder Login wurde bereits angelegt.','status',409);
end $$;
revoke all on function public.suite_trainer_account_job(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.suite_trainer_account_job(uuid,text,jsonb) to service_role;
commit;
