-- pg_cron uses UTC in this project. Midnight and 01:00 UTC are the two
-- possible instants for 02:00 Europe/Berlin across daylight-saving time.
select cron.unschedule('bsv-daily-birthday-generator');

select cron.schedule(
  'bsv-daily-birthday-generator',
  '0 0,1 * * *',
  'select private.run_daily_birthday_cron();'
);
