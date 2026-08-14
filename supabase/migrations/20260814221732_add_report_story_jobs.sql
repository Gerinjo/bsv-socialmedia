alter table public.social_story_jobs
  drop constraint if exists social_story_jobs_story_type_check;

alter table public.social_story_jobs
  add constraint social_story_jobs_story_type_check
  check (story_type in ('announcement', 'lineup', 'result', 'report'));

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
    (new.id, 'result', new.kickoff_at + interval '120 minutes'),
    (new.id, 'report', new.kickoff_at + interval '150 minutes')
  on conflict (game_id, story_type) do update
    set due_at = excluded.due_at,
        updated_at = now()
    where public.social_story_jobs.status in ('pending', 'needs_input', 'failed');

  return new;
end;
$$;

insert into public.social_story_jobs (game_id, story_type, due_at)
select id, 'report', kickoff_at + interval '150 minutes'
from public.social_games
on conflict (game_id, story_type) do nothing;
