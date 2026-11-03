-- Add one selectable motif without changing the currently saved theme or colors.
alter table public.social_brand_settings drop constraint social_brand_settings_theme_key_check;
alter table public.social_brand_settings add constraint social_brand_settings_theme_key_check
  check (theme_key in ('football','christmas','easter','summer','girls_day'));

-- Preserve the deployed permission, color validation and update logic.
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.suite_brand_request(uuid,jsonb)'::regprocedure);
  if strpos(definition, $$'football','christmas','easter','summer'$$) = 0 then
    raise exception 'Expected BSV theme validation was not found';
  end if;
  execute replace(definition, $$'football','christmas','easter','summer'$$, $$'football','christmas','easter','summer','girls_day'$$);
end
$migration$;
