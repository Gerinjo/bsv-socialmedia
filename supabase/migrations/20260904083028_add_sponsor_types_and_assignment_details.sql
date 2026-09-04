create table public.social_sponsor_types (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  label text not null unique check (char_length(label) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  active boolean not null default true,
  sort_order smallint not null default 100 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.social_sponsor_website_assignments
  add column sponsor_type_id uuid references public.social_sponsor_types(id) on delete set null,
  add column description text not null default '' check (char_length(description) <= 1600),
  add column updated_at timestamptz not null default now();

create index social_sponsor_types_active_sort_idx
  on public.social_sponsor_types (sort_order, label)
  where active;

create index social_sponsor_website_assignments_type_idx
  on public.social_sponsor_website_assignments (sponsor_type_id)
  where sponsor_type_id is not null;

alter table public.social_sponsor_types enable row level security;

revoke all on public.social_sponsor_types from anon, authenticated;
grant select, insert, update, delete on public.social_sponsor_types to service_role;

create trigger social_sponsor_types_set_updated_at
before update on public.social_sponsor_types
for each row execute function private.set_updated_at();

create trigger social_sponsor_website_assignments_set_updated_at
before update on public.social_sponsor_website_assignments
for each row execute function private.set_updated_at();

comment on table public.social_sponsor_types is
  'Administrierbare Arten einer konkreten Sponsor-Zuordnung, zum Beispiel Trikotsponsor oder Eventsponsor.';

comment on column public.social_sponsor_website_assignments.sponsor_type_id is
  'Optionale Sponsorart dieser konkreten Beziehung. Ein Sponsor kann je Zielgruppe eine andere Art haben.';

comment on column public.social_sponsor_website_assignments.description is
  'Optionaler redaktioneller Text, der ausschließlich für diese Sponsor-Zielgruppen-Beziehung gilt.';

insert into public.social_sponsor_types (slug, label, description, sort_order)
values
  ('trikotsponsor', 'Trikotsponsor', 'Unterstützt die Mannschaft mit Spieltrikots oder einem vollständigen Trikotsatz.', 10),
  ('aufwaermshirt-sponsor', 'Aufwärmshirt-Sponsor', 'Unterstützt die Mannschaft mit Aufwärmshirts oder Aufwärmbekleidung.', 20),
  ('materialsponsor', 'Materialsponsor', 'Stellt Trainings-, Spiel- oder sonstiges Mannschaftsmaterial bereit.', 30),
  ('teamsponsor', 'Teamsponsor', 'Unterstützt eine konkrete Mannschaft ohne Bindung an eine einzelne Ausstattung.', 40),
  ('eventsponsor', 'Eventsponsor', 'Unterstützt eine Veranstaltung, ein Turnier oder eine Veranstaltungsreihe.', 50),
  ('bandensponsor', 'Bandensponsor', 'Ist mit einer Werbebande auf dem Vereinsgelände oder am Spielfeld vertreten.', 60)
on conflict (slug) do nothing;

update public.social_sponsor_website_assignments as assignment
set sponsor_type_id = sponsor_type.id
from public.social_sponsors as sponsor,
     public.social_post_audiences as audience,
     public.social_sponsor_types as sponsor_type
where assignment.sponsor_id = sponsor.id
  and assignment.audience_id = audience.id
  and sponsor.slug = 'bgv'
  and audience.slug = 'u15-c1-junioren'
  and sponsor_type.slug = 'trikotsponsor';
