alter table public.social_games
  add column if not exists report_scorers text,
  add column if not exists report_image_paths jsonb not null default '[]'::jsonb;

alter table public.social_games
  drop constraint if exists social_games_report_image_paths_check;

alter table public.social_games
  add constraint social_games_report_image_paths_check
  check (
    case
      when jsonb_typeof(report_image_paths) = 'array'
        then jsonb_array_length(report_image_paths) <= 10
      else false
    end
  );

comment on column public.social_games.report_scorers is
  'Zeilenweise formatierte Torschützen für die zweite Carousel-Seite des Spielberichts';

comment on column public.social_games.report_image_paths is
  'Geordnete private Storage-Pfade für die Seiten des Spielbericht-Carousels';

update public.social_games
set report_image_paths = jsonb_build_array(action_image_path)
where action_image_path is not null
  and report_image_paths = '[]'::jsonb;

alter table public.social_story_jobs
  add column if not exists media_urls jsonb not null default '[]'::jsonb,
  add column if not exists storage_paths jsonb not null default '[]'::jsonb;

alter table public.social_story_jobs
  drop constraint if exists social_story_jobs_media_urls_check,
  drop constraint if exists social_story_jobs_storage_paths_check;

alter table public.social_story_jobs
  add constraint social_story_jobs_media_urls_check
  check (
    case
      when jsonb_typeof(media_urls) = 'array'
        then jsonb_array_length(media_urls) <= 10
      else false
    end
  ),
  add constraint social_story_jobs_storage_paths_check
  check (
    case
      when jsonb_typeof(storage_paths) = 'array'
        then jsonb_array_length(storage_paths) <= 10
      else false
    end
  );

comment on column public.social_story_jobs.media_urls is
  'Geordnete Vorschau-URLs für mehrseitige Beiträge';

comment on column public.social_story_jobs.storage_paths is
  'Geordnete Storage-Pfade für mehrseitige Beiträge';

update public.social_story_jobs
set
  media_urls = case when media_url is null then '[]'::jsonb else jsonb_build_array(media_url) end,
  storage_paths = case when storage_path is null then '[]'::jsonb else jsonb_build_array(storage_path) end
where story_type = 'report'
  and media_urls = '[]'::jsonb
  and storage_paths = '[]'::jsonb;
