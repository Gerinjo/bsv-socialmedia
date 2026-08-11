alter table public.social_games
  drop constraint if exists social_games_status_check;

alter table public.social_games
  add constraint social_games_status_check
  check (status in ('scheduled', 'live', 'finished', 'postponed', 'cancelled', 'aborted'));
