begin;
alter table public.social_admins drop constraint social_admins_access_areas_check;
alter table public.social_admins drop constraint social_admins_extra_areas_check;
alter table public.social_suite_roles drop constraint social_suite_roles_areas_check;
alter table public.social_admins add constraint social_admins_access_areas_check check(access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','user_management','cashbook','trainer_management','hall_training','resources']::text[]);
alter table public.social_admins add constraint social_admins_extra_areas_check check(extra_access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','cashbook','trainer_management','hall_training','resources']::text[]);
alter table public.social_suite_roles add constraint social_suite_roles_areas_check check(access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','user_management','cashbook','trainer_management','hall_training','resources']::text[]);
update public.social_suite_roles set access_areas=access_areas||'resources'::text,updated_at=now() where key in ('admin','trainer','youth-leadership') and not 'resources'=any(access_areas);
update public.social_admins set suite_role_key=suite_role_key;
-- Keep the existing account-provisioning guard aligned with the new non-financial trainer right.
do $guard$
declare definition text;
begin
 if to_regprocedure('public.suite_trainer_account_job(uuid,text,jsonb)') is not null then
  definition:=pg_get_functiondef('public.suite_trainer_account_job(uuid,text,jsonb)'::regprocedure);
  if position('access_areas<>array[''hall_training'']::text[]' in definition)=0 then raise exception 'Trainer-Rollenschutz wurde geändert. Ressourcenmigration bitte prüfen.';end if;
  execute replace(definition,'access_areas<>array[''hall_training'']::text[]','access_areas<>array[''hall_training'',''resources'']::text[]');
 end if;
end $guard$;
create table private.club_resources (
 id uuid primary key default gen_random_uuid(),slug text not null unique,name text not null,
 active boolean not null default true,origin_address text not null,origin_lon numeric not null,origin_lat numeric not null
);
insert into private.club_resources(slug,name,origin_address,origin_lon,origin_lat) values('bus','Vereinsbus','Schlesierstraße 43, 78315 Radolfzell am Bodensee',8.9700514,47.7543133);
create table private.resource_matches (
 id text primary key,team_id uuid not null references public.social_teams(id) on delete cascade,source_match_id text not null,
 kickoff_at timestamptz not null,home_team text not null,away_team text not null,status text not null,
 is_home boolean not null,venue text,source_url text not null,match_minutes integer not null default 105,
 fetched_at timestamptz not null default now(),unique(team_id,source_match_id)
);
create index resource_matches_date_idx on private.resource_matches(kickoff_at,team_id);
create table private.resource_sync_state(team_id uuid primary key references public.social_teams(id) on delete cascade,last_attempt timestamptz not null default now(),last_success timestamptz,error text);
alter table private.resource_sync_state enable row level security;
revoke all on private.resource_sync_state from public,anon,authenticated;
grant select,insert,update,delete on private.resource_sync_state to service_role;
create table private.resource_route_cache (key text primary key,route jsonb not null,created_at timestamptz not null default now());
create table private.resource_provider_clock(provider text primary key,next_at timestamptz not null default now());
insert into private.resource_provider_clock(provider) values('routing'),('geocoding'),('sync');
create table private.resource_bookings (
 id uuid primary key default gen_random_uuid(),resource_id uuid not null references private.club_resources(id),
 team_id uuid not null references public.social_teams(id),match_id text references private.resource_matches(id) on delete restrict,
 match_kickoff timestamptz,starts_at timestamptz not null,ends_at timestamptz not null,
 destination text not null default '',route jsonb,note text not null default '' check(length(note)<=500),
 created_by uuid not null,created_by_name text not null,created_at timestamptz not null default now(),
 cancelled_at timestamptz,cancelled_by uuid,check(ends_at>starts_at and ends_at-starts_at<=interval '72 hours')
);
create index resource_bookings_active_idx on private.resource_bookings(resource_id,starts_at,ends_at) where cancelled_at is null;
create index resource_bookings_team_idx on private.resource_bookings(team_id);
create index resource_bookings_match_idx on private.resource_bookings(match_id) where match_id is not null;
alter table private.club_resources enable row level security;
alter table private.resource_matches enable row level security;
alter table private.resource_route_cache enable row level security;
alter table private.resource_provider_clock enable row level security;
alter table private.resource_bookings enable row level security;
revoke all on private.club_resources,private.resource_matches,private.resource_route_cache,private.resource_provider_clock,private.resource_bookings from public,anon,authenticated;
grant select,insert,update,delete on private.club_resources,private.resource_matches,private.resource_route_cache,private.resource_provider_clock,private.resource_bookings to service_role;

create function public.resource_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.social_admins; is_admin boolean; person uuid; act text:=payload->>'action';
 team uuid; r private.club_resources; booking_row private.resource_bookings; game private.resource_matches;
 start_value timestamptz; end_value timestamptz; from_date date; to_date date; item jsonb; teams jsonb; own_teams uuid[]; slot_at timestamptz; key_value text;
begin
 select * into m from public.social_admins where user_id=actor for share;
 if not found or not m.is_active or m.is_blocked or (m.role<>'admin' and not 'resources'=any(m.access_areas)) then return jsonb_build_object('error','Keine Berechtigung für die Ressourcenverwaltung.','status',403);end if;
 is_admin:=m.role='admin';person:=m.person_id;
 if person is null then select a.person_id into person from private.cashbook_accounts a where a.suite_user_id=actor;end if;
 select coalesce(array_agg(t.id),'{}') into own_teams from public.social_teams t where t.trainer_managed and (is_admin or exists(
  select 1 from public.social_team_people tp join private.trainer_profiles p on p.person_id=tp.person_id
  where tp.team_id=t.id and tp.person_id=person and tp.staff_slot is not null and p.active));
 if act='authorize' then
  if payload ? 'teamId' and not coalesce((payload->>'teamId')::uuid=any(own_teams),false) then return jsonb_build_object('error','Du kannst nur für deine zugeordneten Mannschaften buchen.','status',403);end if;
  return jsonb_build_object('ok',true);
 elsif act='list' then
  from_date:=(coalesce(payload->>'month',to_char(clock_timestamp() at time zone 'Europe/Berlin','YYYY-MM'))||'-01')::date;
  to_date:=(from_date+interval '1 month')::date;from_date:=from_date-7;to_date:=to_date+7;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug,'canBook',t.id=any(own_teams)) order by t.sort_order,t.name),'[]') into teams from public.social_teams t where t.trainer_managed;
  return jsonb_build_object('admin',is_admin,'teams',teams,
   'resources',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'originAddress',origin_address,'coordinates',jsonb_build_array(origin_lon,origin_lat)) order by name),'[]') from private.club_resources where active),
   'matches',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'teamId',g.team_id,'kickoffAt',g.kickoff_at,'home',g.home_team,'away',g.away_team,'isHome',g.is_home,'status',g.status,'venue',g.venue,'sourceUrl',g.source_url,'matchMinutes',g.match_minutes,'fetchedAt',g.fetched_at,'canBook',g.team_id=any(own_teams)) order by g.kickoff_at),'[]') from private.resource_matches g where g.kickoff_at>=from_date::timestamp at time zone 'Europe/Berlin' and g.kickoff_at<to_date::timestamp at time zone 'Europe/Berlin'),
   'bookings',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'resourceId',b.resource_id,'teamId',b.team_id,'teamName',t.name,'matchId',b.match_id,'matchKickoff',b.match_kickoff,'startsAt',b.starts_at,'endsAt',b.ends_at,'destination',b.destination,'route',b.route,'note',b.note,'trainerName',b.created_by_name,'canManage',is_admin or b.team_id=any(own_teams)) order by b.starts_at),'[]') from private.resource_bookings b join public.social_teams t on t.id=b.team_id where b.cancelled_at is null and b.starts_at<to_date::timestamp at time zone 'Europe/Berlin' and b.ends_at>from_date::timestamp at time zone 'Europe/Berlin'),
   'syncWarnings',(select coalesce(jsonb_agg(t.name||': '||s.error),'[]') from private.resource_sync_state s join public.social_teams t on t.id=s.team_id where s.error is not null),'lastSync',(select max(last_success) from private.resource_sync_state));
 elsif act='_teams' then
  return jsonb_build_object('teams',(select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order),'[]') from public.social_teams t where trainer_managed));
 elsif act='_match' then
  select * into game from private.resource_matches where id=payload->>'matchId';
  if not found then return jsonb_build_object('error','Spiel nicht gefunden. Bitte Spielpläne aktualisieren.','status',404);end if;
  if not game.team_id=any(own_teams) then return jsonb_build_object('error','Dieses Spiel gehört nicht zu deiner Mannschaft.','status',403);end if;
  return jsonb_build_object('match',to_jsonb(game));
 elsif act='_sync_state' then
  insert into private.resource_sync_state(team_id,last_success,error) values((payload->>'teamId')::uuid,case when payload->>'error' is null then clock_timestamp() else null end,payload->>'error')
   on conflict(team_id) do update set last_attempt=clock_timestamp(),last_success=coalesce(excluded.last_success,private.resource_sync_state.last_success),error=excluded.error;
  return jsonb_build_object('ok',true);
 elsif act='_sync' then
  for item in select value from jsonb_array_elements(payload->'matches') loop
   insert into private.resource_matches(id,team_id,source_match_id,kickoff_at,home_team,away_team,status,is_home,venue,source_url,match_minutes,fetched_at)
    values(item->>'id',(item->>'teamId')::uuid,item->>'sourceMatchId',(item->>'kickoffAt')::timestamptz,item->>'home',item->>'away',item->>'status',(item->>'isHome')::boolean,item->>'venue',item->>'sourceUrl',(item->>'matchMinutes')::integer,clock_timestamp())
   on conflict(id) do update set kickoff_at=excluded.kickoff_at,home_team=excluded.home_team,away_team=excluded.away_team,status=excluded.status,is_home=excluded.is_home,venue=coalesce(excluded.venue,private.resource_matches.venue),source_url=excluded.source_url,match_minutes=excluded.match_minutes,fetched_at=excluded.fetched_at;
  end loop;
  return jsonb_build_object('ok',true);
 elsif act='_venue' then
  update private.resource_matches set venue=payload->>'venue' where id=payload->>'matchId';return jsonb_build_object('ok',true);
 elsif act='_provider' then
  select next_at into slot_at from private.resource_provider_clock where provider=payload->>'provider' for update;
  if not found then return jsonb_build_object('error','Unbekannter Routendienst.','status',400);end if;
  if slot_at>clock_timestamp() then return jsonb_build_object('error','Der Routendienst wird gerade verwendet. Bitte gleich erneut versuchen.','status',429);end if;
  update private.resource_provider_clock set next_at=clock_timestamp()+case when provider='sync' then interval '30 seconds' else interval '1.1 seconds' end where provider=payload->>'provider';
  return jsonb_build_object('ok',true);
 elsif act='_route_get' then
  return jsonb_build_object('route',(select route from private.resource_route_cache where key=payload->>'key' and created_at>now()-interval '7 days'));
 elsif act='_route_put' then
  insert into private.resource_route_cache(key,route) values(payload->>'key',payload->'route') on conflict(key) do update set route=excluded.route,created_at=clock_timestamp();return jsonb_build_object('ok',true);
 elsif act in ('book','cancel') then
  select * into r from private.club_resources where id=(payload->>'resourceId')::uuid and active for update;
  if not found then return jsonb_build_object('error','Bus nicht verfügbar.','status',404);end if;
  if act='cancel' then
   select * into booking_row from private.resource_bookings where id=(payload->>'bookingId')::uuid and resource_id=r.id and cancelled_at is null;
   if not found then return jsonb_build_object('error','Die Reservierung besteht nicht mehr.','status',409);end if;
   if not is_admin and not booking_row.team_id=any(own_teams) then return jsonb_build_object('error','Du kannst nur Buchungen deiner Mannschaft freigeben.','status',403);end if;
   update private.resource_bookings set cancelled_at=clock_timestamp(),cancelled_by=actor where id=booking_row.id;return jsonb_build_object('ok',true);
  end if;
  team:=(payload->>'teamId')::uuid;
  if not coalesce(team=any(own_teams),false) then return jsonb_build_object('error','Du kannst nur für deine zugeordneten Mannschaften buchen.','status',403);end if;
  start_value:=(payload->>'startsAt')::timestamptz;end_value:=(payload->>'endsAt')::timestamptz;
  if start_value is null or end_value is null or start_value<=clock_timestamp() or end_value<=start_value or end_value-start_value>interval '72 hours' then return jsonb_build_object('error','Bitte einen zukünftigen Zeitraum von höchstens 72 Stunden wählen.','status',400);end if;
  if nullif(payload->>'matchId','') is not null then
   select * into game from private.resource_matches where id=payload->>'matchId' for share;
   if not found or game.team_id<>team or game.status<>'scheduled' or game.kickoff_at<=now() then return jsonb_build_object('error','Dieses Spiel kann nicht mehr gebucht werden. Bitte aktualisieren.','status',409);end if;
   if (payload->>'expectedKickoff')::timestamptz is distinct from game.kickoff_at then return jsonb_build_object('error','Die Anstoßzeit wurde geändert. Bitte den Zeitraum neu prüfen.','status',409);end if;
   if start_value>game.kickoff_at or end_value<game.kickoff_at then return jsonb_build_object('error','Der Zeitraum muss die Anstoßzeit einschließen.','status',400);end if;
  end if;
  if exists(select 1 from private.resource_bookings b where b.resource_id=r.id and b.cancelled_at is null and b.starts_at<end_value and b.ends_at>start_value) then return jsonb_build_object('error','Der Bus ist in diesem Zeitraum bereits reserviert. Bitte andere Zeiten wählen.','status',409);end if;
  if game.id is not null and exists(select 1 from private.resource_bookings b where b.match_id=game.id and b.cancelled_at is null) then return jsonb_build_object('error','Für dieses Spiel besteht bereits eine Busreservierung.','status',409);end if;
  insert into private.resource_bookings(resource_id,team_id,match_id,match_kickoff,starts_at,ends_at,destination,route,note,created_by,created_by_name)
   values(r.id,team,game.id,game.kickoff_at,start_value,end_value,left(coalesce(payload->>'destination',''),400),
    (select route from private.resource_route_cache where key=payload->>'routeKey' and created_at>now()-interval '7 days'),left(coalesce(payload->>'note',''),500),actor,coalesce(nullif(trim(m.first_name||' '||m.last_name),''),m.username)) returning * into booking_row;
  return jsonb_build_object('ok',true,'bookingId',booking_row.id);
 end if;
 return jsonb_build_object('error','Unbekannte Ressourcen-Aktion.','status',400);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return jsonb_build_object('error','Bitte gültige Buchungsdaten eingeben.','status',400);
end $$;
revoke all on function public.resource_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.resource_request(uuid,jsonb) to service_role;
commit;
