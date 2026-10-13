-- Private team mailboxes complement the published, active trainer assignments.
create table private.trainer_team_contact_emails (
 team_id uuid primary key references public.social_teams(id) on delete cascade,
 emails text[] not null default '{}' check(cardinality(emails)<=20)
);
alter table private.trainer_team_contact_emails enable row level security;
revoke all on private.trainer_team_contact_emails from public,anon,authenticated;
grant select,insert,update,delete on private.trainer_team_contact_emails to service_role;

-- Keep the existing authorization, lifecycle, revisions and audit implementation.
alter function public.trainer_management_request(uuid,jsonb) rename to trainer_management_request_base;
alter function public.trainer_management_request_base(uuid,jsonb) set schema private;
revoke all on function private.trainer_management_request_base(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.trainer_management_request_base(uuid,jsonb) to service_role;

create function public.trainer_management_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; team uuid; contacts text[]; previous text[];
begin
 if payload->>'action'='save_team' and payload ? 'contactEmails' then
  if jsonb_typeof(payload->'contactEmails') is distinct from 'array' then
   return jsonb_build_object('error','Bitte gültige zusätzliche E-Mail-Adressen eingeben.','status',400);
  end if;
  if jsonb_array_length(payload->'contactEmails')>20 or exists(
   select 1 from jsonb_array_elements(payload->'contactEmails') e
   where jsonb_typeof(e)<>'string' or length(trim(e#>>'{}'))>254 or trim(e#>>'{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then return jsonb_build_object('error','Bitte höchstens 20 gültige zusätzliche E-Mail-Adressen eingeben.','status',400);end if;
  select coalesce(array_agg(email order by email),'{}') into contacts
   from (select distinct lower(trim(value)) email from jsonb_array_elements_text(payload->'contactEmails')) e;
 end if;
 result:=private.trainer_management_request_base(actor,payload);
 if result ? 'error' then return result;end if;
 if payload->>'action'='list' then
  return result||jsonb_build_object('teams',(
   select coalesce(jsonb_agg(t||jsonb_build_object('contactEmails',coalesce(c.emails,'{}')) order by n),'[]')
   from jsonb_array_elements(result->'teams') with ordinality items(t,n)
   left join private.trainer_team_contact_emails c on c.team_id=(t->>'id')::uuid
  ));
 end if;
 if payload->>'action'='save_team' and payload ? 'contactEmails' then
  team:=(payload->>'teamId')::uuid;
  select emails into previous from private.trainer_team_contact_emails where team_id=team;
  insert into private.trainer_team_contact_emails(team_id,emails) values(team,contacts)
   on conflict(team_id) do update set emails=excluded.emails;
  if coalesce(previous,'{}') is distinct from contacts then
   insert into private.trainer_audit(actor,action,team_id,before_data,after_data)
   values(actor,'save_team_contacts',team,jsonb_build_object('contactEmails',coalesce(previous,'{}')),jsonb_build_object('contactEmails',contacts));
  end if;
 end if;
 return result;
end $$;
revoke all on function public.trainer_management_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.trainer_management_request(uuid,jsonb) to service_role;

-- The website signs a short-lived lookup with the existing private bridge key.
-- Addresses are available to its server only, never through the public feed.
create function public.resolve_trainer_contact(signature text,payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare team public.social_teams; contacts text[]; requested_at timestamptz; person record;
begin
 if signature is null or signature !~ '^[a-f0-9]{64}$' or not exists(
  select 1 from private.trainer_onboarding_bridge b
  where encode(extensions.hmac(payload::text,b.secret_hash,'sha256'),'hex')=signature
 ) then return jsonb_build_object('error','unauthorized','status',401);end if;
 if payload->>'purpose' is distinct from 'trainer-contact' or coalesce(payload->>'routingKey','') !~ '^(team--[a-z0-9-]+(--[a-z0-9-]+)*|person-[a-z0-9-]+)$' or length(payload->>'routingKey')>160 then
  return jsonb_build_object('error','invalid_lookup','status',400);
 end if;
 begin requested_at:=(payload->>'requestedAt')::timestamptz;exception when others then return jsonb_build_object('error','invalid_lookup','status',400);end;
 if requested_at is null or requested_at<now()-interval '2 minutes' or requested_at>now()+interval '30 seconds' then
  return jsonb_build_object('error','expired_lookup','status',401);
 end if;
 if payload->>'routingKey' like 'person-%' then
  select p.display_name,p.active and tp.active active,tp.email into person
   from public.social_people p join private.trainer_profiles tp on tp.person_id=p.id
   where 'person-'||p.slug=payload->>'routingKey';
  if not found then
   -- Shared person identities survive profile deletion; never revive an old mail route.
   if exists(select 1 from public.social_people p join private.trainer_audit a on a.person_id=p.id and a.action='delete_person' where 'person-'||p.slug=payload->>'routingKey') then
    return jsonb_build_object('ok',true,'managed',true,'label','Ehemalige Ansprechperson','emails','[]'::jsonb);
   end if;
   return jsonb_build_object('ok',true,'managed',false);
  end if;
  return jsonb_build_object('ok',true,'managed',true,'label',person.display_name,'emails',case when person.active and nullif(trim(person.email),'') is not null then array[lower(trim(person.email))] else '{}'::text[] end);
 end if;
 select * into team from public.social_teams t
  where t.trainer_managed and 'team--'||replace(t.website_path,'/','--')=payload->>'routingKey';
 if not found then return jsonb_build_object('ok',true,'managed',false);end if;
 select coalesce(array_agg(email order by priority,slot,email),'{}') into contacts from (
  select email,min(priority) priority,min(slot) slot from (
   select lower(trim(tp.email)) email,0 priority,
    case a.staff_slot when 'trainer' then 0 when 'co1' then 1 when 'co2' then 2 when 'betreuer' then 3 else 4 end slot
   from public.social_team_people a
   join public.social_people p on p.id=a.person_id and p.active
   join private.trainer_profiles tp on tp.person_id=p.id and tp.active
   where a.team_id=team.id and a.staff_slot is not null and a.website_visible and nullif(trim(tp.email),'') is not null
   union all
   select lower(trim(email)),1,5 from private.trainer_team_contact_emails c cross join lateral unnest(c.emails) email where c.team_id=team.id
  ) all_contacts group by email
 ) unique_contacts;
 return jsonb_build_object('ok',true,'managed',true,'label',team.name,'emails',contacts);
end $$;
revoke all on function public.resolve_trainer_contact(text,jsonb) from public,anon,authenticated;
grant execute on function public.resolve_trainer_contact(text,jsonb) to service_role;
