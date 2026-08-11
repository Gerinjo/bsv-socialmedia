alter table public.social_story_jobs
  add column if not exists storage_path text;

alter table public.social_games
  add column if not exists result_label text,
  add column if not exists result_message text;

create table public.social_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table public.social_birthdays (
  id uuid primary key default gen_random_uuid(),
  person_name text not null,
  birth_date date not null,
  message text not null default 'Wir wünschen dir einen großartigen Geburtstag!',
  photo_path text,
  publish_time time not null default '09:00',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.social_birthday_jobs (
  id uuid primary key default gen_random_uuid(),
  birthday_id uuid not null references public.social_birthdays(id) on delete cascade,
  celebration_year integer not null check (celebration_year between 2020 and 2200),
  due_at timestamptz not null,
  status text not null default 'pending' check (
    status in ('pending', 'rendering', 'preview_ready', 'published', 'failed', 'skipped', 'needs_input')
  ),
  attempts smallint not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  media_url text,
  storage_path text,
  external_post_id text,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_birthday_jobs_person_year_unique unique (birthday_id, celebration_year)
);

create index social_birthday_jobs_due_pending_idx
  on public.social_birthday_jobs (due_at)
  where status = 'pending';

alter table public.social_admins enable row level security;
alter table public.social_birthdays enable row level security;
alter table public.social_birthday_jobs enable row level security;

revoke all on public.social_admins from anon, authenticated;
revoke all on public.social_birthdays from anon, authenticated;
revoke all on public.social_birthday_jobs from anon, authenticated;

grant select, insert, update, delete on public.social_admins to service_role;
grant select, insert, update, delete on public.social_birthdays to service_role;
grant select, insert, update, delete on public.social_birthday_jobs to service_role;

create trigger social_birthdays_set_updated_at
before update on public.social_birthdays
for each row execute function private.set_updated_at();

create trigger social_birthday_jobs_set_updated_at
before update on public.social_birthday_jobs
for each row execute function private.set_updated_at();

create or replace function private.birthday_date_for_year(birth_date date, celebration_year integer)
returns date
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when extract(month from birth_date) = 2
      and extract(day from birth_date) = 29
      and not (
        celebration_year % 400 = 0
        or (celebration_year % 4 = 0 and celebration_year % 100 <> 0)
      )
      then make_date(celebration_year, 2, 28)
    else make_date(
      celebration_year,
      extract(month from birth_date)::integer,
      extract(day from birth_date)::integer
    )
  end;
$$;

create or replace function private.sync_birthday_jobs()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_year integer;
  target_date date;
  target_due_at timestamptz;
begin
  for target_year in extract(year from now())::integer..(extract(year from now())::integer + 1)
  loop
    target_date := private.birthday_date_for_year(new.birth_date, target_year);
    target_due_at := (target_date + new.publish_time) at time zone 'Europe/Berlin';

    if target_due_at >= now() - interval '1 day' then
      insert into public.social_birthday_jobs (birthday_id, celebration_year, due_at)
      values (new.id, target_year, target_due_at)
      on conflict (birthday_id, celebration_year) do update
        set due_at = excluded.due_at,
            updated_at = now()
        where public.social_birthday_jobs.status in ('pending', 'needs_input', 'failed');
    end if;
  end loop;

  return new;
end;
$$;

create trigger social_birthdays_sync_jobs
after insert or update of birth_date, publish_time on public.social_birthdays
for each row execute function private.sync_birthday_jobs();
