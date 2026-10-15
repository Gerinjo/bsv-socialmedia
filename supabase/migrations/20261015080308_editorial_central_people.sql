-- Only selected editorial portrait copies are public for durable email delivery.
-- Central personnel uploads and private magazine archives remain private.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('editorial-public-images','editorial-public-images',true,5242880,array['image/jpeg','image/png','image/webp'])
 on conflict(id) do nothing;

-- The editorial service receives identities, current public roles and portrait
-- sources, never personnel addresses, birthdays, account details or notes.
create function public.editorial_people_catalog() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'display_name',p.display_name,'active',true,
  'photo_source',private.employee_photo_source(p.id,'editorial'),
  'roles',coalesce((select jsonb_agg(distinct label order by label) from (
    select a.role_label label from private.employee_assignments a where a.person_id=p.id and a.active
    union all
    select r from unnest(p.roles) r where r !~* '(vorstand|vorsitz|jugendleit)'
  ) roles),'[]'),
  'role_photos',coalesce((select jsonb_agg(jsonb_build_object('role',a.role_label,'group',a.group_key,
    'photo_source',private.employee_photo_source(p.id,'role-'||a.id::text)) order by a.sort_order,a.id)
    from private.employee_assignments a where a.person_id=p.id and a.active),'[]'),
  'teams',coalesce((select jsonb_agg(jsonb_build_object('team_id',a.team_id,'role',a.role,
    'photo_source',private.employee_photo_source(p.id,'trainer')) order by a.team_id,a.role)
    from public.social_team_people a where a.person_id=p.id),'[]')
 ) order by p.display_name,p.id),'[]') from public.social_people p
 left join private.trainer_profiles tp on tp.person_id=p.id
 where p.active and (tp.person_id is null or tp.active or exists(select 1 from private.employee_assignments a where a.person_id=p.id and a.active));
$$;
revoke all on function public.editorial_people_catalog() from public,anon,authenticated;
grant execute on function public.editorial_people_catalog() to service_role;
