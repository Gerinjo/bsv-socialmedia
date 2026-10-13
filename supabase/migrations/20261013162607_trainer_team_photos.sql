-- Central team artwork. Only the explicitly published images are public.
create table private.trainer_team_photos (
 team_id uuid primary key references public.social_teams(id) on delete cascade,
 photo_path text,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null,
 check(photo_path is null or photo_path ~ ('^'||team_id::text||'/[a-f0-9]{64}\.(jpg|png|webp)$'))
);
alter table private.trainer_team_photos enable row level security;
revoke all on private.trainer_team_photos from public,anon,authenticated;
grant select,insert,update on private.trainer_team_photos to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('team-photos','team-photos',true,5242880,array['image/jpeg','image/png','image/webp']);

alter function public.trainer_management_request(uuid,jsonb) rename to trainer_management_request_contacts;
alter function public.trainer_management_request_contacts(uuid,jsonb) set schema private;
revoke all on function private.trainer_management_request_contacts(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.trainer_management_request_contacts(uuid,jsonb) to service_role;

create function public.trainer_management_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; member public.social_admins; team public.social_teams; previous jsonb; path text;
begin
 if payload->>'action' in ('authorize_team_photo','save_team_photo') then
  select * into member from public.social_admins where user_id=actor for share;
  if not found or not member.is_active or member.is_blocked or (member.role<>'admin' and not 'trainer_management'=any(member.access_areas)) then
   return jsonb_build_object('error','Keine Berechtigung für die Mannschaftsverwaltung.','status',403);
  end if;
  select * into team from public.social_teams where id=(payload->>'teamId')::uuid for update;
  if not found then return jsonb_build_object('error','Mannschaft nicht gefunden.','status',404);end if;
  if team.trainer_version is distinct from (payload->>'version')::bigint then return jsonb_build_object('error','Die Mannschaft wurde inzwischen geändert. Bitte neu laden.','status',409);end if;
  if payload->>'action'='authorize_team_photo' then return jsonb_build_object('ok',true);end if;
  if not payload ? 'photoPath' then return jsonb_build_object('error','Bildangabe fehlt.','status',400);end if;
  path:=payload->>'photoPath';
  if path is not null and path !~ ('^'||team.id::text||'/[a-f0-9]{64}\.(jpg|png|webp)$') then return jsonb_build_object('error','Ungültiges Mannschaftsbild.','status',400);end if;
  select to_jsonb(p) into previous from private.trainer_team_photos p where team_id=team.id;
  insert into private.trainer_team_photos(team_id,photo_path,updated_by) values(team.id,path,actor)
   on conflict(team_id) do update set photo_path=excluded.photo_path,updated_at=now(),updated_by=actor;
  update public.social_teams set trainer_version=trainer_version+1 where id=team.id;
  insert into private.trainer_audit(actor,action,team_id,before_data,after_data)
   values(actor,'save_team_photo',team.id,previous,jsonb_build_object('photo_path',path));
  return jsonb_build_object('ok',true,'version',team.trainer_version+1);
 end if;
 result:=private.trainer_management_request_contacts(actor,payload);
 if result ? 'error' then return result;end if;
 if payload->>'action'='list' then
  return result||jsonb_build_object('teams',(
   select coalesce(jsonb_agg(t||jsonb_build_object('photoManaged',p.team_id is not null,'photoPath',p.photo_path) order by n),'[]')
   from jsonb_array_elements(result->'teams') with ordinality items(t,n)
   left join private.trainer_team_photos p on p.team_id=(t->>'id')::uuid
  ));
 end if;
 return result;
end $$;
revoke all on function public.trainer_management_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.trainer_management_request(uuid,jsonb) to service_role;

-- Separate service-only artwork lookup also used when preparing a new magazine.
create function public.team_photo_source(team uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('photoPath',photo_path) from private.trainer_team_photos where team_id=team;
$$;
revoke all on function public.team_photo_source(uuid) from public,anon,authenticated;
grant execute on function public.team_photo_source(uuid) to service_role;

create or replace function public.website_trainers_feed() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('teams',coalesce(jsonb_agg(jsonb_build_object('path',t.website_path,'photoManaged',photo.team_id is not null,'teamPhotoPath',photo.photo_path,'coaches',(
  select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(nullif(tp.website_name,''),p.display_name),'role',a.website_role,'qualification',tp.qualification,'club',tp.club,
    'image',coalesce(nullif(tp.website_photo_url,''),p.source_photo_url),'photoPath',tp.photo_path,
    'phone',case when tp.public_phone then coalesce(nullif(tp.mobile,''),tp.phone) else '' end)
    order by case a.staff_slot when 'trainer' then 0 when 'co1' then 1 when 'co2' then 2 when 'betreuer' then 3 else 4 end,a.staff_slot),'[]')
   from public.social_team_people a join public.social_people p on p.id=a.person_id and p.active join private.trainer_profiles tp on tp.person_id=p.id and tp.active where a.team_id=t.id and a.staff_slot is not null and a.website_visible
 )) order by t.sort_order,t.name),'[]')) from public.social_teams t left join private.trainer_team_photos photo on photo.team_id=t.id where (t.trainer_managed or photo.team_id is not null) and nullif(t.website_path,'') is not null;
$$;

revoke all on function public.website_trainers_feed() from public,anon,authenticated;
grant execute on function public.website_trainers_feed() to service_role;
