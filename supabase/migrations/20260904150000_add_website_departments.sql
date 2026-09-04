alter table public.social_post_audiences
  drop constraint social_post_audiences_audience_group_check;

alter table public.social_post_audiences
  add constraint social_post_audiences_audience_group_check
  check (audience_group in (
    'club', 'all_departments', 'football_department', 'youth_department',
    'department', 'mens_team', 'womens_team', 'youth_team'
  ));

insert into public.social_post_audiences (slug, audience_group, label, active, sort_order)
values
  ('bogensport', 'department', 'Bogensport', false, 5),
  ('gymnastik', 'department', 'Gymnastik', false, 6),
  ('wandergruppe', 'department', 'Wandergruppe', false, 7)
on conflict (slug) do update
set audience_group = excluded.audience_group,
    label = excluded.label,
    active = excluded.active,
    sort_order = excluded.sort_order;

comment on column public.social_post_audiences.audience_group is
  'Ordnet Zielgruppen für Social Media und direkte Website-Zuweisungen organisatorisch ein; inaktive Abteilungen können ausschließlich für die Website genutzt werden.';
