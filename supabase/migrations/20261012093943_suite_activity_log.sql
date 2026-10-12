begin;
-- Permanent, minimal event snapshots. No foreign key removes attribution with an account.
create table private.suite_activity_log (
 id bigint generated always as identity primary key,
 source_key text not null unique,
 actor_id uuid,
 actor_name text not null,
 actor_login text not null default '',
 category text not null check(category in ('auth','cashbook','trainer_management','user_management')),
 event text not null,
 occurred_at timestamptz not null default clock_timestamp(),
 recorded_at timestamptz not null default clock_timestamp(),
 metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object')
);
create index suite_activity_time_idx on private.suite_activity_log(occurred_at desc,id desc);
create index suite_activity_actor_time_idx on private.suite_activity_log(actor_id,occurred_at desc,id desc);
create index suite_activity_category_time_idx on private.suite_activity_log(category,occurred_at desc,id desc);
alter table private.suite_activity_log enable row level security;
revoke all on private.suite_activity_log from public,anon,authenticated,service_role;
grant select,insert on private.suite_activity_log to service_role;
grant usage,select on sequence private.suite_activity_log_id_seq to service_role;
create trigger suite_activity_immutable before update or delete on private.suite_activity_log
 for each row execute function private.cashbook_immutable();

create function private.suite_activity_append(source text,actor uuid,category text,event text,occurred timestamptz,metadata jsonb,fallback_name text default null)
returns void language sql security invoker set search_path='' as $$
 insert into private.suite_activity_log(source_key,actor_id,actor_name,actor_login,category,event,occurred_at,metadata)
 select source,actor,coalesce(nullif(fallback_name,''),nullif(trim(concat_ws(' ',m.first_name,m.last_name)),''),m.username,'Nicht zugeordnet'),
  coalesce(m.username,''),category,event,coalesce(occurred,clock_timestamp()),metadata
 from (select 1) x left join public.social_admins m on m.user_id=actor
 on conflict(source_key) do nothing
$$;

create function private.suite_activity_cashbook(e private.cashbook_entries) returns void
language plpgsql security invoker set search_path='' as $$
declare prior_amount integer;
begin
 if e.supersedes_entry_id is not null then
  select coalesce(record_amount_cents,amount_cents) into prior_amount from private.cashbook_entries where id=e.supersedes_entry_id;
 end if;
 perform private.suite_activity_append('cashbook:'||e.id,e.created_by_user_id,'cashbook',
  case when e.entry_type='correction' then 'cashbook_corrected' when e.entry_type='cancellation' then 'cashbook_cancelled'
   when e.direction='deposit' then 'cashbook_deposit' when e.direction='withdrawal' then 'cashbook_withdrawal' else 'cashbook_advance' end,
  e.created_at,jsonb_strip_nulls(jsonb_build_object('bookingSequence',e.sequence,'teamName',e.team_name,
   'amountCents',coalesce(e.record_amount_cents,e.amount_cents),'previousAmountCents',prior_amount,
   'safeDeltaCents',case e.direction when 'deposit' then e.amount_cents when 'withdrawal' then -e.amount_cents else 0 end,
   'balanceAfterCents',e.balance_after_cents)),e.person_name);
end $$;
create function private.suite_activity_settlement(e private.cashbook_settlement_events) returns void
language plpgsql security invoker set search_path='' as $$
declare booking private.cashbook_entries;
begin
 select * into booking from private.cashbook_entries where id=e.entry_id;
 perform private.suite_activity_append('settlement:'||e.id,e.actor_user_id,'cashbook',
  case e.action when 'mark_transferred' then 'cashbook_transferred' else 'cashbook_received' end,e.created_at,
  jsonb_build_object('bookingSequence',booking.sequence,'teamName',booking.team_name,'subjectName',booking.person_name,
   'amountCents',coalesce(booking.record_amount_cents,booking.amount_cents)),e.actor_name);
end $$;
create function private.suite_activity_trainer(e private.trainer_audit) returns void
language plpgsql security invoker set search_path='' as $$
declare person_name text;team_name text;event_name text;
begin
 select coalesce(nullif(trim(concat_ws(' ',e.after_data->>'first_name',e.after_data->>'last_name')),''),
  nullif(trim(concat_ws(' ',e.before_data->>'first_name',e.before_data->>'last_name')),''),p.display_name) into person_name
 from (select 1) x left join public.social_people p on p.id=e.person_id;
 select name into team_name from public.social_teams where id=e.team_id;
 event_name:=case e.action when 'save_person' then case when e.before_data is null then 'trainer_created' else 'trainer_updated' end
  when 'save_photo' then 'trainer_photo' when 'save_team' then 'trainer_team' when 'delete_person' then 'trainer_deleted'
  when 'set_active' then case when e.after_data->>'active'='true' then 'trainer_activated' else 'trainer_passive' end
  when 'onboarding_import' then 'trainer_onboarding' else 'trainer_updated' end;
 perform private.suite_activity_append('trainer:'||e.id,e.actor,'trainer_management',event_name,e.created_at,
  jsonb_strip_nulls(jsonb_build_object('subjectName',person_name,'teamName',team_name)),
  case when e.action='onboarding_import' and e.actor is null then 'Homepage-Onboarding' else null end);
end $$;
create function private.suite_activity_capture() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='cashbook_entries' then perform private.suite_activity_cashbook(new);
 elsif tg_table_name='cashbook_settlement_events' then perform private.suite_activity_settlement(new);
 elsif tg_table_name='trainer_audit' then perform private.suite_activity_trainer(new);end if;
 return new;
end $$;
create trigger suite_activity_capture after insert on private.cashbook_entries for each row execute function private.suite_activity_capture();
create trigger suite_activity_capture after insert on private.cashbook_settlement_events for each row execute function private.suite_activity_capture();
create trigger suite_activity_capture after insert on private.trainer_audit for each row execute function private.suite_activity_capture();
-- Import real recorded history; never infer old logins from a user's last-seen date.
select private.suite_activity_cashbook(e) from private.cashbook_entries e order by e.created_at,e.sequence;
select private.suite_activity_settlement(e) from private.cashbook_settlement_events e order by e.created_at,e.id;
select private.suite_activity_trainer(e) from private.trainer_audit e order by e.created_at,e.id;

-- Called only from the verified JWT claims at bootstrap, never from client event data.
create function public.suite_record_login(actor uuid,session_id uuid,signed_in_at timestamptz default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.social_admins where user_id=actor and is_active and not is_blocked) then return jsonb_build_object('error','not_authorized','status',403);end if;
 if session_id is null or signed_in_at>clock_timestamp()+interval '5 minutes' then return jsonb_build_object('error','invalid_session','status',400);end if;
 perform private.suite_activity_append('session:'||session_id,actor,'auth',case when signed_in_at is null then 'session_opened' else 'login' end,signed_in_at,'{}');
 return jsonb_build_object('ok',true);
end $$;

-- Keep the established permission checks and writes; add audit events in the same transaction.
alter function public.suite_users_request(uuid,jsonb) set schema private;
alter function private.suite_users_request(uuid,jsonb) rename to suite_users_request_base;
create function public.suite_users_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;act text:=payload->>'action';target record;targets jsonb;meta jsonb;event_name text;prepared private.suite_activity_log;deleted_id uuid;
begin
 if act='finish_delete' then
  perform pg_advisory_xact_lock(1956,1101);
  if not exists(select 1 from public.social_admins where user_id=actor and is_active and not is_blocked and role='admin') then return jsonb_build_object('error','admin_only','status',403);end if;
  deleted_id:=(payload->>'userId')::uuid;
  if deleted_id=actor or deleted_id is null then return jsonb_build_object('error','invalid_user','status',400);end if;
  select * into prepared from private.suite_activity_log where actor_id=actor and event='user_delete_prepared' and metadata->>'subjectId'=deleted_id::text order by id desc limit 1;
  if not found then return jsonb_build_object('error','delete_not_prepared','status',409);end if;
  delete from public.social_admins where user_id=deleted_id;
  perform private.suite_activity_append('user_deleted:'||deleted_id,actor,'user_management','user_deleted',clock_timestamp(),prepared.metadata);
  return jsonb_build_object('ok',true);
 end if;
 -- Snapshot targets before Auth deletion or name changes can remove their labels.
 if act in ('save_member','bulk_state','prepare_delete') then
  select jsonb_agg(jsonb_build_object('subjectId',m.user_id,'subjectName',coalesce(nullif(trim(concat_ws(' ',m.first_name,m.last_name)),''),m.username),'subjectLogin',m.username)) into targets
   from public.social_admins m where (act='save_member' and m.user_id::text=payload->>'userId')
    or (act in ('bulk_state','prepare_delete') and payload->'userIds' ? m.user_id::text);
 end if;
 result:=private.suite_users_request_base(actor,payload);
 if result ? 'error' or act in ('identity','roles') then return result;end if;
 if act='save_role' then
  perform private.suite_activity_append('user_action:'||gen_random_uuid(),actor,'user_management','role_updated',clock_timestamp(),
   jsonb_build_object('subjectName',(select label from public.social_suite_roles where key=payload->>'key'),'accessAreas',(select to_jsonb(access_areas) from public.social_suite_roles where key=payload->>'key')));
 elsif act='create_member' then
  perform private.suite_activity_append('user_action:'||gen_random_uuid(),actor,'user_management','user_created',clock_timestamp(),
   jsonb_build_object('subjectId',payload->>'userId','subjectName',trim(concat_ws(' ',payload->>'firstName',payload->>'lastName')),'subjectLogin',payload->>'username'));
 else
  event_name:=case act when 'save_member' then 'user_updated' when 'prepare_delete' then 'user_delete_prepared'
   else case payload->>'operation' when 'activate' then 'user_activated' when 'deactivate' then 'user_deactivated' when 'block' then 'user_blocked' when 'unblock' then 'user_unblocked' else 'user_updated' end end;
  for meta in select value from jsonb_array_elements(coalesce(targets,'[]')) loop
   perform private.suite_activity_append('user_action:'||gen_random_uuid(),actor,'user_management',event_name,clock_timestamp(),meta);
  end loop;
 end if;
 return result;
end $$;

create function public.suite_activity_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare filter_actor uuid;filter_category text:=nullif(payload->>'category','');filter_system boolean:=payload->>'userId'='system';
 from_time timestamptz;until_time timestamptz;cursor_time timestamptz;cursor_id bigint;page_size integer:=50;rows jsonb;people jsonb;
begin
 if not exists(select 1 from public.social_admins where user_id=actor and is_active and not is_blocked and role='admin') then return jsonb_build_object('error','Nur Super-Admins dürfen das Aktivitätsprotokoll ansehen.','status',403);end if;
 if filter_category is not null and filter_category not in ('auth','cashbook','trainer_management','user_management') then return jsonb_build_object('error','Ungültiger Bereich.','status',400);end if;
 if not coalesce(filter_system,false) then filter_actor:=nullif(payload->>'userId','')::uuid;end if;
 if nullif(payload->>'from','') is not null then
  if payload->>'from' !~ '^\d{4}-\d{2}-\d{2}$' then raise invalid_datetime_format;end if;
  from_time:=((payload->>'from')::date)::timestamp at time zone 'Europe/Berlin';
 end if;
 if nullif(payload->>'until','') is not null then
  if payload->>'until' !~ '^\d{4}-\d{2}-\d{2}$' then raise invalid_datetime_format;end if;
  until_time:=((payload->>'until')::date+1)::timestamp at time zone 'Europe/Berlin';
 end if;
 if from_time is not null and until_time is not null and from_time>=until_time then return jsonb_build_object('error','Bitte einen gültigen Zeitraum auswählen.','status',400);end if;
 if payload->'cursor' is not null and payload->'cursor'<>'null'::jsonb then
  cursor_time:=(payload->'cursor'->>'at')::timestamptz;cursor_id:=(payload->'cursor'->>'id')::bigint;
  if cursor_time is null or cursor_id is null then return jsonb_build_object('error','Ungültige Folgeseite.','status',400);end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id::text,'occurredAt',occurred_at,'actorId',actor_id,'actorName',actor_name,'actorLogin',actor_login,
  'category',category,'event',event,'metadata',metadata) order by occurred_at desc,id desc),'[]') into rows
 from (select * from private.suite_activity_log l where (filter_actor is null or actor_id=filter_actor)
  and (not coalesce(filter_system,false) or actor_id is null) and (filter_category is null or category=filter_category)
  and (from_time is null or occurred_at>=from_time) and (until_time is null or occurred_at<until_time)
  and (cursor_time is null or (occurred_at,id)<(cursor_time,cursor_id)) order by occurred_at desc,id desc limit page_size+1) p;
 select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',name,'login',login) order by name,login),'[]') into people from (
  select user_id,name,login from (
   select user_id,coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),username,email) name,coalesce(username,'') login from public.social_admins
   union all
   select actor_id,actor_name,actor_login from (select distinct on(actor_id) actor_id,actor_name,actor_login from private.suite_activity_log where actor_id is not null and not exists(select 1 from public.social_admins where user_id=actor_id) order by actor_id,occurred_at desc,id desc) past_people
  ) all_people
 ) persons;
 return jsonb_build_object('entries',case when jsonb_array_length(rows)>page_size then rows-(page_size) else rows end,
  'nextCursor',case when jsonb_array_length(rows)>page_size then jsonb_build_object('id',rows->(page_size-1)->>'id','at',rows->(page_size-1)->>'occurredAt') else null end,'people',people);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 return jsonb_build_object('error','Bitte gültige Filter auswählen.','status',400);
end $$;

revoke all on function private.suite_activity_append(text,uuid,text,text,timestamptz,jsonb,text),private.suite_activity_cashbook(private.cashbook_entries),private.suite_activity_settlement(private.cashbook_settlement_events),private.suite_activity_trainer(private.trainer_audit),private.suite_activity_capture(),private.suite_users_request_base(uuid,jsonb),public.suite_users_request(uuid,jsonb),public.suite_record_login(uuid,uuid,timestamptz),public.suite_activity_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.suite_activity_append(text,uuid,text,text,timestamptz,jsonb,text),private.suite_activity_cashbook(private.cashbook_entries),private.suite_activity_settlement(private.cashbook_settlement_events),private.suite_activity_trainer(private.trainer_audit),private.suite_activity_capture(),private.suite_users_request_base(uuid,jsonb),public.suite_users_request(uuid,jsonb),public.suite_record_login(uuid,uuid,timestamptz),public.suite_activity_request(uuid,jsonb) to service_role;
commit;
