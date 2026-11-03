-- Trainer compensation is private financial planning with a dedicated grant.
alter table public.social_admins drop constraint social_admins_access_areas_check;
alter table public.social_admins drop constraint social_admins_extra_areas_check;
alter table public.social_suite_roles drop constraint social_suite_roles_areas_check;
alter table public.social_admins add constraint social_admins_access_areas_check check(access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','user_management','cashbook','trainer_management','hall_training','resources','trainer_compensation']::text[]);
alter table public.social_admins add constraint social_admins_extra_areas_check check(extra_access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','cashbook','trainer_management','hall_training','resources','trainer_compensation']::text[]);
alter table public.social_suite_roles add constraint social_suite_roles_areas_check check(access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','user_management','cashbook','trainer_management','hall_training','resources','trainer_compensation']::text[]);
update public.social_suite_roles set access_areas=access_areas||'trainer_compensation'::text,updated_at=now() where key='admin' and not 'trainer_compensation'=any(access_areas);
update public.social_admins set suite_role_key=suite_role_key where suite_role_key='admin';

create table private.trainer_compensation_plans(
 season text primary key check(season ~ '^20[0-9]{2}/20[0-9]{2}$' and substring(season,6,4)::int=substring(season,1,4)::int+1),
 plan jsonb not null check(jsonb_typeof(plan)='object' and (plan->>'schemaVersion')::int=1 and plan->>'season'=season and jsonb_typeof(plan->'youthRates')='object' and jsonb_typeof(plan->'teams')='object' and jsonb_typeof(plan->'assignments')='object' and octet_length(plan::text)<=250000),
 version bigint not null default 1 check(version>0),
 updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null
);
create table private.trainer_compensation_audit(
 id bigint generated always as identity primary key,season text not null,
 actor uuid references auth.users(id) on delete set null,before_data jsonb,after_data jsonb not null,created_at timestamptz not null default now()
);
alter table private.trainer_compensation_plans enable row level security;
alter table private.trainer_compensation_audit enable row level security;
revoke all on private.trainer_compensation_plans,private.trainer_compensation_audit from public,anon,authenticated;
grant select,insert,update on private.trainer_compensation_plans to service_role;
grant select,insert on private.trainer_compensation_audit to service_role;
grant usage,select on sequence private.trainer_compensation_audit_id_seq to service_role;

create function public.trainer_compensation_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare member public.social_admins; act text:=payload->>'action'; season_key text:=payload->>'season'; current_plan private.trainer_compensation_plans; expected bigint; new_plan jsonb;
begin
 select * into member from public.social_admins where user_id=actor for share;
 if not found or not member.is_active or member.is_blocked or (member.role<>'admin' and not 'trainer_compensation'=any(member.access_areas)) then return jsonb_build_object('error','Keine Berechtigung für Trainergehälter.','status',403);end if;
 if season_key is null or season_key !~ '^20[0-9]{2}/20[0-9]{2}$' then return jsonb_build_object('error','Ungültige Saison.','status',400);end if;
 if substring(season_key,6,4)::int<>substring(season_key,1,4)::int+1 then return jsonb_build_object('error','Ungültige Saison.','status',400);end if;
 if act='list' then
  select * into current_plan from private.trainer_compensation_plans where season=season_key;
  return jsonb_build_object('season',season_key,'version',coalesce(current_plan.version,0),'plan',current_plan.plan,
   'teams',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'slug',t.slug,'name',t.name,'active',t.active) order by case when t.slug in ('herren-1','herren-2','frauen-1','frauen-2') then 0 else 1 end,t.sort_order,t.slug),'[]') from public.social_teams t where t.slug in ('herren-1','herren-2','frauen-1','frauen-2') or t.slug ~ '^u[0-9]'),
   'people',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'active',p.active and coalesce(tp.active,true),'qualification',coalesce(tp.qualification,'')) order by p.display_name),'[]') from public.social_people p left join private.trainer_profiles tp on tp.person_id=p.id where exists(select 1 from public.social_team_people a join public.social_teams t on t.id=a.team_id where a.person_id=p.id and a.staff_slot is not null and (t.slug in ('herren-1','herren-2','frauen-1','frauen-2') or t.slug ~ '^u[0-9]'))),
   'assignments',(select coalesce(jsonb_agg(jsonb_build_object('teamId',a.team_id,'personId',a.person_id,'slot',a.staff_slot,'websiteRole',coalesce(nullif(a.website_role,''),a.role)) order by a.team_id,a.staff_slot),'[]') from public.social_team_people a join public.social_teams t on t.id=a.team_id where a.staff_slot is not null and (t.slug in ('herren-1','herren-2','frauen-1','frauen-2') or t.slug ~ '^u[0-9]')));
 end if;
 if act<>'save' then return jsonb_build_object('error','Unbekannte Vergütungsaktion.','status',400);end if;
 new_plan:=payload->'plan';
 if new_plan is null or jsonb_typeof(new_plan)<>'object' or coalesce(new_plan->>'schemaVersion','')<>'1' or new_plan->>'season' is distinct from season_key or jsonb_typeof(new_plan->'youthRates') is distinct from 'object' or jsonb_typeof(new_plan->'teams') is distinct from 'object' or jsonb_typeof(new_plan->'assignments') is distinct from 'object' or octet_length(new_plan::text)>250000 then return jsonb_build_object('error','Ungültige Vergütungsplanung.','status',400);end if;
 if coalesce(payload->>'version','') !~ '^[0-9]{1,15}$' then return jsonb_build_object('error','Ungültiger Datenstand.','status',400);end if;
 expected:=(payload->>'version')::bigint;
 perform pg_advisory_xact_lock(1956,1127);
 select * into current_plan from private.trainer_compensation_plans where season=season_key for update;
 if expected<>coalesce(current_plan.version,0) then return jsonb_build_object('error','Die Planung wurde inzwischen geändert. Bitte neu laden.','status',409);end if;
 insert into private.trainer_compensation_plans(season,plan,updated_by) values(season_key,new_plan,actor)
 on conflict(season) do update set plan=excluded.plan,version=private.trainer_compensation_plans.version+1,updated_at=now(),updated_by=actor;
 insert into private.trainer_compensation_audit(season,actor,before_data,after_data) values(season_key,actor,current_plan.plan,new_plan);
 return jsonb_build_object('ok',true,'version',expected+1);
end $$;
revoke all on function public.trainer_compensation_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.trainer_compensation_request(uuid,jsonb) to service_role;
