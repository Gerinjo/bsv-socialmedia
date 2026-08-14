alter table public.social_admins
  add column if not exists role text default 'sm-team';

alter table public.social_admins
  add column if not exists is_active boolean not null default false;

update public.social_admins
set role = 'sm-team'
where role is null;

alter table public.social_admins
  alter column role set not null,
  add constraint social_admins_role_check check (role in ('admin', 'sm-team'));

create unique index if not exists social_admins_email_unique
  on public.social_admins (lower(email));

comment on column public.social_admins.role is 'Rolle des Teammitglieds: admin oder sm-team';
comment on column public.social_admins.is_active is 'Gibt an, ob der Zugang vom Administrator freigeschaltet ist';
