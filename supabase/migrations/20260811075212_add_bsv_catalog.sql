create table public.social_teams (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  competition text not null,
  website_path text,
  fussball_de_url text,
  active boolean not null default true,
  sort_order smallint not null default 100 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.social_people (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null,
  roles text[] not null default '{}',
  source_photo_url text,
  cutout_path text,
  birth_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.social_team_people (
  team_id uuid not null references public.social_teams(id) on delete cascade,
  person_id uuid not null references public.social_people(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (team_id, person_id, role)
);

alter table public.social_games
  add column team_id uuid references public.social_teams(id) on delete restrict,
  add column is_home boolean;

alter table public.social_birthdays
  add column person_id uuid references public.social_people(id) on delete restrict;

create unique index social_birthdays_person_unique_idx
  on public.social_birthdays (person_id)
  where person_id is not null;

create index social_teams_active_sort_idx
  on public.social_teams (sort_order, name)
  where active;

create index social_people_active_name_idx
  on public.social_people (display_name)
  where active;

create index social_team_people_person_idx
  on public.social_team_people (person_id);

alter table public.social_teams enable row level security;
alter table public.social_people enable row level security;
alter table public.social_team_people enable row level security;

revoke all on public.social_teams from anon, authenticated;
revoke all on public.social_people from anon, authenticated;
revoke all on public.social_team_people from anon, authenticated;

grant select, insert, update, delete on public.social_teams to service_role;
grant select, insert, update, delete on public.social_people to service_role;
grant select, insert, update, delete on public.social_team_people to service_role;

create trigger social_teams_set_updated_at
before update on public.social_teams
for each row execute function private.set_updated_at();

create trigger social_people_set_updated_at
before update on public.social_people
for each row execute function private.set_updated_at();
