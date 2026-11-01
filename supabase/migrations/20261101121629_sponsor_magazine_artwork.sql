alter table public.social_sponsors
  add column magazine_ad_original_path text,
  add column magazine_ad_path text,
  add column magazine_ad_status text not null default 'missing'
    check (magazine_ad_status in ('missing','needs_review','approved','rejected')),
  add column magazine_ad_metadata jsonb not null default '{}'::jsonb,
  add constraint social_sponsors_approved_magazine_artwork_check
    check (magazine_ad_status <> 'approved' or magazine_ad_path is not null);

comment on column public.social_sponsors.magazine_ad_path is
  'Eigenständiges PNG-Anzeigenmotiv für das Stadionheft; unabhängig vom Digitallogo und dessen Freigabe.';

-- Preserve the artwork already used in the magazine. Digital uploads now use
-- new versioned paths, and deletion protects these shared legacy references.
update public.social_sponsors s
set magazine_ad_original_path = coalesce(s.logo_original_path, s.logo_transparent_path),
    magazine_ad_path = s.logo_transparent_path,
    magazine_ad_status = 'approved',
    magazine_ad_metadata = jsonb_build_object('method','existing-approved-artwork','reviewed',true)
where s.logo_status = 'approved' and s.logo_transparent_path is not null
  and exists (
    select 1 from public.social_sponsor_website_assignments a
    join public.social_sponsor_types t on t.id = a.sponsor_type_id
    where a.sponsor_id = s.id and t.slug = 'stadionheft'
  );
