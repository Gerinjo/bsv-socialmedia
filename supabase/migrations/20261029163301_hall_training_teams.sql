begin;
alter table private.hall_training_bookings
 add column team_id uuid references public.social_teams(id) on delete set null,
 add column team_name text;
create index hall_training_bookings_team_idx on private.hall_training_bookings(team_id);

create function private.hall_training_teams(person uuid,all_teams boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.sort_order,t.name),'[]'::jsonb)
 from public.social_teams t where t.trainer_managed and (all_teams or exists(
  select 1 from public.social_team_people tp where tp.team_id=t.id and tp.person_id=person and tp.staff_slot is not null
 ))
$$;
revoke all on function private.hall_training_teams(uuid,boolean) from public,anon,authenticated;
grant execute on function private.hall_training_teams(uuid,boolean) to service_role;

-- Only infer a historical team when the coach has exactly one assignment.
with candidates as (
 select b.id,min(t.id::text)::uuid as team_id,min(t.name) as team_name from private.hall_training_bookings b
 join public.social_team_people tp on tp.person_id=coalesce(b.trainer_person_id,(select a.person_id from private.cashbook_accounts a where a.suite_user_id=b.trainer_user_id)) and tp.staff_slot is not null
 join public.social_teams t on t.id=tp.team_id and t.trainer_managed
 group by b.id having count(distinct t.id)=1
)
update private.hall_training_bookings b set team_id=c.team_id,team_name=c.team_name from candidates c where b.id=c.id;

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
 select a.person_id into own_person from private.cashbook_accounts a where a.suite_user_id=actor;
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
    select null::uuid,m.user_id,coalesce(nullif(trim(m.first_name||' '||m.last_name),''),m.username),private.hall_training_teams((select a.person_id from private.cashbook_accounts a where a.suite_user_id=m.user_id)) from public.social_admins m
     where m.is_active and not m.is_blocked and m.suite_role_key='trainer'
     and not exists(select 1 from private.cashbook_accounts a join private.trainer_profiles p on p.person_id=a.person_id where a.suite_user_id=m.user_id)
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
    select a.suite_user_id into trainer_user from private.cashbook_accounts a where a.person_id=person;
   else
    trainer_user:=coalesce(trainer_user,actor);
    select * into target from public.social_admins where user_id=trainer_user and is_active and not is_blocked for share;
    if not found or (trainer_user<>actor and target.suite_role_key<>'trainer') then return jsonb_build_object('error','Dieser Trainerzugang ist nicht aktiv.','status',400);end if;
    select a.person_id into person from private.cashbook_accounts a where a.suite_user_id=trainer_user;
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
commit;
