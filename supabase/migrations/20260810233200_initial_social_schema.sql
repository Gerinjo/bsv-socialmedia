create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.social_games (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual' check (source in ('manual', 'fussball.de')),
  source_match_id text,
  source_url text,
  home_team text not null,
  away_team text not null,
  competition text,
  venue text,
  kickoff_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'finished', 'postponed', 'cancelled')),
  home_score smallint check (home_score is null or home_score >= 0),
  away_score smallint check (away_score is null or away_score >= 0),
  lineup jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index social_games_source_match_unique_idx
  on public.social_games (source, source_match_id)
  where source_match_id is not null;

create table public.social_story_jobs (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.social_games(id) on delete cascade,
  story_type text not null check (story_type in ('announcement', 'lineup', 'result')),
  due_at timestamptz not null,
  status text not null default 'pending' check (
    status in ('pending', 'rendering', 'preview_ready', 'published', 'failed', 'skipped', 'needs_input')
  ),
  attempts smallint not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  media_url text,
  external_post_id text,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_story_jobs_game_type_unique unique (game_id, story_type)
);

create index social_games_kickoff_enabled_idx
  on public.social_games (kickoff_at)
  where enabled;

create index social_story_jobs_due_pending_idx
  on public.social_story_jobs (due_at)
  where status = 'pending';

alter table public.social_games enable row level security;
alter table public.social_story_jobs enable row level security;

revoke all on public.social_games from anon, authenticated;
revoke all on public.social_story_jobs from anon, authenticated;
grant select, insert, update, delete on public.social_games to service_role;
grant select, insert, update, delete on public.social_story_jobs to service_role;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger social_games_set_updated_at
before update on public.social_games
for each row execute function private.set_updated_at();

create trigger social_story_jobs_set_updated_at
before update on public.social_story_jobs
for each row execute function private.set_updated_at();

create or replace function private.sync_story_jobs()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.social_story_jobs (game_id, story_type, due_at)
  values
    (new.id, 'announcement', new.kickoff_at - interval '24 hours'),
    (new.id, 'lineup', new.kickoff_at - interval '30 minutes'),
    (new.id, 'result', new.kickoff_at + interval '120 minutes')
  on conflict (game_id, story_type) do update
    set due_at = excluded.due_at,
        updated_at = now()
    where public.social_story_jobs.status in ('pending', 'needs_input', 'failed');

  return new;
end;
$$;

create trigger social_games_sync_story_jobs
after insert or update of kickoff_at on public.social_games
for each row execute function private.sync_story_jobs();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'social-story-previews',
  'social-story-previews',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/svg+xml']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
