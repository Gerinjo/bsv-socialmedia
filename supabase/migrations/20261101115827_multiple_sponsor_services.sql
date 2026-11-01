-- Preserve every existing relationship; a partner can provide several services
-- to the same audience, each with its own description and magazine format.
alter table public.social_sponsor_website_assignments
  add column id uuid not null default gen_random_uuid(),
  drop constraint social_sponsor_website_assignments_pkey,
  add primary key (id),
  add constraint social_sponsor_website_assignments_service_key
    unique nulls not distinct (sponsor_id, audience_id, sponsor_type_id);

-- Removing a type must not turn several distinct services into conflicting,
-- untyped relationships. Types can be deactivated while retaining assignments.
alter table public.social_sponsor_website_assignments
  drop constraint social_sponsor_website_assignments_sponsor_type_id_fkey,
  add constraint social_sponsor_website_assignments_sponsor_type_id_fkey
    foreign key (sponsor_type_id) references public.social_sponsor_types(id) on delete restrict;

comment on column public.social_sponsor_website_assignments.sponsor_type_id is
  'Sponsorleistung dieser Beziehung; pro Partner und Zielgruppe sind mehrere unterschiedliche Sponsorarten möglich.';

-- Replace website services and social placements in one transaction. A failed
-- insert (including a concurrently occupied slot) rolls back both deletions.
create function public.save_social_sponsor_assignments(
  p_sponsor_id uuid,
  p_social jsonb,
  p_website jsonb,
  p_schema_version integer default 1
) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if jsonb_typeof(p_social) is distinct from 'array'
     or jsonb_typeof(p_website) is distinct from 'array' then
    raise exception 'Ungültige Sponsorzuordnungen.';
  end if;
  perform id from public.social_sponsors where id = p_sponsor_id for update;
  if not found then raise exception 'Der Werbepartner wurde nicht gefunden.'; end if;

  if coalesce(p_schema_version, 1) < 2 and exists (
    select 1 from public.social_sponsor_website_assignments
    where sponsor_id = p_sponsor_id group by audience_id having count(*) > 1
  ) then
    raise exception using errcode = 'PT409',
      message = 'Dieser Partner hat mehrere Sponsorleistungen. Bitte die Seite neu laden, bevor du die Zuordnungen speicherst.';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_website) as item(audience_id uuid, sponsor_type_id uuid)
    group by audience_id
    having count(*) > 1 and bool_or(sponsor_type_id is null)
  ) then
    raise exception 'Bitte für jede Sponsorleistung eine eigene Sponsorart auswählen.';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_website) as item(sponsor_type_id uuid, page_size text)
    left join public.social_sponsor_types kind on kind.id = item.sponsor_type_id
    where (kind.slug = 'stadionheft' and (item.page_size is null or item.page_size not in ('1','1/2','1/3','1/4','1/6')))
       or (kind.slug is distinct from 'stadionheft' and item.page_size is not null)
  ) then
    raise exception 'Bitte eine gültige Seitengröße ausschließlich für Stadionheft-Anzeigen auswählen.';
  end if;

  delete from public.social_sponsor_assignments where sponsor_id = p_sponsor_id;
  delete from public.social_sponsor_website_assignments where sponsor_id = p_sponsor_id;

  insert into public.social_sponsor_assignments(sponsor_id, audience_id, context, slot)
  select p_sponsor_id, item.audience_id, item.context, item.slot
  from jsonb_to_recordset(p_social) as item(audience_id uuid, context text, slot smallint);

  insert into public.social_sponsor_website_assignments(sponsor_id, audience_id, sponsor_type_id, page_size, description)
  select p_sponsor_id, item.audience_id, item.sponsor_type_id, item.page_size, coalesce(item.description, '')
  from jsonb_to_recordset(p_website) as item(audience_id uuid, sponsor_type_id uuid, page_size text, description text);
end;
$$;

revoke all on function public.save_social_sponsor_assignments(uuid, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_social_sponsor_assignments(uuid, jsonb, jsonb, integer) to service_role;
