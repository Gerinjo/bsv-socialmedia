alter table public.social_admins
  add column if not exists role text default 'sm-team';

alter table public.social_admins
  add column if not exists is_active boolean not null default false;

-- Rows that existed before roles were introduced were already explicitly
-- allow-listed administrators. Preserve that access during the migration.
update public.social_admins
set role = 'admin',
    is_active = true;

alter table public.social_admins
  alter column role set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.social_admins'::regclass
      and conname = 'social_admins_role_check'
  ) then
    alter table public.social_admins
      add constraint social_admins_role_check check (role in ('admin', 'sm-team'));
  end if;
end;
$$;

create unique index if not exists social_admins_email_unique
  on public.social_admins (lower(email));

comment on column public.social_admins.role is 'Rolle des Teammitglieds: admin oder sm-team';
comment on column public.social_admins.is_active is 'Gibt an, ob der Zugang vom Administrator freigeschaltet ist';
