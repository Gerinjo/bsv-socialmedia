alter table public.social_teams
  add column fussball_de_widget_id text,
  add column fussball_de_team_id text,
  add column sync_enabled boolean not null default false,
  add column last_synced_at timestamptz,
  add column last_sync_error text,
  add constraint social_teams_fussball_de_widget_id_check check (
    fussball_de_widget_id is null
    or fussball_de_widget_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  add constraint social_teams_fussball_de_team_id_check check (
    fussball_de_team_id is null
    or fussball_de_team_id ~ '^[A-Z0-9]{32}$'
  );

update public.social_teams
set
  fussball_de_widget_id = source.widget_id,
  fussball_de_team_id = source.team_id,
  sync_enabled = true
from (
  values
    ('herren-1', 'af96d999-a7ba-432a-87c5-439ab401516d', '011MICLVK0000000VTVG0001VTR8C1K7'),
    ('herren-2', '48130047-3237-4579-8f2e-a581bbb98097', '011MIBT808000000VTVG0001VTR8C1K7'),
    ('frauen-1', 'a7855cb2-0226-49a3-98ca-b106b3786afb', '01A2FGUHDO000000VV0AG80NVSEJ47CH'),
    ('frauen-2', '48107d01-3242-45df-8f09-55a20a959688', '03163NI9R0000000VS5489BSVSCPI5U4')
) as source(slug, widget_id, team_id)
where public.social_teams.slug = source.slug;

create index social_teams_match_sync_idx
  on public.social_teams (sort_order)
  where active and sync_enabled;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'bsv-fussball-de-match-sync') then
    perform cron.unschedule('bsv-fussball-de-match-sync');
  end if;
end
$$;

select cron.schedule(
  'bsv-fussball-de-match-sync',
  '23 * * * *',
  $cron$
    select net.http_post(
      url := 'https://maejihwjzxkmthjavgnx.supabase.co/functions/v1/fussball-de-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-bsv-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'social_worker_cron_secret'
          limit 1
        )
      ),
      body := jsonb_build_object('trigger', 'cron', 'requested_at', now()),
      timeout_milliseconds := 120000
    ) as request_id;
  $cron$
);
