insert into public.social_sponsor_types (slug, label, description, sort_order)
values ('stadionheft', 'Stadionheft', 'Schaltet eine Anzeige im Stadionheft. Die Seitengröße wird je Zuordnung festgelegt.', 70)
on conflict (slug) do nothing;

alter table public.social_sponsor_website_assignments
  add column page_size text
  constraint social_sponsor_website_assignments_page_size_check
  check (page_size in ('1', '1/2', '1/3', '1/4', '1/6'));

comment on column public.social_sponsor_website_assignments.page_size is
  'Anzeigenformat im Stadionheft: 1, 1/2, 1/3, 1/4 oder 1/6 Seite; bei anderen Sponsorarten leer.';
