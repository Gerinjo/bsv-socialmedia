create table public.social_team_color_groups (
  key text primary key,
  label text not null,
  color_scheme jsonb not null,
  sort_order smallint not null default 100 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_team_color_groups_key_check
    check (key in ('herren', 'frauen', 'junioren', 'juniorinnen')),
  constraint social_team_color_groups_color_scheme_check
    check (
      jsonb_typeof(color_scheme) = 'object'
      and color_scheme->>'background' ~ '^#[0-9A-Fa-f]{6}$'
      and color_scheme->>'panel' ~ '^#[0-9A-Fa-f]{6}$'
      and color_scheme->>'primary' ~ '^#[0-9A-Fa-f]{6}$'
      and color_scheme->>'accent' ~ '^#[0-9A-Fa-f]{6}$'
      and color_scheme->>'muted' ~ '^#[0-9A-Fa-f]{6}$'
      and color_scheme->>'surface' ~ '^#[0-9A-Fa-f]{6}$'
      and color_scheme->>'ink' ~ '^#[0-9A-Fa-f]{6}$'
    )
);

alter table public.social_team_color_groups enable row level security;
revoke all on public.social_team_color_groups from anon, authenticated;
grant select, insert, update, delete on public.social_team_color_groups to service_role;

create trigger social_team_color_groups_set_updated_at
before update on public.social_team_color_groups
for each row execute function private.set_updated_at();

insert into public.social_team_color_groups (key, label, color_scheme, sort_order) values
  (
    'herren',
    'Herren',
    '{"background":"#071f16","panel":"#164f32","primary":"#91c82f","accent":"#f4d638","muted":"#a8cbb4","surface":"#f4f1e8","ink":"#10251a"}'::jsonb,
    10
  ),
  (
    'frauen',
    'Frauen',
    '{"background":"#241126","panel":"#64345f","primary":"#db78bd","accent":"#f4d638","muted":"#d9bad4","surface":"#fff5fb","ink":"#2b1730"}'::jsonb,
    20
  ),
  (
    'junioren',
    'Junioren',
    '{"background":"#08263d","panel":"#16506c","primary":"#43b7e8","accent":"#f4d638","muted":"#acd7e8","surface":"#f4f8fb","ink":"#0b2638"}'::jsonb,
    30
  ),
  (
    'juniorinnen',
    'Juniorinnen',
    '{"background":"#201636","panel":"#594183","primary":"#b796ff","accent":"#f4d638","muted":"#cabde6","surface":"#faf7ff","ink":"#241936"}'::jsonb,
    40
  );

alter table public.social_teams
  add column family_key text references public.social_team_color_groups(key) on update cascade on delete restrict,
  add column color_source text not null default 'custom';

alter table public.social_teams
  add constraint social_teams_color_source_check
    check (color_source in ('global', 'group', 'custom'));

update public.social_teams
set family_key = case
  when slug like '%juniorinnen%' then 'juniorinnen'
  when slug like 'frauen-%' then 'frauen'
  when slug like 'herren-%' or slug = 'alte-herren' then 'herren'
  else 'junioren'
end;

alter table public.social_teams
  alter column family_key set not null;

update public.social_teams
set color_source = 'global'
where color_scheme = '{"background":"#071f16","panel":"#164f32","primary":"#91c82f","accent":"#f4d638","muted":"#a8cbb4","surface":"#f4f1e8","ink":"#10251a"}'::jsonb;

create index social_teams_family_color_source_idx
  on public.social_teams (family_key, color_source);

comment on table public.social_team_color_groups is
  'Konfigurierbare Standardfarben der Mannschaftsfamilien Herren, Frauen, Junioren und Juniorinnen.';
comment on column public.social_teams.family_key is
  'Mannschaftsfamilie, deren Farbpalette optional vererbt wird.';
comment on column public.social_teams.color_source is
  'global verwendet das grüne BSV-Schema, group die Familienfarbe und custom ein individuelles Team-Schema.';
