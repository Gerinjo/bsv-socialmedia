begin;
-- Shared suite access; only Super-Admins may manage dates or act for another trainer.
alter table public.social_admins drop constraint social_admins_access_areas_check;
alter table public.social_admins drop constraint social_admins_extra_areas_check;
alter table public.social_suite_roles drop constraint social_suite_roles_areas_check;
alter table public.social_admins add constraint social_admins_access_areas_check check(access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','user_management','cashbook','trainer_management','hall_training']::text[]);
alter table public.social_admins add constraint social_admins_extra_areas_check check(extra_access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','cashbook','trainer_management','hall_training']::text[]);
alter table public.social_suite_roles add constraint social_suite_roles_areas_check check(access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','user_management','cashbook','trainer_management','hall_training']::text[]);
update public.social_suite_roles set access_areas=access_areas||'hall_training'::text,updated_at=now() where key in ('admin','trainer','youth-leadership') and not 'hall_training'=any(access_areas);
update public.social_admins set suite_role_key=suite_role_key;

create table private.hall_training_days (
 id uuid primary key default gen_random_uuid(), hall text not null default 'BSZ' check(hall='BSZ'),
 date date not null unique, start_minute integer not null default 480, end_minute integer not null default 1200,
 block_minutes integer not null default 60, version integer not null default 1,
 check(start_minute between 0 and 1439 and end_minute between 1 and 1439 and end_minute>start_minute),
 check(block_minutes between 15 and 720 and (end_minute-start_minute)%block_minutes=0)
);
create table private.hall_training_bookings (
 id uuid primary key default gen_random_uuid(), day_id uuid not null references private.hall_training_days(id) on delete restrict,
 start_minute integer not null, trainer_user_id uuid, trainer_person_id uuid, trainer_name text not null,
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
 unique(day_id,start_minute)
);
-- Identity snapshots survive profile/account deletion; they are never used as contact data.
create index hall_training_bookings_person_idx on private.hall_training_bookings(trainer_person_id);
create index hall_training_bookings_user_idx on private.hall_training_bookings(trainer_user_id);
alter table private.hall_training_days enable row level security;
alter table private.hall_training_bookings enable row level security;
revoke all on private.hall_training_days,private.hall_training_bookings from public,anon,authenticated;
grant select,insert,update,delete on private.hall_training_days,private.hall_training_bookings to service_role;
insert into private.hall_training_days(date) values
 ('2026-11-07'),('2026-11-21'),('2026-11-28'),('2026-12-05'),('2026-12-12'),('2026-12-19'),('2027-01-17'),('2027-01-24'),('2027-01-31');

create function public.hall_training_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 member public.social_admins; target public.social_admins; day private.hall_training_days; booking private.hall_training_bookings;
 act text:=payload->>'action'; is_admin boolean; own_person uuid; person uuid; trainer_user uuid; trainer_name text;
 start_value integer; end_value integer; block_value integer; date_value date; result jsonb; trainers jsonb;
begin
 select * into member from public.social_admins where user_id=actor for share;
 if not found or not member.is_active or member.is_blocked or (member.role<>'admin' and not 'hall_training'=any(member.access_areas)) then
  return jsonb_build_object('error','Keine Berechtigung für Hallentraining.','status',403);
 end if;
 is_admin:=member.role='admin';
 select a.person_id into own_person from private.cashbook_accounts a where a.suite_user_id=actor;
 if act='list' then
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'date',d.date,'startMinute',d.start_minute,'endMinute',d.end_minute,'blockMinutes',d.block_minutes,'version',d.version,
   'slots',(select coalesce(jsonb_agg(jsonb_build_object('startMinute',s,'endMinute',s+d.block_minutes,
    'past',d.date::timestamp+s*interval '1 minute'<=clock_timestamp() at time zone 'Europe/Berlin',
    'bookingId',b.id,'trainerName',b.trainer_name,'own',coalesce(b.trainer_user_id=actor or b.trainer_person_id=own_person,false)) order by s),'[]')
    from generate_series(d.start_minute,d.end_minute-d.block_minutes,d.block_minutes) s
    left join private.hall_training_bookings b on b.day_id=d.id and b.start_minute=s)) order by d.date),'[]') into result from private.hall_training_days d;
  if is_admin then
   select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') into trainers from (
    select p.person_id as "personId",null::uuid as "userId",trim(p.first_name||' '||p.last_name) as name from private.trainer_profiles p where p.active
    union all
    select null::uuid,m.user_id,coalesce(nullif(trim(m.first_name||' '||m.last_name),''),m.username) from public.social_admins m
     where m.is_active and not m.is_blocked and m.suite_role_key='trainer'
     and not exists(select 1 from private.cashbook_accounts a join private.trainer_profiles p on p.person_id=a.person_id where a.suite_user_id=m.user_id)
   ) t;
  end if;
  return jsonb_build_object('hall','BSZ','hallName','Berufsschulzentrum','admin',is_admin,'days',result,'trainers',coalesce(trainers,'[]'));
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
    select a.suite_user_id into trainer_user from private.cashbook_accounts a where a.person_id=person;
   else
    trainer_user:=coalesce(trainer_user,actor);
    select * into target from public.social_admins where user_id=trainer_user and is_active and not is_blocked for share;
    if not found or (trainer_user<>actor and target.suite_role_key<>'trainer') then return jsonb_build_object('error','Dieser Trainerzugang ist nicht aktiv.','status',400);end if;
    select a.person_id into person from private.cashbook_accounts a where a.suite_user_id=trainer_user;
    if person is not null and exists(select 1 from private.trainer_profiles p where p.person_id=person and not p.active) then return jsonb_build_object('error','Dieser Trainer ist nicht aktiv.','status',400);end if;
    trainer_name:=coalesce(nullif(trim(target.first_name||' '||target.last_name),''),target.username,'Trainer');
   end if;
   insert into private.hall_training_bookings(day_id,start_minute,trainer_user_id,trainer_person_id,trainer_name,created_by) values(day.id,start_value,trainer_user,person,trainer_name,actor) returning * into booking;
  end if;
 else return jsonb_build_object('error','Unbekannte Hallentraining-Aktion.','status',400);
 end if;
 return jsonb_build_object('ok',true,'dayId',day.id,'bookingId',booking.id);
exception
 when unique_violation then return jsonb_build_object('error','Dieser Tag oder Zeitblock ist bereits belegt. Bitte neu laden.','status',409);
 when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return jsonb_build_object('error','Bitte gültige Daten eingeben.','status',400);
end $$;
revoke all on function public.hall_training_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.hall_training_request(uuid,jsonb) to service_role;
commit;
