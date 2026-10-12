-- One staff assignment catalogue for the Suite, cashbook and public website.
alter table public.social_admins drop constraint social_admins_access_areas_check;
alter table public.social_admins drop constraint social_admins_extra_areas_check;
alter table public.social_suite_roles drop constraint social_suite_roles_areas_check;
alter table public.social_admins add constraint social_admins_access_areas_check check(access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','user_management','cashbook','trainer_management']::text[]);
alter table public.social_admins add constraint social_admins_extra_areas_check check(extra_access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','cashbook','trainer_management']::text[]);
alter table public.social_suite_roles add constraint social_suite_roles_areas_check check(access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','user_management','cashbook','trainer_management']::text[]);
update public.social_suite_roles set access_areas=access_areas||'trainer_management'::text,updated_at=now() where key in ('admin','youth-leadership') and not 'trainer_management'=any(access_areas);
update public.social_admins set suite_role_key=suite_role_key;

alter table public.social_teams add column trainer_managed boolean not null default false, add column trainer_version bigint not null default 1;
alter table public.social_team_people add column staff_slot text check(staff_slot in ('trainer','co1','co2','betreuer') or staff_slot ~ '^extra-[1-9][0-9]?$'), add column website_visible boolean not null default false, add column website_role text not null default '' check(length(website_role)<=100);
create unique index social_team_staff_slot on public.social_team_people(team_id,staff_slot) where staff_slot is not null;
create unique index social_team_staff_person on public.social_team_people(team_id,person_id) where staff_slot is not null;

create table private.trainer_profiles (
 person_id uuid primary key references public.social_people(id) on delete restrict,
 first_name text not null check(length(first_name) between 1 and 80), last_name text not null check(length(last_name) between 1 and 100),
 website_name text not null default '' check(length(website_name)<=180),
 email text not null default '' check(length(email)<=254 and (email='' or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
 phone text not null default '' check(length(phone)<=50), mobile text not null default '' check(length(mobile)<=50),
 street text not null default '' check(length(street)<=160), postcode text not null default '' check(length(postcode)<=20), city text not null default '' check(length(city)<=100),
 qualification text not null default '' check(length(qualification)<=300), club text not null default '' check(length(club)<=180), notes text not null default '' check(length(notes)<=3000),
 public_email boolean not null default false, public_phone boolean not null default false,
 photo_path text, website_photo_url text not null default '' check(length(website_photo_url)<=2000),
 version bigint not null default 1,updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null
);
create table private.trainer_audit (
 id bigint generated always as identity primary key, actor uuid references auth.users(id) on delete set null,
 action text not null, person_id uuid references public.social_people(id),team_id uuid references public.social_teams(id),
 before_data jsonb,after_data jsonb,created_at timestamptz not null default now()
);
alter table private.trainer_profiles enable row level security;
alter table private.trainer_audit enable row level security;
revoke all on private.trainer_profiles,private.trainer_audit from public,anon,authenticated;
grant select,insert,update on private.trainer_profiles to service_role;
grant select,insert on private.trainer_audit to service_role;
grant usage,select on sequence private.trainer_audit_id_seq to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('trainer-portraits','trainer-portraits',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;

-- Preserve all existing trainers, including teams with more than three coaches.
with ranked as (
 select tp.team_id,tp.person_id,tp.role,row_number() over(partition by tp.team_id order by case when tp.role ~* 'betreu|ansprech' then 2 when tp.role ~* 'co.?trainer|fitness|athletik' then 1 else 0 end,tp.created_at,p.display_name) as n
 from public.social_team_people tp join public.social_people p on p.id=tp.person_id where tp.role ~* 'trainer|coach|betreu|ansprech'
), slots as (
 select *,case when role ~* 'betreu|ansprech' then 'betreuer' when n=1 then 'trainer' when n=2 then 'co1' when n=3 then 'co2' else 'extra-'||(n-3)::text end as slot from ranked
)
update public.social_team_people tp set staff_slot=s.slot,website_role=tp.role,website_visible=true from slots s where tp.team_id=s.team_id and tp.person_id=s.person_id and tp.role=s.role;
insert into private.trainer_profiles(person_id,first_name,last_name,website_photo_url)
select p.id,split_part(p.display_name,' ',1),coalesce(nullif(substr(p.display_name,strpos(p.display_name,' ')+1),''),p.display_name),coalesce(p.source_photo_url,'') from public.social_people p where exists(select 1 from public.social_team_people tp where tp.person_id=p.id and tp.staff_slot is not null) or exists(select 1 from unnest(p.roles) role where role ~* 'trainer|coach|betreu');
update private.trainer_profiles tp set first_name=s.first_name,last_name=s.last_name,email=case when s.email !~ '(\.invalid$|^cashbook-)' then s.email else '' end from private.cashbook_accounts a join public.social_admins s on s.user_id=a.suite_user_id where a.person_id=tp.person_id and s.first_name<>'' and s.last_name<>'';
update public.social_teams t set trainer_managed=true where exists(select 1 from public.social_team_people tp where tp.team_id=t.id and tp.staff_slot is not null);

create function public.trainer_management_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 member public.social_admins; act text:=payload->>'action'; person uuid; team uuid; expected bigint; profile private.trainer_profiles;
 before_profile jsonb; before_team jsonb; item jsonb; assignments jsonb; result jsonb; old_assignment public.social_team_people;
 v_first_name text; v_last_name text; label text; slot text; current_version bigint;
begin
 select * into member from public.social_admins where user_id=actor for share;
 if not found or not member.is_active or member.is_blocked or (member.role<>'admin' and not 'trainer_management'=any(member.access_areas)) then return jsonb_build_object('error','Keine Berechtigung für die Trainerverwaltung.','status',403); end if;
 if act='authorize' then
  person:=nullif(payload->>'personId','')::uuid;
  if not exists(select 1 from private.trainer_profiles where person_id=person) then return jsonb_build_object('error','Person nicht gefunden.','status',404);end if;
  return jsonb_build_object('ok',true);
 end if;
 if act in ('save_person','save_photo') then
  if act='save_person' and (coalesce(length(trim(payload->>'firstName')),0) not between 1 and 80 or coalesce(length(trim(payload->>'lastName')),0) not between 1 and 100) then return jsonb_build_object('error','Bitte Vor- und Nachname eingeben.','status',400);end if;
  person:=nullif(payload->>'personId','')::uuid;expected:=coalesce((payload->>'version')::bigint,0);
  if person is null then
   if act<>'save_person' or expected<>0 then return jsonb_build_object('error','Person fehlt.','status',400);end if;
   person:=gen_random_uuid();
   insert into public.social_people(id,slug,display_name,roles,active) values(person,'trainer-'||person::text,trim(payload->>'firstName')||' '||trim(payload->>'lastName'),array['Trainer'],true);
  else
   select * into profile from private.trainer_profiles where person_id=person for update;
   if not found then return jsonb_build_object('error','Person nicht gefunden.','status',404);end if;
   if profile.version<>expected then return jsonb_build_object('error','Die Person wurde inzwischen geändert. Bitte neu laden.','status',409);end if;
   before_profile:=to_jsonb(profile);
  end if;
  if act='save_photo' then
   if coalesce(payload->>'photoPath','') !~ ('^'||person::text||'/[a-f0-9]{64}\.(jpg|png|webp)$') then return jsonb_build_object('error','Ungültiges Foto.','status',400);end if;
   update private.trainer_profiles set photo_path=payload->>'photoPath',version=version+1,updated_at=now(),updated_by=actor where person_id=person;
  else
   v_first_name:=trim(payload->>'firstName');v_last_name:=trim(payload->>'lastName');
   if coalesce(length(v_first_name),0) not between 1 and 80 or coalesce(length(v_last_name),0) not between 1 and 100 then return jsonb_build_object('error','Bitte Vor- und Nachname eingeben.','status',400);end if;
   insert into private.trainer_profiles(person_id,first_name,last_name,website_name,email,phone,mobile,street,postcode,city,qualification,club,notes,public_email,public_phone,version,updated_by)
   values(person,v_first_name,v_last_name,trim(coalesce(payload->>'websiteName','')),lower(trim(coalesce(payload->>'email',''))),trim(coalesce(payload->>'phone','')),trim(coalesce(payload->>'mobile','')),trim(coalesce(payload->>'street','')),trim(coalesce(payload->>'postcode','')),trim(coalesce(payload->>'city','')),trim(coalesce(payload->>'qualification','')),trim(coalesce(payload->>'club','')),trim(coalesce(payload->>'notes','')),coalesce((payload->>'publicEmail')::boolean,false),coalesce((payload->>'publicPhone')::boolean,false),1,actor)
   on conflict(person_id) do update set first_name=excluded.first_name,last_name=excluded.last_name,website_name=excluded.website_name,email=excluded.email,phone=excluded.phone,mobile=excluded.mobile,street=excluded.street,postcode=excluded.postcode,city=excluded.city,qualification=excluded.qualification,club=excluded.club,notes=excluded.notes,public_email=excluded.public_email,public_phone=excluded.public_phone,version=trainer_profiles.version+1,updated_at=now(),updated_by=actor;
   update public.social_people set display_name=v_first_name||' '||v_last_name,birth_date=nullif(payload->>'birthDate','')::date,active=coalesce((payload->>'active')::boolean,true),updated_at=now() where id=person;
   -- Linked logins keep their username, password and rights; their name follows the person.
   update public.social_admins s set first_name=v_first_name,last_name=v_last_name from private.cashbook_accounts a where a.person_id=person and a.suite_user_id=s.user_id;
  end if;
  select to_jsonb(p) into result from private.trainer_profiles p where person_id=person;
  insert into private.trainer_audit(actor,action,person_id,before_data,after_data) values(actor,act,person,before_profile,result);
  return jsonb_build_object('ok',true,'personId',person,'version',(result->>'version')::bigint);
 end if;
 if act='save_team' then
  team:=(payload->>'teamId')::uuid;expected:=(payload->>'version')::bigint;assignments:=payload->'assignments';
  select trainer_version into current_version from public.social_teams where id=team for update;
  if not found then return jsonb_build_object('error','Mannschaft nicht gefunden.','status',404);end if;
  if current_version is distinct from expected then return jsonb_build_object('error','Die Mannschaft wurde inzwischen geändert. Bitte neu laden.','status',409);end if;
  if coalesce(jsonb_typeof(assignments),'')<>'array' or jsonb_array_length(assignments)>20 then return jsonb_build_object('error','Ungültige Zuordnung.','status',400);end if;
  if exists(select 1 from jsonb_array_elements(assignments) a where coalesce(a->>'slot','') not in ('trainer','co1','co2','betreuer') and coalesce(a->>'slot','') !~ '^extra-[1-9][0-9]?$') or exists(select 1 from jsonb_array_elements(assignments) a group by a->>'slot' having count(*)>1) or exists(select 1 from jsonb_array_elements(assignments) a group by a->>'personId' having count(*)>1) then return jsonb_build_object('error','Jede Person und Position darf pro Mannschaft nur einmal belegt sein.','status',400);end if;
  for item in select value from jsonb_array_elements(assignments) loop
   if not exists(select 1 from private.trainer_profiles tp join public.social_people p on p.id=tp.person_id where tp.person_id=(item->>'personId')::uuid and p.active) then return jsonb_build_object('error','Bitte aktive Personen auswählen.','status',400);end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(tp)),'[]') into before_team from public.social_team_people tp where team_id=team and staff_slot is not null;
  delete from public.social_team_people where team_id=team and staff_slot is not null;
  for item in select value from jsonb_array_elements(assignments) loop
   slot:=item->>'slot';person:=(item->>'personId')::uuid;
   label:=trim(coalesce(item->>'websiteRole',''));
   if label='' then label:=case slot when 'trainer' then 'Trainer' when 'co1' then 'Co-Trainer 1' when 'co2' then 'Co-Trainer 2' when 'betreuer' then 'Betreuer' else 'Trainer' end;end if;
   insert into public.social_team_people(team_id,person_id,role,staff_slot,website_visible,website_role) values(team,person,case slot when 'trainer' then 'Trainer' when 'co1' then 'Co-Trainer' when 'co2' then 'Co-Trainer' when 'betreuer' then 'Betreuer' else 'Trainer' end,slot,coalesce((item->>'websiteVisible')::boolean,false),label);
  end loop;
  update public.social_teams set trainer_managed=true,trainer_version=trainer_version+1 where id=team;
  insert into private.trainer_audit(actor,action,team_id,before_data,after_data) values(actor,act,team,before_team,assignments);
  return jsonb_build_object('ok',true,'version',current_version+1);
 end if;
 if act='list' then
  return jsonb_build_object('people',(select coalesce(jsonb_agg(to_jsonb(tp)||jsonb_build_object('id',p.id,'name',p.display_name,'active',p.active,'birth_date',p.birth_date,'source_photo_url',coalesce(nullif(tp.website_photo_url,''),p.source_photo_url),'updated_by_name',(select trim(first_name||' '||last_name) from public.social_admins where user_id=tp.updated_by)) order by lower(tp.last_name),lower(tp.first_name)),'[]') from private.trainer_profiles tp join public.social_people p on p.id=tp.person_id),
   'teams',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug,'website_path',t.website_path,'version',t.trainer_version,'managed',t.trainer_managed) order by t.sort_order,t.name),'[]') from public.social_teams t),
   'assignments',(select coalesce(jsonb_agg(jsonb_build_object('teamId',team_id,'personId',person_id,'slot',staff_slot,'websiteVisible',website_visible,'websiteRole',website_role)),'[]') from public.social_team_people where staff_slot is not null));
 end if;
 return jsonb_build_object('error','Unbekannte Traineraktion.','status',400);
end $$;
revoke all on function public.trainer_management_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.trainer_management_request(uuid,jsonb) to service_role;

-- Only the explicitly approved public fields leave the private directory.
create function public.website_trainers_feed() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('teams',coalesce(jsonb_agg(jsonb_build_object('path',t.website_path,'coaches',(
  select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(nullif(tp.website_name,''),p.display_name),'role',a.website_role,'qualification',tp.qualification,'club',tp.club,
    'image',coalesce(nullif(tp.website_photo_url,''),p.source_photo_url),'photoPath',tp.photo_path,
    'phone',case when tp.public_phone then coalesce(nullif(tp.mobile,''),tp.phone) else '' end,'email',case when tp.public_email then tp.email else '' end)
    order by case a.staff_slot when 'trainer' then 0 when 'co1' then 1 when 'co2' then 2 when 'betreuer' then 3 else 4 end,a.staff_slot),'[]')
   from public.social_team_people a join public.social_people p on p.id=a.person_id and p.active join private.trainer_profiles tp on tp.person_id=p.id where a.team_id=t.id and a.staff_slot is not null and a.website_visible
 )) order by t.sort_order,t.name),'[]')) from public.social_teams t where t.trainer_managed and nullif(t.website_path,'') is not null;
$$;
revoke all on function public.website_trainers_feed() from public,anon,authenticated;
grant execute on function public.website_trainers_feed() to service_role;

-- Preserve the current public portraits, qualifications, roles and existing phone consent.
update private.trainer_profiles tp set website_name='Torsten Parzich',qualification='DFB C-Lizenz',club='',phone='+491712800481',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/torsten-parzich.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Torsten Parzich';
update private.trainer_profiles tp set website_name='Torben Altenburg',qualification='',club='',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/torben-altenburg.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Torben Altenburg';
update private.trainer_profiles tp set website_name='Eberhard Klinkenberg',qualification='',club='',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/eberhard-klinkenberg.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Eberhard Klinkenberg';
update private.trainer_profiles tp set website_name='Alexander Kaiser',qualification='',club='',phone='+4915203887134',public_phone=true,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Alexander Kaiser';
update private.trainer_profiles tp set website_name='Mathias Becht',qualification='',club='BSV Nordstern Radolfzell',phone='+49 1523 8252979',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/mathias-becht.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Mathias Becht';
update private.trainer_profiles tp set website_name='Max Menzel',qualification='',club='FC Öhningen-Gaienhofen',phone='+49 170 4971707',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/max-menzel.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Max Menzel';
update private.trainer_profiles tp set website_name='Myriam Lipp',qualification='',club='FC Öhningen-Gaienhofen',phone='+49 1522 3307366',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/myriam-lipp.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Myriam Lipp';
update private.trainer_profiles tp set website_name='Emel Bayram',qualification='',club='BSV Nordstern Radolfzell',phone='+49 173 1543544',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/emel-bayram.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Emel Bayram';
update private.trainer_profiles tp set website_name='Christian Stielow',qualification='',club='',phone='',public_phone=false,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Christian Stielow';
update private.trainer_profiles tp set website_name='Niku Pourheidari',qualification='DFB-Basis-Coach',club='',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/niku-pourheidari.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Niku Pourheidari';
update private.trainer_profiles tp set website_name='Christoph Pabst',qualification='',club='',phone='',public_phone=false,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Christoph Pabst';
update private.trainer_profiles tp set website_name='Marcelino Rüth',qualification='Kindertrainer-Zertifikat',club='',phone='+491754003543',public_phone=true,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Marcelino Rüth';
update private.trainer_profiles tp set website_name='Mohamad Mahmoudi',qualification='',club='',phone='',public_phone=false,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Mohamad Mahmoudi';
update private.trainer_profiles tp set website_name='Stefan Sulger',qualification='Kindertrainer-Zertifikat',club='',phone='',public_phone=false,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Stefan Sulger';
update private.trainer_profiles tp set website_name='Michael Sick',qualification='',club='',phone='',public_phone=false,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Michael Sick';
update private.trainer_profiles tp set website_name='Andreas Wolfmüller',qualification='DFB-Basis-Coach',club='',phone='+4917670571197',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/andreas-wolfmueller.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Andreas Wolfmüller';
update private.trainer_profiles tp set website_name='Sina Rauch',qualification='DFB-Basis-Coach',club='',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/sina-rauch.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Sina Rauch';
update private.trainer_profiles tp set website_name='Marcelino Rüth',qualification='Kindertrainer-Zertifikat',club='',phone='+491754003543',public_phone=true,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Marcelino Rüth';
update private.trainer_profiles tp set website_name='Pascal Dieterle',qualification='DFB-Basis-Coach',club='',phone='+4917654061668',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/pascal-dieterle.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Pascal Dieterle';
update private.trainer_profiles tp set website_name='Fabian Keller',qualification='Kindertrainer-Zertifikat',club='',phone='+4916090937204',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/fabian-keller.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Fabian Keller';
update private.trainer_profiles tp set website_name='Humberto Vicente Agudo Torres',qualification='',club='',phone='+34620364267',public_phone=true,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Humberto Vicente Agudo Torres';
update private.trainer_profiles tp set website_name='Michael Meiss',qualification='',club='',phone='+4915259341076',public_phone=true,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Michael Meiss';
update private.trainer_profiles tp set website_name='Luca Gastaudo',qualification='Junior-Coach / DFB-Basis-Coach',club='',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/luca-gastaudo.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Luca Gastaudo';
update private.trainer_profiles tp set website_name='Marco Tassone',qualification='',club='',phone='',public_phone=false,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Marco Tassone';
update private.trainer_profiles tp set website_name='Elias Arfa',qualification='',club='',phone='',public_phone=false,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Elias Arfa';
update private.trainer_profiles tp set website_name='Noemi Sophie Friedrich',qualification='Junior-Coach',club='',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/noemi-sophie-friedrich.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Noemi Sophie Friedrich';
update private.trainer_profiles tp set website_name='Mila Ernsberger',qualification='',club='',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/mila-ernsberger.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Mila Ernsberger';
update private.trainer_profiles tp set website_name='Marlia-Lena Bulander',qualification='',club='',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/marlia-burlander.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Marlia Burlander';
update private.trainer_profiles tp set website_name='Migo Jentsch',qualification='B-Lizenz',club='SV Markelfingen',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/migo-jentsch.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Michael Jentsch';
update private.trainer_profiles tp set website_name='Ole Schmal',qualification='',club='BSV Nordstern Radolfzell',phone='+491737104858',public_phone=true,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Ole Schmal';
update private.trainer_profiles tp set website_name='Frieder Demmer',qualification='',club='SV Markelfingen',phone='+4915254068949',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/frieder-demmer.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Frieder Demmer';
update private.trainer_profiles tp set website_name='Maximilian Geismann',qualification='',club='SG Liggeringen-Güttingen',phone='+491744859948',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/maximilian-geismann.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Maximilian Geismann';
update private.trainer_profiles tp set website_name='Andrea Basile',qualification='',club='BSV Nordstern Radolfzell',phone='+4917680473879',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/andrea-basile.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Andrea Basile';
update private.trainer_profiles tp set website_name='Axel Schäuble',qualification='',club='',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/axel-schaeuble.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Axel Schäuble';
update private.trainer_profiles tp set website_name='Simon Bühler',qualification='Kindertrainer-Zertifikat',club='',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/simon-buehler.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Simon Bühler';
update private.trainer_profiles tp set website_name='Thomas Parthenschlager',qualification='',club='',phone='',public_phone=false,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Thomas Parthenschlager';
update private.trainer_profiles tp set website_name='Sebastian Bäuerle',qualification='Kindertrainer-Zertifikat',club='',phone='+4915150300920',public_phone=true,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Sebastian Bäuerle';
update private.trainer_profiles tp set website_name='Stephan Hellmann',qualification='DFB-Basis-Coach',club='',phone='+491726240593',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/stephan-hellmann.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Stephan Hellmann';
update private.trainer_profiles tp set website_name='Hieu Ho',qualification='DFB-Basis-Coach',club='',phone='',public_phone=false,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Hieu Ho';
update private.trainer_profiles tp set website_name='Jörg Boreatti',qualification='C-Lizenz (ab 2023)',club='',phone='+491726240593',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/joerg-boreatti.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Jörg Boreatti';
update private.trainer_profiles tp set website_name='Marko Eisner',qualification='DFB-Basis-Coach',club='',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/marco-eisner.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Marko Eisner';
update private.trainer_profiles tp set website_name='Patrick Müller',qualification='DFB-Basis-Coach',club='',phone='',public_phone=false,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Patrick Müller';
update private.trainer_profiles tp set website_name='Jérôme Ernsberger',qualification='Trainer-C Kinder und Jugend',club='',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/jerome-ernsberger.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Jérôme Ernsberger';
update private.trainer_profiles tp set website_name='Sven Goldhagen',qualification='DFB-Basis-Coach',club='',phone='+491727404080',public_phone=true,website_photo_url='https://bsvnordstern.de/images/verein/personen/sven-goldhagen.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Sven Goldhagen';
update private.trainer_profiles tp set website_name='Sonja Thomen',qualification='DFB-Basis-Coach',club='',phone='',public_phone=false,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Sonja Thomen';
update private.trainer_profiles tp set website_name='Alexander Kramer',qualification='DFB-Basis-Coach',club='',phone='+491733276748',public_phone=true,website_photo_url='' from public.social_people p where p.id=tp.person_id and p.display_name='Alexander Kramer';
update private.trainer_profiles tp set website_name='Dana-Sophie Bulander',qualification='C-Lizenz',club='',phone='',public_phone=false,website_photo_url='https://bsvnordstern.de/images/verein/personen/dana-bulander.jpg' from public.social_people p where p.id=tp.person_id and p.display_name='Dana Bulander';

-- The homepage order decides the initial named slots; keep historical role labels.
insert into public.social_people(slug,display_name,roles,active) values('christian-stielow','Christian Stielow',array['Ansprechperson Alte Herren'],true) on conflict(slug) do nothing;
insert into private.trainer_profiles(person_id,first_name,last_name,phone,public_phone) select id,'Christian','Stielow','',false from public.social_people where slug='christian-stielow' on conflict(person_id) do nothing;
insert into public.social_team_people(team_id,person_id,role,staff_slot,website_visible,website_role) select t.id,p.id,'Ansprechperson Alte Herren','betreuer',true,'Ansprechperson Alte Herren' from public.social_teams t,public.social_people p where t.website_path='fussball/alte-herren' and p.slug='christian-stielow' on conflict(team_id,person_id,role) do update set staff_slot='betreuer',website_visible=true,website_role='Ansprechperson Alte Herren';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='fussball/herren/bezirksliga') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='fussball/herren/bezirksliga' and p.display_name='Torsten Parzich' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Co-Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='fussball/herren/bezirksliga' and p.display_name='Torben Altenburg' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='betreuer',website_visible=true,website_role='Betreuer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='fussball/herren/bezirksliga' and p.display_name='Eberhard Klinkenberg' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='fussball/herren/kreisliga-2') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='fussball/herren/kreisliga-2' and p.display_name='Alexander Kaiser' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='fussball/frauen/bezirksliga') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='fussball/frauen/bezirksliga' and p.display_name='Mathias Becht' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Co-Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='fussball/frauen/bezirksliga' and p.display_name='Max Menzel' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='fussball/frauen/kreisliga') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Chef-Trainerin' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='fussball/frauen/kreisliga' and p.display_name='Myriam Lipp' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Co-Trainerin' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='fussball/frauen/kreisliga' and p.display_name='Emel Bayram' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u11-e1') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u11-e1' and p.display_name='Niku Pourheidari' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u11-e1' and p.display_name='Christoph Pabst' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u11-e2') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u11-e2' and p.display_name='Marcelino Rüth' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u11-e2' and p.display_name='Mohamad Mahmoudi' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u11-e3') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u11-e3' and p.display_name='Stefan Sulger' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u11-e3' and p.display_name='Michael Sick' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u9-f') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u9-f' and p.display_name='Andreas Wolfmüller' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Trainerin' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u9-f' and p.display_name='Sina Rauch' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co2',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u9-f' and p.display_name='Marcelino Rüth' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u8-f') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u8-f' and p.display_name='Pascal Dieterle' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u8-f' and p.display_name='Fabian Keller' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co2',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u8-f' and p.display_name='Humberto Vicente Agudo Torres' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u7-g') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u7-g' and p.display_name='Michael Meiss' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u7-g' and p.display_name='Luca Gastaudo' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co2',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u7-g' and p.display_name='Marco Tassone' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u6-g') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u6-g' and p.display_name='Elias Arfa' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Trainerin' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u6-g' and p.display_name='Noemi Sophie Friedrich' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co2',website_visible=true,website_role='Trainerin' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u6-g' and p.display_name='Mila Ernsberger' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='extra-1',website_visible=true,website_role='Trainerin' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u6-g' and p.display_name='Marlia Burlander' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u19') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u19' and p.display_name='Michael Jentsch' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Co-Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u19' and p.display_name='Ole Schmal' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='extra-1',website_visible=true,website_role='Athletik- und Fitnesscoach' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u19' and p.display_name='Frieder Demmer' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u17') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u17' and p.display_name='Maximilian Geismann' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Co-Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u17' and p.display_name='Andrea Basile' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u15-c1') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Cheftrainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u15-c1' and p.display_name='Axel Schäuble' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Co-Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u15-c1' and p.display_name='Simon Bühler' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co2',website_visible=true,website_role='Co-Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u15-c1' and p.display_name='Thomas Parthenschlager' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u15-c2') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Cheftrainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u15-c2' and p.display_name='Sebastian Bäuerle' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u13-d1') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u13-d1' and p.display_name='Stephan Hellmann' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Co-Trainerin' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u13-d1' and p.display_name='Hieu Ho' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u13-d2') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u13-d2' and p.display_name='Jörg Boreatti' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Co-Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u13-d2' and p.display_name='Marko Eisner' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co2',website_visible=true,website_role='Co-Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u13-d2' and p.display_name='Patrick Müller' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/u13-d3') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/u13-d3' and p.display_name='Jérôme Ernsberger' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/juniorinnen/u17') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Cheftrainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/juniorinnen/u17' and p.display_name='Sven Goldhagen' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot='co1',website_visible=true,website_role='Co-Trainerin' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/juniorinnen/u17' and p.display_name='Sonja Thomen' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/juniorinnen/u15') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainer' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/juniorinnen/u15' and p.display_name='Alexander Kramer' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_team_people a set staff_slot=null where team_id in(select id from public.social_teams where website_path='jugend/juniorinnen/u13') and staff_slot is not null;
update public.social_team_people a set staff_slot='trainer',website_visible=true,website_role='Trainerin' from public.social_teams t,public.social_people p where a.team_id=t.id and a.person_id=p.id and t.website_path='jugend/juniorinnen/u13' and p.display_name='Dana Bulander' and a.role ~* 'trainer|coach|betreu|ansprech';
update public.social_teams set trainer_managed=true where exists(select 1 from public.social_team_people a where a.team_id=social_teams.id and a.staff_slot is not null);
