alter table public.social_teams
  add column content_enabled boolean not null default true,
  add column publishing_mode text not null default 'manual',
  add column color_scheme jsonb not null default '{"background":"#071f16","panel":"#164f32","primary":"#91c82f","accent":"#f4d638","muted":"#a8cbb4","surface":"#f4f1e8","ink":"#10251a"}'::jsonb;

alter table public.social_teams
  add constraint social_teams_publishing_mode_check
    check (publishing_mode in ('manual', 'automatic')),
  add constraint social_teams_color_scheme_check
    check (
      jsonb_typeof(color_scheme) = 'object'
      and color_scheme->>'background' ~ '^#[0-9A-Fa-f]{6}$'
      and color_scheme->>'panel' ~ '^#[0-9A-Fa-f]{6}$'
      and color_scheme->>'primary' ~ '^#[0-9A-Fa-f]{6}$'
      and color_scheme->>'accent' ~ '^#[0-9A-Fa-f]{6}$'
      and color_scheme->>'muted' ~ '^#[0-9A-Fa-f]{6}$'
      and color_scheme->>'surface' ~ '^#[0-9A-Fa-f]{6}$'
      and color_scheme->>'ink' ~ '^#[0-9A-Fa-f]{6}$'
    );

comment on column public.social_teams.active is
  'Steuert, ob die Mannschaft in den Auswahllisten des Social Media Builders erscheint.';
comment on column public.social_teams.content_enabled is
  'Steuert, ob für die Mannschaft Story- und Beitragsbilder erzeugt werden dürfen.';
comment on column public.social_teams.publishing_mode is
  'manual erzeugt nur Download-Vorschauen; automatic erlaubt bei deaktiviertem globalem Testmodus die Veröffentlichung.';
comment on column public.social_teams.color_scheme is
  'Mannschaftsspezifische Hex-Farben für Story- und Beitragsvorlagen.';

insert into public.social_teams (
  slug, name, competition, website_path, active, content_enabled, publishing_mode, sort_order
) values
  ('herren-1', 'BSV Nordstern Radolfzell', 'Kreisliga B Staffel 1', 'fussball/herren/bezirksliga', false, false, 'manual', 10),
  ('herren-2', 'SG Markelfingen/BSV Nordstern Radolfzell 2', 'Kreisliga C Staffel 1', 'fussball/herren/kreisliga-2', false, false, 'manual', 11),
  ('alte-herren', 'BSV Nordstern Radolfzell · Alte Herren', 'Ü35 Senioren', 'fussball/alte-herren', false, false, 'manual', 12),
  ('frauen-1', 'SG Nordstern Radolfzell/Öhningen-Gaienhofen/Bankholzen-Moos', 'Frauen Bezirksliga Bodensee', 'fussball/frauen/bezirksliga', false, false, 'manual', 20),
  ('frauen-2', 'SG Nordstern Radolfzell/Öhningen-Gaienhofen/Bankholzen-Moos 2', 'Frauen Kreisliga A', 'fussball/frauen/kreisliga', false, false, 'manual', 21),
  ('u19-junioren', 'BSV Nordstern Radolfzell · U19 A-Junioren', 'Leistungsfußball', 'jugend/u19', false, false, 'manual', 30),
  ('u17-junioren', 'BSV Nordstern Radolfzell · U17 B-Junioren', 'Leistungsfußball', 'jugend/u17', false, false, 'manual', 31),
  ('u15-c1-junioren', 'BSV Nordstern Radolfzell · U15 C1-Junioren', 'Leistungsfußball', 'jugend/u15-c1', false, false, 'manual', 32),
  ('u15-c2-junioren', 'BSV Nordstern Radolfzell · U15 C2-Junioren', 'Breitensport', 'jugend/u15-c2', false, false, 'manual', 33),
  ('u13-d1-junioren', 'BSV Nordstern Radolfzell · U13 D1-Junioren', 'Leistungsfußball', 'jugend/u13-d1', false, false, 'manual', 34),
  ('u13-d2-junioren', 'BSV Nordstern Radolfzell · U13 D2-Junioren', 'Leistungsfußball', 'jugend/u13-d2', false, false, 'manual', 35),
  ('u13-d3-junioren', 'BSV Nordstern Radolfzell · U13 D3-Junioren', 'Leistungsfußball', 'jugend/u13-d3', false, false, 'manual', 36),
  ('u11-e1-junioren', 'BSV Nordstern Radolfzell · U11 E1-Junioren', 'Kinderfußball', 'jugend/u11-e1', false, false, 'manual', 37),
  ('u11-e2-junioren', 'BSV Nordstern Radolfzell · U11 E2-Junioren', 'Kinderfußball', 'jugend/u11-e2', false, false, 'manual', 38),
  ('u11-e3-junioren', 'BSV Nordstern Radolfzell · U11 E3-Junioren', 'Kinderfußball', 'jugend/u11-e3', false, false, 'manual', 39),
  ('u9-f-junioren', 'BSV Nordstern Radolfzell · U9 F-Junioren', 'Kinderfußball', 'jugend/u9-f', false, false, 'manual', 40),
  ('u8-f-junioren', 'BSV Nordstern Radolfzell · U8 F-Junioren', 'Kinderfußball', 'jugend/u8-f', false, false, 'manual', 41),
  ('u7-bambinis', 'BSV Nordstern Radolfzell · U7 Bambinis', 'Bambinis', 'jugend/u7-g', false, false, 'manual', 42),
  ('u6-spielgruppe', 'BSV Nordstern Radolfzell · U6 Spielgruppe', 'Spielgruppe', 'jugend/u6-g', false, false, 'manual', 43),
  ('u17-juniorinnen', 'BSV Nordstern Radolfzell · U17 B-Juniorinnen', 'B-Juniorinnen', 'jugend/juniorinnen/u17', false, false, 'manual', 50),
  ('u15-juniorinnen', 'BSV Nordstern Radolfzell · U15 C-Juniorinnen', 'C-Juniorinnen', 'jugend/juniorinnen/u15', false, false, 'manual', 51),
  ('u13-juniorinnen', 'BSV Nordstern Radolfzell · U13 D-Juniorinnen', 'D-Juniorinnen', 'jugend/juniorinnen/u13', false, false, 'manual', 52)
on conflict (slug) do update set
  name = excluded.name,
  competition = excluded.competition,
  website_path = excluded.website_path,
  sort_order = excluded.sort_order,
  updated_at = now();

alter table public.social_post_audiences
  add column team_id uuid references public.social_teams(id) on delete restrict;

update public.social_post_audiences as audience
set
  team_id = team.id,
  active = team.active,
  updated_at = now()
from public.social_teams as team
where audience.slug = team.slug
  and audience.audience_group in ('mens_team', 'womens_team', 'youth_team');

create unique index social_post_audiences_team_unique_idx
  on public.social_post_audiences (team_id)
  where team_id is not null;

create index social_teams_admin_sort_idx
  on public.social_teams (sort_order, name);
