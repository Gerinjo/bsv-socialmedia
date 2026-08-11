create table public.social_clubs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  normalized_name text not null unique,
  website_url text,
  fussball_de_url text,
  crest_source_url text,
  crest_original_path text,
  crest_transparent_path text,
  crest_status text not null default 'missing'
    check (crest_status in ('missing', 'needs_review', 'approved', 'rejected')),
  transparency_confidence numeric(4, 3)
    check (transparency_confidence is null or transparency_confidence between 0 and 1),
  transparency_metadata jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.social_club_aliases (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.social_clubs(id) on delete cascade,
  alias text not null,
  normalized_alias text not null unique,
  created_at timestamptz not null default now()
);

alter table public.social_games
  add column home_club_id uuid,
  add column away_club_id uuid,
  add constraint social_games_home_club_id_fkey
    foreign key (home_club_id) references public.social_clubs(id) on delete set null,
  add constraint social_games_away_club_id_fkey
    foreign key (away_club_id) references public.social_clubs(id) on delete set null;

create index social_clubs_status_name_idx
  on public.social_clubs (crest_status, name);

create index social_club_aliases_club_idx
  on public.social_club_aliases (club_id);

create index social_games_home_club_idx
  on public.social_games (home_club_id);

create index social_games_away_club_idx
  on public.social_games (away_club_id);

alter table public.social_clubs enable row level security;
alter table public.social_club_aliases enable row level security;

revoke all on public.social_clubs from anon, authenticated;
revoke all on public.social_club_aliases from anon, authenticated;

grant select, insert, update, delete on public.social_clubs to service_role;
grant select, insert, update, delete on public.social_club_aliases to service_role;

create trigger social_clubs_set_updated_at
before update on public.social_clubs
for each row execute function private.set_updated_at();

insert into public.social_clubs (
  slug,
  name,
  normalized_name,
  website_url,
  fussball_de_url,
  crest_source_url,
  crest_original_path,
  crest_transparent_path,
  crest_status,
  transparency_confidence,
  transparency_metadata,
  last_checked_at
)
values
  (
    'bsv-nordstern-radolfzell',
    'BSV Nordstern Radolfzell',
    'bsv nordstern radolfzell',
    'https://bsvnordstern.de/',
    null,
    'https://bsvnordstern.de/',
    'assets/bsv-nordstern.png',
    'assets/bsv-nordstern.png',
    'approved',
    1,
    '{"method":"source-alpha","reviewed":true}'::jsonb,
    now()
  ),
  (
    'tsv-aach-linz',
    'TSV Aach-Linz',
    'tsv aach linz',
    'https://www.tsv-aach-linz.de/',
    'https://www.fussball.de/verein/tsv-aach-linz-suedbaden/-/id/00ES8GN9CG00007IVV0AG08LVUPGND5I',
    'https://www.fussball.de/verein/tsv-aach-linz-suedbaden/-/id/00ES8GN9CG00007IVV0AG08LVUPGND5I',
    'club-crests/tsv-aach-linz/original.png',
    'club-crests/tsv-aach-linz/transparent.png',
    'approved',
    1,
    '{"method":"source-alpha","reviewed":true}'::jsonb,
    now()
  ),
  ('vfr-stockach', 'VfR Stockach', 'vfr stockach', null, null, null, null, null, 'missing', null, '{}'::jsonb, null),
  ('sv-allensbach', 'SV Allensbach', 'sv allensbach', null, null, null, null, null, 'missing', null, '{}'::jsonb, null),
  ('sc-konstanz-wollmatingen', 'SC Konstanz-Wollmatingen', 'sc konstanz wollmatingen', null, null, null, null, null, 'missing', null, '{}'::jsonb, null),
  ('djk-konstanz', 'DJK Konstanz', 'djk konstanz', null, null, null, null, null, 'missing', null, '{}'::jsonb, null)
on conflict (normalized_name) do nothing;

insert into public.social_club_aliases (club_id, alias, normalized_alias)
select club.id, alias.alias, alias.normalized_alias
from (
  values
    ('bsv nordstern radolfzell', 'BSV Nordstern Radolfzell', 'bsv nordstern radolfzell'),
    ('bsv nordstern radolfzell', 'SG Markelfingen/BSV Nordstern Radolfzell 2', 'sg markelfingen bsv nordstern radolfzell'),
    ('bsv nordstern radolfzell', 'SG Nordstern Radolfzell/Öhningen-Gaienhofen/Bankholzen-Moos', 'sg nordstern radolfzell ohningen gaienhofen bankholzen moos'),
    ('tsv aach linz', 'TSV Aach-Linz', 'tsv aach linz'),
    ('vfr stockach', 'VfR Stockach 2', 'vfr stockach'),
    ('sv allensbach', 'SV Allensbach', 'sv allensbach'),
    ('sc konstanz wollmatingen', 'SC Konstanz-Wollmatingen', 'sc konstanz wollmatingen'),
    ('djk konstanz', 'DJK Konstanz', 'djk konstanz')
) as alias(club_normalized_name, alias, normalized_alias)
join public.social_clubs as club
  on club.normalized_name = alias.club_normalized_name
on conflict (normalized_alias) do update
set club_id = excluded.club_id,
    alias = excluded.alias;

update public.social_games as game
set home_club_id = alias.club_id
from public.social_club_aliases as alias
where game.home_club_id is null
  and alias.normalized_alias in (
    'bsv nordstern radolfzell',
    'sg markelfingen bsv nordstern radolfzell',
    'sg nordstern radolfzell ohningen gaienhofen bankholzen moos'
  )
  and game.home_team = alias.alias;

update public.social_games as game
set away_club_id = club.id
from public.social_clubs as club
where game.away_club_id is null
  and (
    (club.normalized_name = 'tsv aach linz' and game.away_team in ('TSV Aach Linz 2', 'TSV Aach-Linz', 'TSV Aach-Linz 2'))
    or (club.normalized_name = 'vfr stockach' and game.away_team = 'VfR Stockach 2')
    or (club.normalized_name = 'sv allensbach' and game.away_team = 'SV Allensbach')
    or (club.normalized_name = 'sc konstanz wollmatingen' and game.away_team = 'SC Konstanz-Wollmatingen')
    or (club.normalized_name = 'djk konstanz' and game.away_team = 'DJK Konstanz')
    or (club.normalized_name = 'bsv nordstern radolfzell' and game.away_team like '%Nordstern Radolfzell%')
  );
