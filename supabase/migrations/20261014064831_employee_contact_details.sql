-- Employees share contacts with their trainer profile when one exists.
create table private.employee_contacts (
 person_id uuid primary key references public.social_people(id) on delete restrict,
 email text not null default '' check(length(email)<=254 and (email='' or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
 phone text not null default '' check(phone='' or phone ~ '^[+0-9 ()/.-]{3,50}$'),
 mobile text not null default '' check(mobile='' or mobile ~ '^[+0-9 ()/.-]{3,50}$'),
 public_phone boolean not null default false,version bigint not null default 1,
 updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null
);
create table private.employee_contact_routes (
 routing_key text primary key check(routing_key ~ '^person-[a-z0-9-]+$' and length(routing_key)<=160),
 person_id uuid not null references public.social_people(id) on delete restrict,
 preferred boolean not null default false
);
create index employee_contact_routes_person on private.employee_contact_routes(person_id);
alter table private.employee_contacts enable row level security;
alter table private.employee_contact_routes enable row level security;
revoke all on private.employee_contacts,private.employee_contact_routes from public,anon,authenticated;
grant select,insert,update on private.employee_contacts,private.employee_contact_routes to service_role;
insert into private.employee_contact_routes(routing_key,person_id)
 select distinct 'person-'||p.slug,p.id from public.social_people p join private.employee_assignments a on a.person_id=p.id where a.active;

create function private.employee_contact_data(person uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('email',coalesce(tp.email,c.email,''),'phone',coalesce(tp.phone,c.phone,''),'mobile',coalesce(tp.mobile,c.mobile,''),
  'publicPhone',coalesce(tp.public_phone,c.public_phone,false),'contactVersion',coalesce(tp.version,c.version,0),'contactSource',case when tp.person_id is null then 'employee' else 'trainer' end)
 from public.social_people p left join private.trainer_profiles tp on tp.person_id=p.id left join private.employee_contacts c on c.person_id=p.id where p.id=person;
$$;
revoke all on function private.employee_contact_data(uuid) from public,anon,authenticated;
grant execute on function private.employee_contact_data(uuid) to service_role;

create function private.inherit_employee_contacts() returns trigger language plpgsql security invoker set search_path='' as $$
declare contact private.employee_contacts;
begin
 select * into contact from private.employee_contacts where person_id=new.person_id;
 if found then
  if new.phone='' and new.mobile='' and contact.public_phone then new.public_phone:=true;end if;
  if new.email='' then new.email:=contact.email;end if;
  if new.phone='' then new.phone:=contact.phone;end if;
  if new.mobile='' then new.mobile:=contact.mobile;end if;
 end if;
 return new;
end $$;
revoke all on function private.inherit_employee_contacts() from public,anon,authenticated;
grant execute on function private.inherit_employee_contacts() to service_role;
create trigger trainer_inherit_employee_contacts before insert on private.trainer_profiles for each row execute function private.inherit_employee_contacts();

alter function public.employee_management_request(uuid,jsonb) rename to employee_management_request_roles;
alter function public.employee_management_request_roles(uuid,jsonb) set schema private;
revoke all on function private.employee_management_request_roles(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.employee_management_request_roles(uuid,jsonb) to service_role;
create function public.employee_management_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; member public.social_admins; pid uuid; expected bigint; prior jsonb; contact jsonb; mail text; telephone text; cell text; visible boolean;
begin
 if payload->>'action'<>'save_contact' then
  result:=private.employee_management_request_roles(actor,payload);
  if result ? 'error' then return result;end if;
  if payload->>'action'='list' then
   return result||jsonb_build_object('people',(select coalesce(jsonb_agg(p||private.employee_contact_data((p->>'id')::uuid) order by n),'[]') from jsonb_array_elements(result->'people') with ordinality rows(p,n)));
  end if;
  if payload->>'action'='save_assignment' and nullif(result->>'personId','') is not null then
   insert into private.employee_contact_routes(routing_key,person_id) select 'person-'||slug,id from public.social_people where id=(result->>'personId')::uuid on conflict do nothing;
  end if;
  return result;
 end if;
 select * into member from public.social_admins where user_id=actor for share;
 if not found or not member.is_active or member.is_blocked or (member.role<>'admin' and not 'trainer_management'=any(member.access_areas)) then return jsonb_build_object('error','Keine Berechtigung für Mitarbeiter.','status',403);end if;
 perform pg_advisory_xact_lock(7041956);
 pid:=(payload->>'personId')::uuid;expected:=(payload->>'version')::bigint;
 perform 1 from public.social_people p where p.id=pid and p.active and exists(select 1 from private.employee_assignments a where a.person_id=p.id and a.active) for update;
 if not found then return jsonb_build_object('error','Aktiver Mitarbeiter nicht gefunden.','status',404);end if;
 perform 1 from private.trainer_profiles where person_id=pid for update;
 perform 1 from private.employee_contacts where person_id=pid for update;
 prior:=private.employee_contact_data(pid);
 if expected is null or expected is distinct from (prior->>'contactVersion')::bigint or payload->>'contactSource' is distinct from prior->>'contactSource' then return jsonb_build_object('error','Die Kontaktdaten wurden inzwischen geändert. Bitte neu laden.','status',409);end if;
 mail:=lower(trim(coalesce(payload->>'email','')));telephone:=trim(coalesce(payload->>'phone',''));cell:=trim(coalesce(payload->>'mobile',''));visible:=coalesce((payload->>'publicPhone')::boolean,false);
 if length(mail)>254 or (mail<>'' and mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or (telephone<>'' and telephone !~ '^[+0-9 ()/.-]{3,50}$') or (cell<>'' and cell !~ '^[+0-9 ()/.-]{3,50}$') then return jsonb_build_object('error','Bitte E-Mail-Adresse und Telefonnummern prüfen.','status',400);end if;
 if prior->>'contactSource'='trainer' then
  update private.trainer_profiles set email=mail,phone=telephone,mobile=cell,public_phone=visible,version=version+1,updated_at=now(),updated_by=actor where person_id=pid;
 else
  insert into private.employee_contacts(person_id,email,phone,mobile,public_phone,updated_by) values(pid,mail,telephone,cell,visible,actor)
   on conflict(person_id) do update set email=excluded.email,phone=excluded.phone,mobile=excluded.mobile,public_phone=excluded.public_phone,version=employee_contacts.version+1,updated_at=now(),updated_by=actor;
 end if;
 contact:=private.employee_contact_data(pid);
 insert into private.trainer_audit(actor,action,person_id,before_data,after_data) values(actor,'employee_save_contact',pid,prior,contact);
 return jsonb_build_object('ok',true,'contactVersion',contact->'contactVersion');
end $$;
revoke all on function public.employee_management_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.employee_management_request(uuid,jsonb) to service_role;

create or replace function public.website_employee_groups() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('assignments',coalesce(jsonb_agg(jsonb_build_object(
  'id',a.id,'personId',a.person_id,'groupKey',a.group_key,'role',a.role_label,'name',coalesce(p.display_name,'Noch nicht besetzt'),
  'contactKey',case when nullif(contact->>'email','') is not null then (select routing_key from private.employee_contact_routes r where r.person_id=p.id order by preferred desc,length(routing_key),routing_key limit 1) end,
  'phone',case when (contact->>'publicPhone')::boolean then coalesce(nullif(contact->>'mobile',''),contact->>'phone') else '' end,
  'photoSource',case when a.person_id is not null then private.employee_photo_source(a.person_id,'role-'||a.id::text) else null end
 ) order by a.sort_order,a.id),'[]')) from private.employee_assignments a left join public.social_people p on p.id=a.person_id
 left join lateral private.employee_contact_data(p.id) contact on true
 where a.active and (a.person_id is null or p.active);
$$;

alter function public.resolve_trainer_contact(text,jsonb) rename to resolve_trainer_contact_base;
alter function public.resolve_trainer_contact_base(text,jsonb) set schema private;
revoke all on function private.resolve_trainer_contact_base(text,jsonb) from public,anon,authenticated;
grant execute on function private.resolve_trainer_contact_base(text,jsonb) to service_role;
create function public.resolve_trainer_contact(signature text,payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; person public.social_people; contact jsonb; enabled boolean;
begin
 result:=private.resolve_trainer_contact_base(signature,payload);
 if result ? 'error' then return result;end if;
 select p.* into person from private.employee_contact_routes r join public.social_people p on p.id=r.person_id where r.routing_key=payload->>'routingKey';
 if not found then return result;end if;
 enabled:=person.active and exists(select 1 from private.employee_assignments a where a.person_id=person.id and a.active);
 contact:=private.employee_contact_data(person.id);
 return jsonb_build_object('ok',true,'managed',true,'label',person.display_name,'emails',case when enabled and nullif(contact->>'email','') is not null then array[contact->>'email'] else '{}'::text[] end);
end $$;
revoke all on function public.resolve_trainer_contact(text,jsonb) from public,anon,authenticated;
grant execute on function public.resolve_trainer_contact(text,jsonb) to service_role;
