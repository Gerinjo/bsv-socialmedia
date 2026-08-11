create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'bsv-social-worker') then
    perform cron.unschedule('bsv-social-worker');
  end if;
end
$$;

select cron.schedule(
  'bsv-social-worker',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://maejihwjzxkmthjavgnx.supabase.co/functions/v1/social-media-worker',
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
