create table public.social_story_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  label text not null unique check (char_length(label) between 1 and 80),
  active boolean not null default true,
  sort_order smallint not null default 100 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.social_independent_stories (
  id uuid primary key default gen_random_uuid(),
  audience_id uuid not null references public.social_post_audiences(id) on delete restrict,
  category_id uuid not null references public.social_story_categories(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 120),
  motivation text not null default '' check (char_length(motivation) <= 700),
  activity text not null default '' check (char_length(activity) <= 300),
  event_at timestamptz not null,
  image_path text,
  schedule_kind text not null check (schedule_kind in ('once', 'weekly')),
  publish_at timestamptz,
  weekly_weekday smallint check (weekly_weekday between 1 and 7),
  weekly_time time without time zone,
  schedule_timezone text not null default 'Europe/Berlin',
  enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_independent_stories_schedule_check check (
    (schedule_kind = 'once' and publish_at is not null and weekly_weekday is null and weekly_time is null)
    or
    (schedule_kind = 'weekly' and publish_at is null and weekly_weekday is not null and weekly_time is not null)
  )
);

create table public.social_independent_story_jobs (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.social_independent_stories(id) on delete cascade,
  scheduled_for timestamptz not null,
  event_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'rendering', 'preview_ready', 'published', 'failed', 'needs_input', 'skipped')),
  due_at timestamptz not null,
  attempts smallint not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  media_url text,
  storage_path text,
  external_post_id text,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (story_id, scheduled_for)
);

insert into public.social_story_categories (slug, label, sort_order) values
  ('juniorinnen', 'Juniorinnen', 10),
  ('verein', 'Verein', 20),
  ('foerderverein', 'Förderverein', 30),
  ('aktive', 'Aktive', 40),
  ('events', 'Events', 50),
  ('jugendevents', 'Jugendevents', 60),
  ('turniere', 'Turniere', 70);

create index social_story_categories_active_sort_idx
  on public.social_story_categories (sort_order, label)
  where active;

create index social_independent_stories_updated_idx
  on public.social_independent_stories (updated_at desc)
  where enabled;

create index social_independent_story_jobs_pending_idx
  on public.social_independent_story_jobs (due_at, created_at)
  where status = 'pending';

alter table public.social_story_categories enable row level security;
alter table public.social_independent_stories enable row level security;
alter table public.social_independent_story_jobs enable row level security;

revoke all on public.social_story_categories from anon, authenticated;
revoke all on public.social_independent_stories from anon, authenticated;
revoke all on public.social_independent_story_jobs from anon, authenticated;

grant select, insert, update, delete on public.social_story_categories to service_role;
grant select, insert, update, delete on public.social_independent_stories to service_role;
grant select, insert, update, delete on public.social_independent_story_jobs to service_role;

create trigger social_story_categories_set_updated_at
before update on public.social_story_categories
for each row execute function private.set_updated_at();

create trigger social_independent_stories_set_updated_at
before update on public.social_independent_stories
for each row execute function private.set_updated_at();

create trigger social_independent_story_jobs_set_updated_at
before update on public.social_independent_story_jobs
for each row execute function private.set_updated_at();

alter table public.social_sponsor_assignments
  drop constraint if exists social_sponsor_assignments_context_check;

alter table public.social_sponsor_assignments
  add constraint social_sponsor_assignments_context_check check (context in (
    'announcement', 'lineup', 'result', 'report', 'birthday', 'post', 'story'
  ));
