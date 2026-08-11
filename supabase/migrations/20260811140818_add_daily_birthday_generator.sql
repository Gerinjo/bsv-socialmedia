create table if not exists private.social_birthday_cron_runs (
  run_date date primary key,
  started_at timestamptz not null default clock_timestamp(),
  local_hour smallint not null check (local_hour between 0 and 23),
  matched_people integer not null default 0,
  eligible_people integer not null default 0,
  queued_birthdays integer not null default 0,
  completed_at timestamptz,
  last_error text
);

revoke all on table private.social_birthday_cron_runs from public, anon, authenticated;

create or replace function private.generate_daily_birthday_greetings(
  p_target_date date default null,
  p_enqueue boolean default true
)
returns table (
  target_date date,
  matched_people bigint,
  eligible_people bigint,
  queued_birthdays bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target_date date := coalesce(
    p_target_date,
    (now() at time zone 'Europe/Berlin')::date
  );
  v_matched_people bigint := 0;
  v_eligible_people bigint := 0;
  v_queued_birthdays bigint := 0;
begin
  select
    count(*),
    count(*) filter (
      where coalesce(
        nullif(pg_catalog.btrim(p.cutout_path), ''),
        nullif(pg_catalog.btrim(p.source_photo_url), '')
      ) is not null
    )
  into v_matched_people, v_eligible_people
  from public.social_people as p
  where p.active = true
    and p.birth_date is not null
    and private.birthday_date_for_year(
      p.birth_date,
      extract(year from v_target_date)::integer
    ) = v_target_date;

  if p_enqueue then
    with eligible_people as materialized (
      select
        p.id as person_id,
        p.display_name as person_name,
        p.birth_date,
        coalesce(
          nullif(pg_catalog.btrim(p.cutout_path), ''),
          nullif(pg_catalog.btrim(p.source_photo_url), '')
        ) as photo_path
      from public.social_people as p
      where p.active = true
        and p.birth_date is not null
        and private.birthday_date_for_year(
          p.birth_date,
          extract(year from v_target_date)::integer
        ) = v_target_date
        and coalesce(
          nullif(pg_catalog.btrim(p.cutout_path), ''),
          nullif(pg_catalog.btrim(p.source_photo_url), '')
        ) is not null
    ),
    upserted_birthdays as (
      insert into public.social_birthdays (
        person_id,
        person_name,
        birth_date,
        message,
        photo_path,
        publish_time,
        enabled
      )
      select
        e.person_id,
        e.person_name,
        e.birth_date,
        'Wir wünschen dir einen großartigen Geburtstag!',
        e.photo_path,
        time '09:00',
        true
      from eligible_people as e
      on conflict (person_id) where person_id is not null
      do update set
        person_name = excluded.person_name,
        birth_date = excluded.birth_date,
        photo_path = excluded.photo_path,
        enabled = true,
        updated_at = now()
      returning id
    ),
    queued_jobs as (
      insert into public.social_birthday_jobs (
        birthday_id,
        celebration_year,
        due_at,
        status,
        attempts
      )
      select
        b.id,
        extract(year from v_target_date)::integer,
        clock_timestamp(),
        'pending',
        0
      from upserted_birthdays as b
      on conflict (birthday_id, celebration_year)
      do update set
        due_at = excluded.due_at,
        status = 'pending',
        attempts = 0,
        claimed_at = null,
        last_error = null,
        media_url = null,
        storage_path = null,
        external_post_id = null,
        published_at = null,
        updated_at = now()
      where public.social_birthday_jobs.status in (
        'pending',
        'failed',
        'needs_input',
        'skipped'
      )
      returning birthday_id
    )
    select count(*)
    into v_queued_birthdays
    from queued_jobs;
  end if;

  return query
  select
    v_target_date,
    v_matched_people,
    v_eligible_people,
    v_queued_birthdays;
end;
$$;

revoke all on function private.generate_daily_birthday_greetings(date, boolean)
  from public, anon, authenticated;

create or replace function private.run_daily_birthday_cron()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_local_now timestamp without time zone := now() at time zone 'Europe/Berlin';
  v_local_date date := v_local_now::date;
  v_local_hour integer := extract(hour from v_local_now)::integer;
  v_inserted integer := 0;
  v_matched_people bigint := 0;
  v_eligible_people bigint := 0;
  v_queued_birthdays bigint := 0;
begin
  -- The job wakes hourly so that 02:00 Europe/Berlin remains correct across
  -- daylight-saving changes. At spring-forward, 03:00 is the fallback.
  if v_local_hour not in (2, 3) then
    return;
  end if;

  insert into private.social_birthday_cron_runs (run_date, local_hour)
  values (v_local_date, v_local_hour)
  on conflict (run_date) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return;
  end if;

  select
    result.matched_people,
    result.eligible_people,
    result.queued_birthdays
  into
    v_matched_people,
    v_eligible_people,
    v_queued_birthdays
  from private.generate_daily_birthday_greetings(v_local_date, true) as result;

  update private.social_birthday_cron_runs
  set
    matched_people = v_matched_people::integer,
    eligible_people = v_eligible_people::integer,
    queued_birthdays = v_queued_birthdays::integer,
    completed_at = clock_timestamp(),
    last_error = null
  where run_date = v_local_date;
exception
  when others then
    update private.social_birthday_cron_runs
    set
      completed_at = clock_timestamp(),
      last_error = sqlerrm
    where run_date = v_local_date;
    raise;
end;
$$;

revoke all on function private.run_daily_birthday_cron()
  from public, anon, authenticated;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'bsv-daily-birthday-generator'
  ) then
    perform cron.unschedule('bsv-daily-birthday-generator');
  end if;
end;
$$;

select cron.schedule(
  'bsv-daily-birthday-generator',
  '0 * * * *',
  'select private.run_daily_birthday_cron();'
);
