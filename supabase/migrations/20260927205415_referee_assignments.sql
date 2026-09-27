alter table public.social_teams add column referee_enabled boolean not null default true;

-- An assignment is created only for a game explicitly identified as needing a club referee.
alter table public.social_admins drop constraint social_admins_role_check;
alter table public.social_admins add constraint social_admins_role_check check (role in ('admin','sm-team','referee-admin'));
alter table public.social_admins drop constraint social_admins_access_areas_check;
alter table public.social_admins add constraint social_admins_access_areas_check check (
  access_areas <@ array['social_media','sponsoring','editorial','referees','administration','user_management']::text[] and cardinality(access_areas) > 0
);

create table public.referee_assignments (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null unique references public.social_games(id) on delete restrict,
  referee_name text check (referee_name is null or length(trim(referee_name)) between 1 and 160),
  field_size smallint check (field_size in (7,9)),
  assigned_by uuid references public.social_people(id) on delete restrict,
  paid_at timestamptz,
  paid_by uuid,
  paid_game_snapshot jsonb,
  version integer not null default 1,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((referee_name is null and field_size is null and assigned_by is null) or (referee_name is not null and field_size is not null and assigned_by is not null)),
  check ((paid_at is null and paid_by is null and paid_game_snapshot is null) or (paid_at is not null and paid_by is not null and paid_game_snapshot is not null and referee_name is not null))
);
create index referee_assignments_assigned_by_idx on public.referee_assignments(assigned_by);
create index referee_assignments_unpaid_idx on public.referee_assignments(created_at) where paid_at is null;
create table private.referee_login_attempts (
  person_id uuid primary key references public.social_people(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  failures integer not null default 0
);
alter table public.referee_assignments enable row level security;
alter table private.referee_login_attempts enable row level security;
revoke all on public.referee_assignments, private.referee_login_attempts from public, anon, authenticated;
grant select, insert, update on public.referee_assignments, private.referee_login_attempts to service_role;

-- Protect payouts even against accidental writes elsewhere in the suite.
create function private.referee_assignment_guard() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.paid_at is not null then raise exception 'Ausgezahlte Spiele sind gesperrt.'; end if;
  if new.game_id <> old.game_id then raise exception 'Die Spielzuordnung ist unveränderlich.'; end if;
  if new.paid_at is not null and not exists (
    select 1 from public.social_games where id=new.game_id and status='finished' and kickoff_at <= now()
  ) then raise exception 'Nur beendete Spiele können ausgezahlt werden.'; end if;
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end $$;
create trigger referee_assignment_guard before update on public.referee_assignments for each row execute function private.referee_assignment_guard();

-- Invoker functions: callable only by the Edge Functions' service role, never by browser roles.
create function public.referee_coach_request(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  person uuid := (payload->>'personId')::uuid;
  team uuid := (payload->>'teamId')::uuid;
  attempts private.referee_login_attempts;
  record public.referee_assignments;
  game public.social_games;
  records jsonb;
begin
  -- Only known people allocate a rate-limit row. Lock per person to prevent parallel guesses.
  if not exists (select 1 from public.social_people where id=person and active) then
    return jsonb_build_object('error','Die Anmeldung konnte nicht bestätigt werden.','status',403);
  end if;
  insert into private.referee_login_attempts(person_id) values(person) on conflict do nothing;
  select * into attempts from private.referee_login_attempts where person_id=person for update;
  if attempts.window_started_at <= now() - interval '15 minutes' then
    update private.referee_login_attempts set failures=0,window_started_at=now() where person_id=person;
    attempts.failures := 0;
  end if;
  if attempts.failures >= 5 then
    return jsonb_build_object('error','Zu viele Fehlversuche. Bitte nach 15 Minuten erneut versuchen.','status',429);
  end if;
  if not exists (
    select 1 from public.social_people p join public.social_team_people tp on tp.person_id=p.id
    join public.social_teams t on t.id=tp.team_id
    where p.id=person and p.active and t.referee_enabled and tp.team_id=team and tp.role ilike '%trainer%'
      and p.birth_date::text=payload->>'birthDate'
  ) then
    update private.referee_login_attempts set failures=failures+1 where person_id=person;
    -- Return, do not raise: failed attempts must commit.
    return jsonb_build_object('error','Die Anmeldung konnte nicht bestätigt werden.','status',403);
  end if;
  if payload->>'action' = 'save' then
    select g.* into game from public.social_games g join public.referee_assignments a on a.game_id=g.id
      where a.id=(payload->>'id')::uuid and g.team_id=team for update of g;
    if not found then return jsonb_build_object('error','Dieses Spiel gehört nicht zu deiner Mannschaft.','status',403); end if;
    select * into record from public.referee_assignments where id=(payload->>'id')::uuid for update;
    if record.paid_at is not null then return jsonb_build_object('error','Dieses Spiel ist bereits ausgezahlt und gesperrt.','status',409); end if;
    if game.status not in ('scheduled','live','finished') then return jsonb_build_object('error','Dieses Spiel kann derzeit nicht bearbeitet werden.','status',409); end if;
    if (payload->>'version')::integer is distinct from record.version then return jsonb_build_object('error','Das Spiel wurde zwischenzeitlich geändert. Bitte neu laden.','status',409); end if;
    if coalesce(length(trim(payload->>'refereeName')),0) not between 1 and 160
      or coalesce(payload->>'fieldSize','') not in ('7','9') then
      return jsonb_build_object('error','Bitte Schirinamen und 7er- oder 9er-Feld angeben.','status',400);
    end if;
    update public.referee_assignments set referee_name=trim(payload->>'refereeName'),field_size=(payload->>'fieldSize')::smallint,assigned_by=person
      where id=record.id;
  elsif payload->>'action' is distinct from 'list' then
    return jsonb_build_object('error','Unbekannte Aktion.','status',400);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'referee_name',a.referee_name,'field_size',a.field_size,'paid_at',a.paid_at,'version',a.version,
    'game',jsonb_build_object('id',g.id,'home_team',g.home_team,'away_team',g.away_team,'kickoff_at',g.kickoff_at,'status',g.status,'venue',g.venue)
  ) order by g.kickoff_at desc),'[]'::jsonb) into records
  from public.referee_assignments a join public.social_games g on g.id=a.game_id where g.team_id=team;
  return jsonb_build_object('assignments',records);
end $$;

create function public.referee_admin_request(actor uuid, payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  record public.referee_assignments;
  game public.social_games;
  birthdate date;
begin
  if not exists (select 1 from public.social_admins where user_id=actor and is_active
    and (role in ('admin','referee-admin') or (role='sm-team' and 'referees'=any(access_areas)))) then
    return jsonb_build_object('error','Nur Schiedsrichteradmins dürfen diese Aktion ausführen.');
  end if;
  if payload->>'action' = 'referee_register' then
    select * into game from public.social_games where id=(payload->>'gameId')::uuid for update;
    if not found or game.team_id is null or game.status not in ('scheduled','live','finished') then
      return jsonb_build_object('error','Bitte ein Spiel mit BSV-Mannschaft auswählen.');
    end if;
    insert into public.referee_assignments(game_id,created_by) values(game.id,actor) on conflict(game_id) do nothing;
  elsif payload->>'action' = 'referee_pay' then
    select g.* into game from public.social_games g join public.referee_assignments a on a.game_id=g.id
      where a.id=(payload->>'id')::uuid for update of g;
    if not found then return jsonb_build_object('error','Das Spiel wurde nicht gefunden.'); end if;
    select * into record from public.referee_assignments where id=(payload->>'id')::uuid for update;
    if record.paid_at is not null then return jsonb_build_object('error','Die Auszahlung wurde bereits erfasst.'); end if;
    if (payload->>'version')::integer is distinct from record.version then return jsonb_build_object('error','Das Spiel wurde zwischenzeitlich geändert. Bitte neu laden.'); end if;
    if game.status <> 'finished' or game.kickoff_at > now() or record.referee_name is null or record.field_size is null then
      return jsonb_build_object('error','Nur beendete Spiele mit eingetragenem Schiri können ausgezahlt werden.');
    end if;
    update public.referee_assignments set paid_at=clock_timestamp(),paid_by=actor,
      paid_game_snapshot=jsonb_build_object('home_team',game.home_team,'away_team',game.away_team,'kickoff_at',game.kickoff_at,'team_id',game.team_id,'referee_name',record.referee_name,'field_size',record.field_size)
      where id=record.id;
  elsif payload->>'action' = 'referee_birthdate' then
    if not exists (select 1 from public.social_team_people where person_id=(payload->>'personId')::uuid and role ilike '%trainer%') then
      return jsonb_build_object('error','Trainer wurde nicht gefunden.');
    end if;
    begin birthdate := (payload->>'birthDate')::date;
    exception when others then return jsonb_build_object('error','Bitte ein gültiges Geburtsdatum angeben.'); end;
    if birthdate is null or birthdate > current_date or birthdate < date '1900-01-01' then return jsonb_build_object('error','Bitte ein gültiges Geburtsdatum angeben.'); end if;
    update public.social_people set birth_date=birthdate where id=(payload->>'personId')::uuid and active;
  else return jsonb_build_object('error','Unbekannte Aktion.');
  end if;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function private.referee_assignment_guard(), public.referee_coach_request(jsonb), public.referee_admin_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.referee_assignment_guard(), public.referee_coach_request(jsonb), public.referee_admin_request(uuid,jsonb) to service_role;
