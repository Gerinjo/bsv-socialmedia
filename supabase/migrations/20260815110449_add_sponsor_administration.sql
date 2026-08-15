create table public.social_sponsors (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null unique check (char_length(name) between 1 and 120),
  website_url text,
  instagram_handle text check (
    instagram_handle is null
    or instagram_handle ~ '^@?[A-Za-z0-9._]{1,30}$'
  ),
  logo_source_url text,
  logo_original_path text,
  logo_transparent_path text,
  logo_white_path text,
  logo_status text not null default 'missing'
    check (logo_status in ('missing', 'needs_review', 'approved', 'rejected')),
  processing_metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  sort_order smallint not null default 100 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.social_sponsor_assignments (
  sponsor_id uuid not null references public.social_sponsors(id) on delete cascade,
  audience_id uuid not null references public.social_post_audiences(id) on delete cascade,
  context text not null check (context in (
    'announcement', 'lineup', 'result', 'report', 'birthday', 'post'
  )),
  slot smallint not null check (slot in (1, 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (sponsor_id, audience_id, context),
  unique (audience_id, context, slot)
);

create index social_sponsors_active_sort_idx
  on public.social_sponsors (sort_order, name)
  where active;

create index social_sponsor_assignments_lookup_idx
  on public.social_sponsor_assignments (audience_id, context, slot);

alter table public.social_sponsors enable row level security;
alter table public.social_sponsor_assignments enable row level security;

revoke all on public.social_sponsors from anon, authenticated;
revoke all on public.social_sponsor_assignments from anon, authenticated;

grant select, insert, update, delete on public.social_sponsors to service_role;
grant select, insert, update, delete on public.social_sponsor_assignments to service_role;

create trigger social_sponsors_set_updated_at
before update on public.social_sponsors
for each row execute function private.set_updated_at();

create trigger social_sponsor_assignments_set_updated_at
before update on public.social_sponsor_assignments
for each row execute function private.set_updated_at();

insert into public.social_sponsors (
  slug,
  name,
  logo_source_url,
  logo_white_path,
  logo_status,
  processing_metadata,
  sort_order
)
values (
  'sparkasse-hegau-bodensee',
  'Sparkasse Hegau-Bodensee',
  'https://www.sparkasse-hegau-bodensee.de/',
  'assets/sparkasse-hegau-bodensee-white.png',
  'approved',
  '{"method":"legacy-white-asset","reviewed":true}'::jsonb,
  10
)
on conflict (slug) do nothing;

insert into public.social_sponsor_assignments (sponsor_id, audience_id, context, slot)
select sponsor.id, audience.id, 'announcement', 1
from public.social_sponsors as sponsor
join public.social_post_audiences as audience on audience.slug = 'gesamtverein'
where sponsor.slug = 'sparkasse-hegau-bodensee'
on conflict do nothing;
