-- Trainer email addresses stay private, including previously approved addresses.
-- The homepage envelope links to the team contact form.
create or replace function public.website_trainers_feed() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('teams',coalesce(jsonb_agg(jsonb_build_object('path',t.website_path,'coaches',(
  select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(nullif(tp.website_name,''),p.display_name),'role',a.website_role,'qualification',tp.qualification,'club',tp.club,
    'image',coalesce(nullif(tp.website_photo_url,''),p.source_photo_url),'photoPath',tp.photo_path,
    'phone',case when tp.public_phone then coalesce(nullif(tp.mobile,''),tp.phone) else '' end)
    order by case a.staff_slot when 'trainer' then 0 when 'co1' then 1 when 'co2' then 2 when 'betreuer' then 3 else 4 end,a.staff_slot),'[]')
   from public.social_team_people a join public.social_people p on p.id=a.person_id and p.active join private.trainer_profiles tp on tp.person_id=p.id and tp.active where a.team_id=t.id and a.staff_slot is not null and a.website_visible
 )) order by t.sort_order,t.name),'[]')) from public.social_teams t where t.trainer_managed and nullif(t.website_path,'') is not null;
$$;

revoke all on function public.website_trainers_feed() from public,anon,authenticated;
grant execute on function public.website_trainers_feed() to service_role;
