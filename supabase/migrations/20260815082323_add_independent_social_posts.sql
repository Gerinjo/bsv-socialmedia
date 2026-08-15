create table public.social_post_audiences (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  audience_group text not null check (audience_group in (
    'club', 'all_departments', 'football_department', 'youth_department',
    'mens_team', 'womens_team', 'youth_team'
  )),
  label text not null,
  active boolean not null default true,
  sort_order smallint not null default 100 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audience_group, label)
);

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  audience_id uuid not null references public.social_post_audiences(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 2200),
  image_paths text[] not null default '{}',
  enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_posts_image_count_check check (cardinality(image_paths) between 0 and 10)
);

create table public.social_post_jobs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.social_posts(id) on delete cascade,
  status text not null default 'needs_input' check (status in ('pending', 'rendering', 'preview_ready', 'published', 'failed', 'needs_input', 'skipped')),
  due_at timestamptz not null default now(),
  attempts smallint not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  media_url text,
  storage_path text,
  media_urls text[] not null default '{}',
  storage_paths text[] not null default '{}',
  external_post_id text,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.social_post_audiences (slug, audience_group, label, sort_order) values
  ('gesamtverein', 'club', 'Gesamtverein', 1),
  ('alle-abteilungen', 'all_departments', 'Alle Abteilungen', 2),
  ('fussballabteilung', 'football_department', 'Fußballabteilung', 3),
  ('jugendabteilung', 'youth_department', 'Jugendabteilung', 4),
  ('herren-1', 'mens_team', '1. Herren', 10),
  ('herren-2', 'mens_team', '2. Herren', 11),
  ('alte-herren', 'mens_team', 'Alte Herren', 12),
  ('frauen-1', 'womens_team', '1. Frauen', 20),
  ('frauen-2', 'womens_team', '2. Frauen', 21),
  ('u19-junioren', 'youth_team', 'U19 · A-Junioren', 30),
  ('u17-junioren', 'youth_team', 'U17 · B-Junioren', 31),
  ('u15-c1-junioren', 'youth_team', 'U15 · C1-Junioren', 32),
  ('u15-c2-junioren', 'youth_team', 'U15 · C2-Junioren', 33),
  ('u13-d1-junioren', 'youth_team', 'U13 · D1-Junioren', 34),
  ('u13-d2-junioren', 'youth_team', 'U13 · D2-Junioren', 35),
  ('u13-d3-junioren', 'youth_team', 'U13 · D3-Junioren', 36),
  ('u11-e1-junioren', 'youth_team', 'U11 · E1-Junioren', 37),
  ('u11-e2-junioren', 'youth_team', 'U11 · E2-Junioren', 38),
  ('u11-e3-junioren', 'youth_team', 'U11 · E3-Junioren', 39),
  ('u9-f-junioren', 'youth_team', 'U9 · F-Junioren', 40),
  ('u8-f-junioren', 'youth_team', 'U8 · F-Junioren', 41),
  ('u7-bambinis', 'youth_team', 'U7 · Bambinis', 42),
  ('u6-spielgruppe', 'youth_team', 'U6 · Spielgruppe', 43),
  ('u17-juniorinnen', 'youth_team', 'U17 · B-Juniorinnen', 50),
  ('u15-juniorinnen', 'youth_team', 'U15 · C-Juniorinnen', 51),
  ('u13-juniorinnen', 'youth_team', 'U13 · D-Juniorinnen', 52);

create index social_post_audiences_active_sort_idx
  on public.social_post_audiences (sort_order, label)
  where active;

create index social_posts_updated_idx
  on public.social_posts (updated_at desc)
  where enabled;

create index social_post_jobs_pending_idx
  on public.social_post_jobs (due_at, created_at)
  where status = 'pending';

alter table public.social_post_audiences enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_post_jobs enable row level security;

revoke all on public.social_post_audiences from anon, authenticated;
revoke all on public.social_posts from anon, authenticated;
revoke all on public.social_post_jobs from anon, authenticated;

grant select, insert, update, delete on public.social_post_audiences to service_role;
grant select, insert, update, delete on public.social_posts to service_role;
grant select, insert, update, delete on public.social_post_jobs to service_role;

create trigger social_post_audiences_set_updated_at
before update on public.social_post_audiences
for each row execute function private.set_updated_at();

create trigger social_posts_set_updated_at
before update on public.social_posts
for each row execute function private.set_updated_at();

create trigger social_post_jobs_set_updated_at
before update on public.social_post_jobs
for each row execute function private.set_updated_at();
