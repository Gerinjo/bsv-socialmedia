alter table public.social_admins
  add column if not exists access_areas text[] not null default array['social_media']::text[];

alter table public.social_admins
  drop constraint if exists social_admins_access_areas_check;

alter table public.social_admins
  add constraint social_admins_access_areas_check check (
    access_areas <@ array['social_media', 'sponsoring', 'administration', 'user_management']::text[]
    and cardinality(access_areas) > 0
  );

update public.social_admins
set access_areas = array['social_media', 'sponsoring', 'administration', 'user_management']::text[]
where role = 'admin';

comment on column public.social_admins.access_areas is
  'Freigegebene Suite-Bereiche. Super-Admins mit role=admin besitzen serverseitig immer alle Bereiche.';

alter table public.social_sponsors
  add column if not exists contract_start_date date,
  add column if not exists contract_end_date date,
  add column if not exists automatic_renewal boolean not null default false;

alter table public.social_sponsors
  drop constraint if exists social_sponsors_contract_period_check;

alter table public.social_sponsors
  add constraint social_sponsors_contract_period_check check (
    contract_start_date is null
    or contract_end_date is null
    or contract_end_date >= contract_start_date
  );

alter table public.social_sponsors
  drop constraint if exists social_sponsors_automatic_renewal_check;

alter table public.social_sponsors
  add constraint social_sponsors_automatic_renewal_check check (
    not automatic_renewal or contract_end_date is null
  );

comment on column public.social_sponsors.contract_start_date is 'Erster Geltungstag der vertraglichen Verbindung.';
comment on column public.social_sponsors.contract_end_date is 'Letzter Geltungstag; ab dem Folgetag wird der Sponsor passiv.';
comment on column public.social_sponsors.automatic_renewal is 'Vertrag ohne Enddatum, der sich automatisch verlängert.';

create index if not exists social_sponsors_contract_expiry_idx
  on public.social_sponsors (contract_end_date)
  where active and contract_end_date is not null and not automatic_renewal;

create or replace function private.deactivate_expired_sponsors()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deactivated_count integer;
begin
  update public.social_sponsors
  set active = false
  where active
    and not automatic_renewal
    and contract_end_date is not null
    and contract_end_date < current_date;

  get diagnostics deactivated_count = row_count;
  return deactivated_count;
end;
$$;

revoke all on function private.deactivate_expired_sponsors() from public, anon, authenticated;
grant execute on function private.deactivate_expired_sponsors() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'bsv-deactivate-expired-sponsors') then
    perform cron.unschedule('bsv-deactivate-expired-sponsors');
  end if;
end
$$;

select cron.schedule(
  'bsv-deactivate-expired-sponsors',
  '5 1 * * *',
  $cron$select private.deactivate_expired_sponsors();$cron$
);
