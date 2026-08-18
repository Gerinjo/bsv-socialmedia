create table public.social_cleanup_settings (
  id smallint primary key default 1 check (id = 1),
  retention_days smallint not null default 30 check (retention_days between 1 and 3650),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.social_cleanup_settings (id, retention_days)
values (1, 30)
on conflict (id) do nothing;

alter table public.social_games
  add column archived_at timestamptz,
  add column archived_by uuid;

alter table public.social_posts
  add column archived_at timestamptz,
  add column archived_by uuid;

alter table public.social_independent_stories
  add column archived_at timestamptz,
  add column archived_by uuid;

create index social_games_archived_idx
  on public.social_games (archived_at)
  where archived_at is not null;

create index social_posts_archived_idx
  on public.social_posts (archived_at)
  where archived_at is not null;

create index social_independent_stories_archived_idx
  on public.social_independent_stories (archived_at)
  where archived_at is not null;

alter table public.social_cleanup_settings enable row level security;
revoke all on public.social_cleanup_settings from anon, authenticated;
grant select, insert, update, delete on public.social_cleanup_settings to service_role;

create trigger social_cleanup_settings_set_updated_at
before update on public.social_cleanup_settings
for each row execute function private.set_updated_at();
