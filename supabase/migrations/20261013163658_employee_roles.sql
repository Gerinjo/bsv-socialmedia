-- Employees share social_people identities with trainers, cashbook and logins.
create table private.employee_assignments (
 id uuid primary key default gen_random_uuid(),
 person_id uuid references public.social_people(id) on delete restrict,
 group_key text not null check(group_key in ('executive','board','youth','supporters')),
 role_label text not null check(length(trim(role_label)) between 1 and 100),
 sort_order integer not null default 100,
 active boolean not null default true,
 version bigint not null default 1,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null
);
create index employee_assignments_person on private.employee_assignments(person_id);
create unique index employee_assignments_identity on private.employee_assignments(group_key,person_id,role_label) where active and person_id is not null;
create table private.employee_role_photos (
 person_id uuid not null references public.social_people(id) on delete restrict,
 role_key text not null check(role_key ~ '^role-[a-f0-9-]{36}$'),
 photo_path text not null check(photo_path ~ ('^'||person_id::text||'/[a-f0-9]{64}\.(jpg|png|webp)$')),
 updated_at timestamptz not null default now(),
 primary key(person_id,role_key)
);
alter table private.employee_assignments enable row level security;
alter table private.employee_role_photos enable row level security;
revoke all on private.employee_assignments,private.employee_role_photos from public,anon,authenticated;
grant select,insert,update on private.employee_assignments to service_role;
grant select,insert,update,delete on private.employee_role_photos to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('employee-portraits','employee-portraits',false,5242880,array['image/jpeg','image/png','image/webp']);

-- An own role upload takes priority. Otherwise display another upload of the same
-- person, dynamically; never duplicate assets or overwrite a role's own picture.
create function private.employee_photo_source(person uuid,target_role text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce((
  select jsonb_build_object('bucket',bucket,'path',path,'inherited',source_role<>target_role,'sourceRole',source_role)
  from (
   select 'employee-portraits'::text bucket,photo.photo_path path,photo.role_key source_role,photo.updated_at,
    case when photo.role_key=target_role then 0 else 1 end priority
   from private.employee_role_photos photo join private.employee_assignments a on photo.role_key='role-'||a.id::text and a.person_id=photo.person_id and a.active
   where photo.person_id=person
   union all
   select 'trainer-portraits',tp.photo_path,'trainer',tp.updated_at,case when target_role='trainer' then 0 else 1 end
   from private.trainer_profiles tp where tp.person_id=person and tp.photo_path is not null
  ) uploads order by priority,updated_at desc,source_role limit 1
 ),jsonb_build_object('url',(select coalesce(nullif(tp.website_photo_url,''),p.source_photo_url) from public.social_people p left join private.trainer_profiles tp on tp.person_id=p.id where p.id=person),'inherited',false));
$$;
revoke all on function private.employee_photo_source(uuid,text) from public,anon,authenticated;
grant execute on function private.employee_photo_source(uuid,text) to service_role;

create function public.website_employee_groups() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('assignments',coalesce(jsonb_agg(jsonb_build_object(
  'id',a.id,'personId',a.person_id,'groupKey',a.group_key,'role',a.role_label,'name',coalesce(p.display_name,'Noch nicht besetzt'),
  'photoSource',case when a.person_id is not null then private.employee_photo_source(a.person_id,'role-'||a.id::text) else null end
 ) order by a.sort_order,a.id),'[]')) from private.employee_assignments a left join public.social_people p on p.id=a.person_id where a.active and (a.person_id is null or p.active);
$$;
revoke all on function public.website_employee_groups() from public,anon,authenticated;
grant execute on function public.website_employee_groups() to service_role;

create function public.employee_management_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare member public.social_admins; act text:=payload->>'action'; assignment private.employee_assignments; aid uuid; pid uuid; expected bigint; label text; grp text; old_data jsonb; result jsonb; path text; rolekey text; first_name text; last_name text;
begin
 select * into member from public.social_admins where user_id=actor for share;
 if not found or not member.is_active or member.is_blocked or (member.role<>'admin' and not 'trainer_management'=any(member.access_areas)) then return jsonb_build_object('error','Keine Berechtigung für Mitarbeiter.','status',403);end if;
 if act='list' then
  return jsonb_build_object('people',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'active',p.active) order by p.display_name),'[]') from public.social_people p),
   'assignments',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('personId',a.person_id,'groupKey',a.group_key,'roleKey','role-'||a.id::text,'roleLabel',a.role_label,'name',coalesce(p.display_name,'Noch nicht besetzt'),'photoSource',case when a.person_id is not null then private.employee_photo_source(a.person_id,'role-'||a.id::text) else null end) order by a.sort_order,a.id),'[]') from private.employee_assignments a left join public.social_people p on p.id=a.person_id where a.active));
 end if;
 perform pg_advisory_xact_lock(7041956);
 if act in ('authorize_photo','save_photo','clear_photo') then
  pid:=(payload->>'personId')::uuid;rolekey:=payload->>'roleKey';
  if coalesce(rolekey,'') !~ '^role-[a-f0-9-]{36}$' then return jsonb_build_object('error','Ungültige Rolle.','status',400);end if;
  aid:=substr(rolekey,6)::uuid;
 else aid:=nullif(payload->>'assignmentId','')::uuid;end if;
 expected:=coalesce((payload->>'version')::bigint,0);
 if aid is not null then
  select * into assignment from private.employee_assignments where id=aid and active for update;
  if not found then return jsonb_build_object('error','Rolle nicht gefunden.','status',404);end if;
  if expected is distinct from assignment.version then return jsonb_build_object('error','Die Rolle wurde inzwischen geändert. Bitte neu laden.','status',409);end if;
 end if;
 if act in ('authorize_photo','save_photo','clear_photo') then
  if aid is null or pid is distinct from assignment.person_id then return jsonb_build_object('error','Person gehört nicht zu dieser Rolle.','status',400);end if;
  if act='authorize_photo' then return jsonb_build_object('ok',true);end if;
  path:=payload->>'photoPath';
  if act='save_photo' and (path is null or path !~ ('^'||pid::text||'/[a-f0-9]{64}\.(jpg|png|webp)$')) then return jsonb_build_object('error','Ungültiges Personenbild.','status',400);end if;
  select to_jsonb(photo) into old_data from private.employee_role_photos photo where person_id=pid and role_key=rolekey;
  if act='clear_photo' then delete from private.employee_role_photos where person_id=pid and role_key=rolekey;
  else insert into private.employee_role_photos(person_id,role_key,photo_path) values(pid,rolekey,path) on conflict(person_id,role_key) do update set photo_path=excluded.photo_path,updated_at=now();end if;
  update private.employee_assignments set version=version+1,updated_at=now(),updated_by=actor where id=aid;
  insert into private.trainer_audit(actor,action,person_id,before_data,after_data) values(actor,'employee_'||act,pid,old_data,jsonb_build_object('roleKey',rolekey,'photoPath',case when act='save_photo' then path else null end));
  return jsonb_build_object('ok',true,'version',assignment.version+1);
 end if;
 if act='remove_assignment' then
  if aid is null then return jsonb_build_object('error','Rolle fehlt.','status',400);end if;
  update private.employee_assignments set active=false,version=version+1,updated_at=now(),updated_by=actor where id=aid;
  insert into private.trainer_audit(actor,action,person_id,before_data,after_data) values(actor,'employee_remove_assignment',assignment.person_id,to_jsonb(assignment),jsonb_build_object('active',false));
  return jsonb_build_object('ok',true);
 end if;
 if act='save_assignment' then
  grp:=payload->>'groupKey';label:=trim(payload->>'roleLabel');pid:=nullif(payload->>'personId','')::uuid;
  if grp not in ('executive','board','youth','supporters') or grp is null or coalesce(length(label),0) not between 1 and 100 then return jsonb_build_object('error','Bitte Personenkreis und Rolle prüfen.','status',400);end if;
  first_name:=trim(coalesce(payload->>'firstName',''));last_name:=trim(coalesce(payload->>'lastName',''));
  if aid is null and expected<>0 then return jsonb_build_object('error','Bitte neu laden.','status',409);end if;
  if pid is null and (first_name<>'' or last_name<>'') then
   if length(first_name) not between 1 and 80 or length(last_name) not between 1 and 100 then return jsonb_build_object('error','Bitte Vor- und Nachname eingeben.','status',400);end if;
   if exists(select 1 from public.social_people where lower(display_name)=lower(first_name||' '||last_name)) then return jsonb_build_object('error','Diese Person gibt es bereits. Bitte aus der Liste auswählen.','status',409);end if;
   pid:=gen_random_uuid();insert into public.social_people(id,slug,display_name,roles,active) values(pid,'employee-'||pid::text,first_name||' '||last_name,'{}',true);
  end if;
  if pid is not null and not exists(select 1 from public.social_people where id=pid and active) then return jsonb_build_object('error','Bitte eine aktive Person auswählen.','status',400);end if;
  if exists(select 1 from private.employee_assignments where group_key=grp and person_id=pid and role_label=label and active and id is distinct from aid) then return jsonb_build_object('error','Diese Zuordnung besteht bereits.','status',409);end if;
  if aid is null then
   if expected<>0 then return jsonb_build_object('error','Bitte neu laden.','status',409);end if;
   insert into private.employee_assignments(person_id,group_key,role_label,updated_by) values(pid,grp,label,actor) returning * into assignment;aid:=assignment.id;
  else
   old_data:=to_jsonb(assignment);
   update private.employee_assignments set person_id=pid,group_key=grp,role_label=label,version=version+1,updated_at=now(),updated_by=actor where id=aid returning * into assignment;
  end if;
  insert into private.trainer_audit(actor,action,person_id,before_data,after_data) values(actor,'employee_save_assignment',pid,old_data,to_jsonb(assignment));
  return jsonb_build_object('ok',true,'assignmentId',aid,'personId',pid,'version',assignment.version);
 end if;
 return jsonb_build_object('error','Unbekannte Mitarbeiteraktion.','status',400);
end $$;
revoke all on function public.employee_management_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.employee_management_request(uuid,jsonb) to service_role;

do $seed$
declare item record; person uuid;
begin
 for item in select * from (values
('Sandra Fuchs','employee-sandra-fuchs','executive','1. Vorstand','https://bsvnordstern.de/images/verein/personen/sandra-fuchs.jpg',1),
('Sandra Fuchs','employee-sandra-fuchs','board','1. Vorstand','https://bsvnordstern.de/images/verein/personen/sandra-fuchs.jpg',2),
('Felix Schüle','employee-felix-schule','executive','2. Vorstand','https://bsvnordstern.de/images/verein/personen/felix-schuele.jpg',3),
('Felix Schüle','employee-felix-schule','board','2. Vorstand','https://bsvnordstern.de/images/verein/personen/felix-schuele.jpg',4),
('Claudia Gastaudo','employee-claudia-gastaudo','executive','Kassiererin','https://bsvnordstern.de/images/verein/personen/claudia-gastaudo.jpg',5),
('Claudia Gastaudo','employee-claudia-gastaudo','board','Kassiererin','https://bsvnordstern.de/images/verein/personen/claudia-gastaudo.jpg',6),
('Michaela Auer','employee-michaela-auer','executive','Schriftführerin','https://bsvnordstern.de/images/verein/personen/michaela-auer.jpg',7),
('Michaela Auer','employee-michaela-auer','board','Schriftführerin','https://bsvnordstern.de/images/verein/personen/michaela-auer.jpg',8),
('Felix Schüle','employee-felix-schule','board','Sportlicher Leiter Herren','https://bsvnordstern.de/images/verein/personen/felix-schuele.jpg',9),
('Ann-Kathrin Sugg','employee-ann-kathrin-sugg','board','Sportliche Leitung Frauen','https://bsvnordstern.de/images/verein/personen/ann-kathrin-sugg.jpg',10),
('Karsten Grammel','employee-karsten-grammel','board','Sportliche Leitung Alte Herren',null,11),
('Oliver Schillinger','employee-oliver-schillinger','board','Spielbetrieb',null,12),
('Manuel Schellhammer','employee-manuel-schellhammer','board','Passwesen','https://bsvnordstern.de/images/verein/personen/manuel-schellhammer.jpg',13),
('Konrad Mauz','employee-konrad-mauz','board','Abteilungsleiter Bogensport','https://bsvnordstern.de/images/verein/personen/konrad-mauz.jpg',14),
('Sigrid Burkhardt','employee-sigrid-burkhardt','board','Abteilungsleitung: Gymnastik','https://bsvnordstern.de/images/verein/personen/sigrid-burkhardt.jpg',15),
('Thomas Graf','employee-thomas-graf','board','Abteilungsleiter Wandern',null,16),
(null,'employee-aktuell-vakant','board','Förderung & Qualifizierung',null,17),
('Sigrid Burkhardt','employee-sigrid-burkhardt','board','Mitgliederbestandspflege','https://bsvnordstern.de/images/verein/personen/sigrid-burkhardt.jpg',18),
(null,'employee-aktuell-vakant','board','Ehrung',null,19),
('Jérôme Ernsberger','employee-jerome-ernsberger','board','IT & Administration','https://bsvnordstern.de/images/verein/personen/jerome-ernsberger.jpg',20),
('Stefan Gastaudo','employee-stefan-gastaudo','board','Datenschutzbeauftragter','https://bsvnordstern.de/images/verein/personen/stefan-gastaudo.jpg',21),
('Markus Sawicki','employee-markus-sawicki','board','Einkauf Organisation','https://bsvnordstern.de/images/verein/personen/markus-sawicki.jpg',22),
('Ole Schmal','employee-ole-schmal','board','Marketing & Social Media',null,23),
('Julian Kemmer','employee-julian-kemmer','board','Presse','https://bsvnordstern.de/images/verein/personen/julian-kemmer.jpg',24),
('Mario Jost','employee-mario-jost','board','Platzwart','https://bsvnordstern.de/images/verein/personen/mario-jost.jpg',25),
('Eberhard Klinkenberg','employee-eberhard-klinkenberg','board','Hausmeister','https://bsvnordstern.de/images/verein/personen/eberhard-klinkenberg.jpg',26),
('Markus Moßbrugger','employee-markus-mobrugger','board','Schlüsselmanagement',null,27),
('Jérôme Ernsberger','employee-jerome-ernsberger','youth','Jugendleiter','https://bsvnordstern.de/images/verein/personen/jerome-ernsberger.jpg',28),
('Ole Schmal','employee-ole-schmal','youth','Stellvertretender Jugendleiter',null,29),
('Wiebke Baronner-Dieterle','employee-wiebke-baronner-dieterle','youth','Jugendkassiererin','https://bsvnordstern.de/images/verein/personen/wiebke-baronner-dieterle.jpg',30),
('Sarah Klumpp','employee-sarah-klumpp','youth','Elternvertretung',null,31),
('Monika Peglau','employee-monika-peglau','youth','Jugendschutzbeauftragte',null,32),
('Laila Goldhagen','employee-laila-goldhagen','youth','Jugendvertretung C–B-Juniorinnen','https://bsvnordstern.de/images/verein/personen/laila-goldhagen.jpeg',33),
('Samuel Auer','employee-samuel-auer','youth','Jugendvertretung B–A-Junioren','https://bsvnordstern.de/images/verein/personen/samuel-auer.jpg',34),
('Ella Kramer','employee-ella-kramer','youth','Jugendvertretung G–D-Junioren & Juniorinnen','https://bsvnordstern.de/images/verein/personen/ella-kramer.jpeg',35),
('Susi Eisner','employee-susi-eisner','youth','Organisation',null,36),
('Wiebke Baronner-Dieterle','employee-wiebke-baronner-dieterle','youth','Organisation (Rechte Hand)','https://bsvnordstern.de/images/verein/personen/wiebke-baronner-dieterle.jpg',37),
('Tobias Messmer','employee-tobias-messmer','youth','Sport Events',null,38),
('Manuel Schellhammer','employee-manuel-schellhammer','youth','Passwesen','https://bsvnordstern.de/images/verein/personen/manuel-schellhammer.jpg',39),
('Oliver Schillinger','employee-oliver-schillinger','youth','Spielbetrieb',null,40),
('Jérôme Ernsberger','employee-jerome-ernsberger','board','Jugendleiter','https://bsvnordstern.de/images/verein/personen/jerome-ernsberger.jpg',41),
('Ole Schmal','employee-ole-schmal','board','Stellvertretender Jugendleiter',null,42),
(null,'employee-aktuell-vakant','supporters','1. Vorsitz',null,43),
('Eberhard Klinkenberg','employee-eberhard-klinkenberg','supporters','2. Vorsitz','https://bsvnordstern.de/images/verein/personen/eberhard-klinkenberg.jpg',44),
('Heike Seidel','employee-heike-seidel','supporters','Kasse','https://bsvnordstern.de/images/verein/personen/heike-seidel.jpg',45),
('Sarah Hainke','employee-sarah-hainke','supporters','Schriftführerin',null,46),
('Thomas Burkhardt','employee-thomas-burkhardt','supporters','Unterstützer','https://bsvnordstern.de/images/verein/personen/thomas-burkhardt.jpg',47),
('Theopolt Walz','employee-theopolt-walz','supporters','Unterstützer',null,48),
('Sigrid Burkhardt','employee-sigrid-burkhardt','supporters','Unterstützerin','https://bsvnordstern.de/images/verein/personen/sigrid-burkhardt.jpg',49),
('Hardy Seidel','employee-hardy-seidel','supporters','Unterstützer','https://bsvnordstern.de/images/verein/personen/hardy-seidel.jpg',50),
('Janet Nohl','employee-janet-nohl','supporters','Unterstützerin','https://bsvnordstern.de/images/verein/personen/janet-nohl.jpg',51)
 ) as seed(name,slug,grp,label,image,sorting) loop
  person:=null;
  if item.name is not null then
   select id into person from public.social_people where lower(display_name)=lower(item.name);
   if person is null then insert into public.social_people(slug,display_name,source_photo_url,roles,active) values(item.slug,item.name,item.image,'{}',true) returning id into person;end if;
  end if;
  if person is not null and item.image is not null then update public.social_people set source_photo_url=item.image where id=person and nullif(source_photo_url,'') is null;end if;
  insert into private.employee_assignments(person_id,group_key,role_label,sort_order) values(person,item.grp,item.label,item.sorting);
 end loop;
end $seed$;

create or replace function public.website_trainers_feed() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('teams',coalesce(jsonb_agg(jsonb_build_object('path',t.website_path,'photoManaged',photo.team_id is not null,'teamPhotoPath',photo.photo_path,'coaches',(
  select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(nullif(tp.website_name,''),p.display_name),'role',a.website_role,'qualification',tp.qualification,'club',tp.club,
    'image',coalesce(nullif(tp.website_photo_url,''),p.source_photo_url),'photoPath',tp.photo_path,'photoSource',private.employee_photo_source(p.id,'trainer'),
    'phone',case when tp.public_phone then coalesce(nullif(tp.mobile,''),tp.phone) else '' end)
    order by case a.staff_slot when 'trainer' then 0 when 'co1' then 1 when 'co2' then 2 when 'betreuer' then 3 else 4 end,a.staff_slot),'[]')
   from public.social_team_people a join public.social_people p on p.id=a.person_id and p.active join private.trainer_profiles tp on tp.person_id=p.id and tp.active where a.team_id=t.id and a.staff_slot is not null and a.website_visible
 )) order by t.sort_order,t.name),'[]')) from public.social_teams t left join private.trainer_team_photos photo on photo.team_id=t.id where (t.trainer_managed or photo.team_id is not null) and nullif(t.website_path,'') is not null;
$$;

revoke all on function public.website_trainers_feed() from public,anon,authenticated;
grant execute on function public.website_trainers_feed() to service_role;

alter function public.trainer_management_request(uuid,jsonb) rename to trainer_management_request_team_photos;
alter function public.trainer_management_request_team_photos(uuid,jsonb) set schema private;
revoke all on function private.trainer_management_request_team_photos(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.trainer_management_request_team_photos(uuid,jsonb) to service_role;
create function public.trainer_management_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=private.trainer_management_request_team_photos(actor,payload);
 if result ? 'error' then return result;end if;
 if payload->>'action'='list' then
  return result||jsonb_build_object('people',(select coalesce(jsonb_agg(p||jsonb_build_object('photoSource',private.employee_photo_source((p->>'id')::uuid,'trainer')) order by n),'[]') from jsonb_array_elements(result->'people') with ordinality rows(p,n)));
 end if;
 return result;
end $$;
revoke all on function public.trainer_management_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.trainer_management_request(uuid,jsonb) to service_role;
