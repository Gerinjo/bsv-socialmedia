create table public.social_sponsor_website_assignments (
  sponsor_id uuid not null references public.social_sponsors(id) on delete cascade,
  audience_id uuid not null references public.social_post_audiences(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sponsor_id, audience_id)
);

create index social_sponsor_website_assignments_audience_idx
  on public.social_sponsor_website_assignments (audience_id, sponsor_id);

alter table public.social_sponsor_website_assignments enable row level security;

revoke all on public.social_sponsor_website_assignments from anon, authenticated;
grant select, insert, update, delete on public.social_sponsor_website_assignments to service_role;

comment on table public.social_sponsor_website_assignments is
  'Explizite Website-Sichtbarkeit von Werbepartnern auf Organisationen, Abteilungen und Mannschaften; unabhängig von Social-Media-Kontexten.';

-- Preserve the website visibility that previously resulted indirectly from any
-- Social-Media assignment. From now on both assignment types are independent.
insert into public.social_sponsor_website_assignments (sponsor_id, audience_id)
select distinct sponsor_id, audience_id
from public.social_sponsor_assignments
on conflict (sponsor_id, audience_id) do nothing;
