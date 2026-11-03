-- Dedicated permission; ordinary employee and salary access do not reveal contracts.
alter table public.social_admins drop constraint social_admins_access_areas_check;
alter table public.social_admins drop constraint social_admins_extra_areas_check;
alter table public.social_suite_roles drop constraint social_suite_roles_areas_check;
alter table public.social_admins add constraint social_admins_access_areas_check check(access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','user_management','cashbook','trainer_management','hall_training','resources','trainer_compensation','trainer_contracts']::text[]);
alter table public.social_admins add constraint social_admins_extra_areas_check check(extra_access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','cashbook','trainer_management','hall_training','resources','trainer_compensation','trainer_contracts']::text[]);
alter table public.social_suite_roles add constraint social_suite_roles_areas_check check(access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','user_management','cashbook','trainer_management','hall_training','resources','trainer_compensation','trainer_contracts']::text[]);
update public.social_suite_roles set access_areas=access_areas||'trainer_contracts'::text,updated_at=now() where key='admin' and not 'trainer_contracts'=any(access_areas);
update public.social_admins set suite_role_key=suite_role_key where suite_role_key='admin';

create table private.trainer_contracts(
 id uuid primary key default gen_random_uuid(),
 number bigint generated always as identity unique,
 season text not null check(season ~ '^20[0-9]{2}/20[0-9]{2}$'),
 person_id uuid references public.social_people(id) on delete set null,
 team_id uuid references public.social_teams(id) on delete set null,
 slot text not null check(slot in ('trainer','co1','co2') or slot ~ '^extra-[1-9][0-9]?$'),
 status text not null default 'draft' check(status in ('draft','issued','signed','cancelled')),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=60000),
 document_path text,document_hash text,signed_path text,signed_hash text,
 issued_at timestamptz,signed_at timestamptz,
 version bigint not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null,
 check((document_path is null and document_hash is null) or (document_path like id::text||'/issued/%' and document_hash ~ '^[a-f0-9]{64}$')),
 check((signed_path is null and signed_hash is null) or (signed_path like id::text||'/signed/%' and signed_hash ~ '^[a-f0-9]{64}$')),
 check(status not in ('issued','signed') or document_path is not null),check(status<>'signed' or signed_path is not null)
);
create unique index trainer_contracts_current on private.trainer_contracts(season,person_id,team_id,slot) where status<>'cancelled';
create index trainer_contracts_person on private.trainer_contracts(person_id);
create index trainer_contracts_team on private.trainer_contracts(team_id);
create index trainer_contracts_updated_by on private.trainer_contracts(updated_by);
create table private.trainer_contract_audit(id bigint generated always as identity primary key,contract_id uuid not null,actor uuid references auth.users(id) on delete set null,action text not null,version bigint not null,created_at timestamptz not null default now());
create index trainer_contract_audit_contract on private.trainer_contract_audit(contract_id);
create index trainer_contract_audit_actor on private.trainer_contract_audit(actor);
alter table private.trainer_contracts enable row level security;
alter table private.trainer_contract_audit enable row level security;
revoke all on private.trainer_contracts,private.trainer_contract_audit from public,anon,authenticated;
grant select,insert,update,delete on private.trainer_contracts to service_role;
grant select,insert on private.trainer_contract_audit to service_role;
grant usage,select on sequence private.trainer_contracts_number_seq,private.trainer_contract_audit_id_seq to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('trainer-contracts','trainer-contracts',false,8388608,array['application/pdf']) on conflict(id) do nothing;

create function public.trainer_contract_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare member public.social_admins;act text:=payload->>'action';season_key text:=payload->>'season';c private.trainer_contracts;expected bigint;new_snapshot jsonb;current_plan private.trainer_compensation_plans;person uuid;team uuid;slot_key text;annual record;
begin
 -- Match the trainer/name-sync lock order before holding a member row lock.
 perform pg_advisory_xact_lock(7041956);
 if act='issue' then perform pg_advisory_xact_lock(1956,1127);perform pg_advisory_xact_lock(1956,1128);end if;
 select * into member from public.social_admins where user_id=actor for share;
 if not found or not member.is_active or member.is_blocked or (member.role<>'admin' and not 'trainer_contracts'=any(member.access_areas)) then return jsonb_build_object('error','Keine Berechtigung für Trainerverträge.','status',403);end if;
 if act in ('list','source') then
  if season_key is null or season_key !~ '^20[0-9]{2}/20[0-9]{2}$' then return jsonb_build_object('error','Ungültige Saison.','status',400);end if;
  if substring(season_key,6,4)::int<>substring(season_key,1,4)::int+1 then return jsonb_build_object('error','Ungültige Saison.','status',400);end if;
  select * into current_plan from private.trainer_compensation_plans where season=season_key;
  return jsonb_build_object('season',season_key,'version',coalesce(current_plan.version,0),'plan',current_plan.plan,
   'teams',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'slug',t.slug,'name',t.name,'version',t.trainer_version) order by t.sort_order,t.slug),'[]') from public.social_teams t where t.slug in ('herren-1','herren-2','frauen-1','frauen-2') or t.slug ~ '^u[0-9]'),
   'people',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(trim(tp.first_name||' '||tp.last_name),''),p.display_name),'active',p.active and coalesce(tp.active,true),'version',coalesce(tp.version,0),'qualification',coalesce(tp.qualification,''),'birth_date',coalesce(p.birth_date::text,''),'street',coalesce(tp.street,''),'postcode',coalesce(tp.postcode,''),'city',coalesce(tp.city,''),'email',coalesce(tp.email,''),'previousBank',(select old.snapshot->'bank' from private.trainer_contracts old where old.person_id=p.id and old.status<>'cancelled' order by old.updated_at desc limit 1)) order by p.display_name),'[]') from public.social_people p left join private.trainer_profiles tp on tp.person_id=p.id where exists(select 1 from public.social_team_people a join public.social_teams t on t.id=a.team_id where a.person_id=p.id and a.staff_slot is not null and (t.slug in ('herren-1','herren-2','frauen-1','frauen-2') or t.slug ~ '^u[0-9]'))),
   'assignments',(select coalesce(jsonb_agg(jsonb_build_object('teamId',a.team_id,'personId',a.person_id,'slot',a.staff_slot,'websiteRole',coalesce(nullif(a.website_role,''),a.role))),'[]') from public.social_team_people a join public.social_teams t on t.id=a.team_id where a.staff_slot is not null and (t.slug in ('herren-1','herren-2','frauen-1','frauen-2') or t.slug ~ '^u[0-9]')),
   'contracts',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'number',d.number,'season',d.season,'personId',d.person_id,'teamId',d.team_id,'slot',d.slot,'name',d.snapshot->>'name','teamName',d.snapshot->>'teamName','status',d.status,'version',d.version,'updatedAt',d.updated_at,'issuedAt',d.issued_at,'signedAt',d.signed_at) order by d.updated_at desc),'[]') from private.trainer_contracts d where d.season=season_key),
   'annualTotals',(select coalesce(jsonb_agg(to_jsonb(totals)),'[]') from (select d.person_id as "personId",case when m.value::int between 7 and 11 then substring(d.season,1,4)::int else substring(d.season,6,4)::int end as year,sum((d.snapshot->>'monthlyCents')::bigint) as cents from private.trainer_contracts d cross join lateral jsonb_array_elements_text(d.snapshot->'paidMonths') m where d.status in ('issued','signed') group by d.person_id,year) totals));
 end if;
 if act='create' then
  person:=(payload->>'personId')::uuid;team:=(payload->>'teamId')::uuid;slot_key:=payload->>'slot';new_snapshot:=payload->'snapshot';
  if new_snapshot is null or new_snapshot->>'season' is distinct from season_key or new_snapshot->>'personId' is distinct from person::text or new_snapshot->>'teamId' is distinct from team::text or new_snapshot->>'slot' is distinct from slot_key then return jsonb_build_object('error','Ungültige Vertragszuordnung.','status',400);end if;
  if not exists(select 1 from public.social_team_people a join public.social_people p on p.id=a.person_id where a.person_id=person and a.team_id=team and a.staff_slot=slot_key and p.active) then return jsonb_build_object('error','Die Trainerposition ist nicht mehr aktiv zugeordnet.','status',409);end if;
  if exists(select 1 from private.trainer_contracts d where d.season=season_key and d.person_id=person and d.team_id=team and d.slot=slot_key and d.status<>'cancelled') then return jsonb_build_object('error','Für diese Position besteht bereits ein Vertrag. Bitte neu laden.','status',409);end if;
  insert into private.trainer_contracts(season,person_id,team_id,slot,snapshot,updated_by) values(season_key,person,team,slot_key,new_snapshot,actor) returning * into c;
 else
  select * into c from private.trainer_contracts where id=(payload->>'id')::uuid for update;
  if not found then return jsonb_build_object('error','Vertrag nicht gefunden.','status',404);end if;
  if act='get' then return to_jsonb(c);end if;
  if coalesce(payload->>'version','') !~ '^[0-9]{1,15}$' then return jsonb_build_object('error','Ungültiger Datenstand.','status',400);end if;expected:=(payload->>'version')::bigint;
  if expected<>c.version then return jsonb_build_object('error','Der Vertrag wurde inzwischen geändert. Bitte neu laden.','status',409);end if;
  if act='save' then
   if c.status<>'draft' then return jsonb_build_object('error','Freigegebene Verträge sind unveränderlich.','status',409);end if;
   new_snapshot:=payload->'snapshot';
   if new_snapshot->>'season' is distinct from c.season or new_snapshot->>'personId' is distinct from c.person_id::text or new_snapshot->>'teamId' is distinct from c.team_id::text or new_snapshot->>'slot' is distinct from c.slot then return jsonb_build_object('error','Die Vertragszuordnung kann nicht geändert werden.','status',400);end if;
   update private.trainer_contracts set snapshot=new_snapshot,version=version+1,updated_at=now(),updated_by=actor where id=c.id returning * into c;
  elsif act='issue' then
   perform 1 from private.trainer_profiles where person_id=c.person_id for share;
   perform 1 from public.social_people where id=c.person_id for share;
   perform 1 from public.social_teams where id=c.team_id for share;
   if c.status<>'draft' or c.person_id is null or c.team_id is null then return jsonb_build_object('error','Nur ein zugeordneter Entwurf kann freigegeben werden.','status',409);end if;
   if not exists(select 1 from public.social_team_people a join public.social_people p on p.id=a.person_id join private.trainer_profiles tp on tp.person_id=p.id join public.social_teams t on t.id=a.team_id where a.person_id=c.person_id and a.team_id=c.team_id and a.staff_slot=c.slot and p.active and tp.active and coalesce(p.birth_date::text,'')=coalesce(c.snapshot#>>'{source,birthDate}','') and t.name=c.snapshot#>>'{source,teamName}' and tp.version=(c.snapshot#>>'{source,personVersion}')::bigint and t.trainer_version=(c.snapshot#>>'{source,teamVersion}')::bigint) or coalesce((select version from private.trainer_compensation_plans where season=c.season),0)<>(c.snapshot#>>'{source,planVersion}')::bigint then return jsonb_build_object('error','Stammdaten oder Gehaltsplanung wurden geändert. Bitte die Quelldaten neu übernehmen.','status',409);end if;
   if c.snapshot->'financialConfirmed' is distinct from 'true'::jsonb or jsonb_typeof(c.snapshot->'monthlyCents') is distinct from 'number' or jsonb_array_length(c.snapshot->'paidMonths')=0 then return jsonb_build_object('error','Vergütung ist noch nicht bestätigt.','status',400);end if;
   -- Reserve the known BSV calendar-year amounts atomically across all seasons.
   for annual in select year,sum(cents) as cents from (
    select case when m.value::int between 7 and 11 then substring(d.season,1,4)::int else substring(d.season,6,4)::int end as year,(d.snapshot->>'monthlyCents')::bigint as cents from private.trainer_contracts d cross join lateral jsonb_array_elements_text(d.snapshot->'paidMonths') m where d.person_id=c.person_id and (d.status in ('issued','signed') or d.id=c.id)
   ) amounts group by year loop
    if annual.cents>(case when annual.year>=2026 then 330000 else 300000 end) then return jsonb_build_object('error','Die bekannten BSV-Vergütungen überschreiten den Übungsleiterfreibetrag im Kalenderjahr '||annual.year||'. Diese Vertragsvorlage kann dafür nicht freigegeben werden.','status',400);end if;
   end loop;
   update private.trainer_contracts set status='issued',document_path=payload->>'path',document_hash=payload->>'hash',issued_at=now(),version=version+1,updated_at=now(),updated_by=actor where id=c.id returning * into c;
  elsif act='signed' then
   if c.status<>'issued' or payload->'confirmed' is distinct from 'true'::jsonb then return jsonb_build_object('error','Bitte die erforderlichen Unterschriften am freigegebenen Vertrag bestätigen.','status',400);end if;
   update private.trainer_contracts set status='signed',signed_path=payload->>'path',signed_hash=payload->>'hash',signed_at=now(),version=version+1,updated_at=now(),updated_by=actor where id=c.id returning * into c;
  elsif act in ('cancel','delete') then
   if payload->'confirmed' is distinct from 'true'::jsonb then return jsonb_build_object('error','Bitte ausdrücklich bestätigen.','status',400);end if;
   if act='delete' and c.status<>'draft' then return jsonb_build_object('error','Nur Entwürfe können gelöscht werden.','status',400);end if;
   if act='delete' then delete from private.trainer_contracts where id=c.id;
   else update private.trainer_contracts set status='cancelled',version=version+1,updated_at=now(),updated_by=actor where id=c.id returning * into c;end if;
  else return jsonb_build_object('error','Unbekannte Vertragsaktion.','status',400);end if;
 end if;
 insert into private.trainer_contract_audit(contract_id,actor,action,version) values(c.id,actor,act,c.version);
 return jsonb_build_object('ok',true,'id',c.id,'version',c.version,'number',c.number);
exception when unique_violation then return jsonb_build_object('error','Für diese Position besteht bereits ein Vertrag. Bitte neu laden.','status',409);
end $$;
revoke all on function public.trainer_contract_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.trainer_contract_request(uuid,jsonb) to service_role;
