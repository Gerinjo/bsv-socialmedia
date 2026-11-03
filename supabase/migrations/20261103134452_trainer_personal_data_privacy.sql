-- Personal onboarding data is deliberately separate from operational/public contacts.
create table private.trainer_personal_data(
 person_id uuid primary key references private.trainer_profiles(person_id) on delete cascade,
 details jsonb not null default '{}' check(jsonb_typeof(details)='object' and octet_length(details::text)<16000),
 sources jsonb not null default '{}' check(jsonb_typeof(sources)='object' and octet_length(sources::text)<12000),
 version bigint not null default 1 check(version>0),updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null
);
create index trainer_personal_updated_by on private.trainer_personal_data(updated_by);
create table private.trainer_personal_imports(
 message_id text primary key check(message_id ~ '^[a-f0-9]{16,32}$'),
 person_id uuid references private.trainer_profiles(person_id) on delete set null,
 source_date timestamptz not null,imported_at timestamptz not null default now(),
 actor uuid references auth.users(id) on delete set null,
 changed_fields text[] not null default '{}',conflict_fields text[] not null default '{}',ignored_fields text[] not null default '{}'
);
create index trainer_personal_imports_person on private.trainer_personal_imports(person_id);
create index trainer_personal_imports_actor on private.trainer_personal_imports(actor);
alter table private.trainer_personal_data enable row level security;
alter table private.trainer_personal_imports enable row level security;
revoke all on private.trainer_personal_data,private.trainer_personal_imports from public,anon,authenticated;
grant select,insert,update,delete on private.trainer_personal_data to service_role;
grant select,insert on private.trainer_personal_imports to service_role;

create function private.trainer_contract_access(actor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.social_admins where user_id=actor and is_active and not is_blocked and (role='admin' or 'trainer_contracts'=any(access_areas)));
$$;
create function private.trainer_personal_values(person uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('email',coalesce(d.details->>'email',tp.email,''),'phone',coalesce(d.details->>'phone',tp.phone,''),'mobile',coalesce(d.details->>'mobile',tp.mobile,''),
 'street',coalesce(d.details->>'street',tp.street,''),'postcode',coalesce(d.details->>'postcode',tp.postcode,''),'city',coalesce(d.details->>'city',tp.city,''),
 'birthDate',coalesce(d.details->>'birthDate',p.birth_date::text,''),'notes',coalesce(d.details->>'notes',tp.notes,''),
 'bank',coalesce(d.details->'bank',(select c.snapshot->'bank' from private.trainer_contracts c where c.person_id=person and c.status<>'cancelled' and nullif(c.snapshot#>>'{bank,iban}','') is not null order by c.updated_at desc limit 1),jsonb_build_object('holder',trim(tp.first_name||' '||tp.last_name),'iban','','name','','bic','')))
 from private.trainer_profiles tp join public.social_people p on p.id=tp.person_id left join private.trainer_personal_data d on d.person_id=tp.person_id where tp.person_id=person;
$$;
create function private.trainer_personal_validation(details jsonb) returns text
language plpgsql stable security invoker set search_path='' as $$
declare item record;bank jsonb;iban text;rotated text;symbol text;digits text;remainder int:=0;v_date date;
begin
 if details is null or jsonb_typeof(details)<>'object' or octet_length(details::text)>=16000 or details-array['email','phone','mobile','street','postcode','city','birthDate','notes','bank']<>'{}'::jsonb then return 'Ungültige private Trainerdaten.';end if;
 for item in select * from jsonb_each(details) where key<>'bank' loop
  if jsonb_typeof(item.value)<>'string' or length(item.value#>>'{}')>(case item.key when 'notes' then 3000 when 'email' then 254 when 'street' then 160 when 'city' then 100 when 'birthDate' then 10 when 'postcode' then 20 else 50 end) then return 'Private Trainerdaten sind zu lang oder ungültig.';end if;
 end loop;
 if coalesce(details->>'email','')<>'' and details->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return 'Ungültige E-Mail-Adresse.';end if;
 if exists(select 1 from jsonb_each_text(details) e where e.key in ('phone','mobile') and e.value<>'' and e.value !~ '^[+0-9 ()/.-]{3,50}$') then return 'Ungültige Telefonnummer.';end if;
 if coalesce(details->>'birthDate','')<>'' then
  begin v_date:=(details->>'birthDate')::date;exception when others then return 'Ungültiges Geburtsdatum.';end;
  if v_date::text<>details->>'birthDate' or v_date<'1900-01-01'::date or v_date>current_date then return 'Ungültiges Geburtsdatum.';end if;
 end if;
 if details ? 'bank' then
  bank:=details->'bank';if jsonb_typeof(bank)<>'object' or bank-array['holder','iban','name','bic']<>'{}'::jsonb then return 'Ungültige Bankdaten.';end if;
  if exists(select 1 from jsonb_each(bank) e where jsonb_typeof(e.value)<>'string' or e.value#>>'{}' ~ '[[:cntrl:]]' or length(e.value#>>'{}')>(case e.key when 'iban' then 34 when 'bic' then 11 else 160 end)) then return 'Ungültige Bankdaten.';end if;
  if coalesce(bank->>'bic','')<>'' and bank->>'bic' !~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$' then return 'Ungültige BIC.';end if;
  iban:=coalesce(bank->>'iban','');
  if iban<>'' then
   if iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' or (left(iban,2)='DE' and length(iban)<>22) then return 'Ungültige IBAN.';end if;
   rotated:=substr(iban,5)||left(iban,4);
   for i in 1..length(rotated) loop
    symbol:=substr(rotated,i,1);digits:=case when symbol ~ '[A-Z]' then (ascii(symbol)-55)::text else symbol end;
    for j in 1..length(digits) loop remainder:=(remainder*10+substr(digits,j,1)::int)%97;end loop;
   end loop;
   if remainder<>1 then return 'Ungültige IBAN-Prüfsumme.';end if;
  end if;
 end if;return null;
end $$;

create function public.trainer_personal_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare member public.social_admins;p private.trainer_profiles;d private.trainer_personal_data;person uuid;act text:=payload->>'action';new_details jsonb;issue text;new_sources jsonb;item record;
begin
 perform pg_advisory_xact_lock(7041956);
 select * into member from public.social_admins where user_id=actor for share;
 if not found or not member.is_active or member.is_blocked or (member.role<>'admin' and not 'trainer_contracts'=any(member.access_areas)) then return jsonb_build_object('error','Für diese privaten Daten ist das Recht Trainerverträge erforderlich.','status',403);end if;
 person:=(payload->>'personId')::uuid;select * into p from private.trainer_profiles where person_id=person for share;
 if not found then return jsonb_build_object('error','Trainerprofil nicht gefunden.','status',404);end if;
 select * into d from private.trainer_personal_data where person_id=person for update;
 if act='get' then return jsonb_build_object('personId',person,'name',trim(p.first_name||' '||p.last_name),'profileVersion',p.version,'version',coalesce(d.version,0),'details',private.trainer_personal_values(person),'publicContact',jsonb_build_object('phone',coalesce(nullif(p.mobile,''),p.phone,''),'published',p.public_phone),'sources',coalesce(d.sources,'{}'),'imports',(select coalesce(jsonb_agg(jsonb_build_object('sourceDate',i.source_date,'changedFields',i.changed_fields,'conflictFields',i.conflict_fields,'ignoredFields',i.ignored_fields) order by i.source_date desc),'[]') from private.trainer_personal_imports i where i.person_id=person));end if;
 if act<>'save' then return jsonb_build_object('error','Unbekannte Aktion für Vertragsdaten.','status',400);end if;
 if payload->>'version' is distinct from coalesce(d.version,0)::text or payload->>'profileVersion' is distinct from p.version::text then return jsonb_build_object('error','Die privaten Trainerdaten wurden inzwischen geändert. Bitte neu laden.','status',409);end if;
 new_details:=payload->'details';issue:=private.trainer_personal_validation(new_details);
 if issue is not null then return jsonb_build_object('error',issue,'status',400);end if;
 if payload ? 'publishPhone' and (jsonb_typeof(payload->'publishPhone')<>'boolean' or (payload->'publishPhone'='true'::jsonb and coalesce(nullif(p.mobile,''),nullif(p.phone,'')) is null)) then return jsonb_build_object('error','Bitte den bestehenden öffentlichen Telefonkontakt prüfen.','status',400);end if;
 new_sources:=coalesce(d.sources,'{}');for item in select * from jsonb_each(new_details) loop
  if private.trainer_personal_values(person)->item.key is distinct from item.value then new_sources:=new_sources||jsonb_build_object(item.key,jsonb_build_object('kind','manual','updatedAt',now()));end if;
 end loop;
 insert into private.trainer_personal_data(person_id,details,sources,updated_by) values(person,new_details,new_sources,actor)
 on conflict(person_id) do update set details=excluded.details,sources=excluded.sources,version=trainer_personal_data.version+1,updated_at=now(),updated_by=actor returning * into d;
 if payload ? 'publishPhone' then update private.trainer_profiles set public_phone=(payload->>'publishPhone')::boolean,version=version+1,updated_at=now(),updated_by=actor where person_id=person and public_phone is distinct from (payload->>'publishPhone')::boolean;end if;
 insert into private.trainer_audit(actor,action,person_id,after_data) values(actor,'save_private_details',person,jsonb_build_object('privateVersion',d.version,'fields',(select jsonb_agg(key) from jsonb_object_keys(new_details) key)));
 return jsonb_build_object('ok',true,'version',d.version);
end $$;

-- Keep personal values out of the ordinary directory response, including for
-- privileged callers; they are fetched per person through the dedicated RPC.
alter function public.trainer_management_request(uuid,jsonb) rename to trainer_management_request_before_personal;
alter function public.trainer_management_request_before_personal(uuid,jsonb) set schema private;
create function public.trainer_management_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;person uuid;profile private.trainer_profiles;restricted text[]:=array['email','phone','mobile','street','postcode','city','birthDate','notes','publicPhone','publicEmail'];
begin
 perform pg_advisory_xact_lock(7041956);
 if payload->>'action'='save_person' then
  if payload ?| restricted then return jsonb_build_object('error','Private Kontakt- und Kontodaten bitte im geschützten Bereich Vertragsdaten bearbeiten.','status',403);end if;
  person:=nullif(payload->>'personId','')::uuid;select * into profile from private.trainer_profiles where person_id=person for share;
  perform 1 from public.social_people where id=person for share;
  payload:=payload||jsonb_build_object('email',coalesce(profile.email,''),'phone',coalesce(profile.phone,''),'mobile',coalesce(profile.mobile,''),'street',coalesce(profile.street,''),'postcode',coalesce(profile.postcode,''),'city',coalesce(profile.city,''),'notes',coalesce(profile.notes,''),'publicPhone',coalesce(profile.public_phone,false),'publicEmail',coalesce(profile.public_email,false),'birthDate',coalesce((select birth_date::text from public.social_people where id=person),''));
 end if;
 result:=private.trainer_management_request_before_personal(actor,payload);
 if result ? 'error' then return result;end if;
 if payload->>'action'='list' then return result||jsonb_build_object('canViewPrivate',private.trainer_contract_access(actor),'people',(select coalesce(jsonb_agg(p-array['email','phone','mobile','street','postcode','city','birth_date','notes'] order by n),'[]') from jsonb_array_elements(result->'people') with ordinality rows(p,n)));end if;
 return result;
end $$;

alter function public.employee_management_request(uuid,jsonb) rename to employee_management_request_before_personal;
alter function public.employee_management_request_before_personal(uuid,jsonb) set schema private;
create function public.employee_management_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(7041956);
 if payload->>'action'='save_contact' and exists(select 1 from private.trainer_profiles where person_id=nullif(payload->>'personId','')::uuid) then return jsonb_build_object('error','Private Trainerkontaktdaten bitte im geschützten Bereich Vertragsdaten bearbeiten.','status',403);end if;
 result:=private.employee_management_request_before_personal(actor,payload);if result ? 'error' then return result;end if;
 if payload->>'action'='list' then return result||jsonb_build_object('canViewPrivate',private.trainer_contract_access(actor),'people',(select coalesce(jsonb_agg(case when p->>'contactSource'='trainer' then (p-array['email','phone','mobile'])||jsonb_build_object('contactProtected',true) else p end order by n),'[]') from jsonb_array_elements(result->'people') with ordinality rows(p,n)));end if;return result;
end $$;

revoke all on function private.trainer_contract_access(uuid),private.trainer_personal_values(uuid),private.trainer_personal_validation(jsonb),public.trainer_personal_request(uuid,jsonb),public.trainer_management_request(uuid,jsonb),public.employee_management_request(uuid,jsonb),private.trainer_management_request_before_personal(uuid,jsonb),private.employee_management_request_before_personal(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.trainer_contract_access(uuid),private.trainer_personal_values(uuid),private.trainer_personal_validation(jsonb),public.trainer_personal_request(uuid,jsonb),public.trainer_management_request(uuid,jsonb),public.employee_management_request(uuid,jsonb),private.trainer_management_request_before_personal(uuid,jsonb),private.employee_management_request_before_personal(uuid,jsonb) to service_role;

create function private.trainer_personal_equivalent(field text,a text,b text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
begin
 if field in ('phone','mobile') then
  a:=regexp_replace(a,'[^0-9+]','','g');b:=regexp_replace(b,'[^0-9+]','','g');
  a:=regexp_replace(a,'^(\+49|0049)','0');b:=regexp_replace(b,'^(\+49|0049)','0');
 end if;
 return lower(trim(coalesce(a,'')))=lower(trim(coalesce(b,'')));
end $$;

-- One-off/admin import: only already matched identities, fill missing fields,
-- and record provenance/field names without copying mail bodies or bank values.
create function private.import_trainer_personal_data(actor uuid,records jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare member public.social_admins;r jsonb;person uuid;p private.trainer_profiles;d private.trainer_personal_data;current_values jsonb;incoming jsonb;next_details jsonb;next_sources jsonb;entry record;bank_entry record;old_bank jsonb;next_bank jsonb;changed text[];conflicts text[];provenance jsonb;issue text;results jsonb:='[]';
begin
 perform pg_advisory_xact_lock(7041956);
 select * into member from public.social_admins where user_id=actor for share;
 if not found or not member.is_active or member.is_blocked or (member.role<>'admin' and not 'trainer_contracts'=any(member.access_areas)) then return jsonb_build_object('error','Keine Berechtigung für den Import privater Trainerdaten.','status',403);end if;
 if records is null or jsonb_typeof(records)<>'array' or jsonb_array_length(records)>100 then return jsonb_build_object('error','Ungültige Importauswahl.','status',400);end if;
 -- Validate the whole batch before any record is changed.
 for r in select value from jsonb_array_elements(records) loop
  person:=(r->>'personId')::uuid;select * into p from private.trainer_profiles where person_id=person;
  if not found or p.first_name is distinct from r->>'expectedFirstName' or p.last_name is distinct from r->>'expectedLastName' or p.version::text is distinct from r->>'profileVersion' then return jsonb_build_object('error','Die Trainerzuordnung wurde inzwischen geändert.','status',409);end if;
  if coalesce(r->>'messageId','') !~ '^[a-f0-9]{16,32}$' or nullif(r->>'sourceDate','') is null then return jsonb_build_object('error','Ungültige Herkunft des Imports.','status',400);end if;
  perform (r->>'sourceDate')::timestamptz;
  issue:=private.trainer_personal_validation(r->'details');if issue is not null then return jsonb_build_object('error',issue,'status',400);end if;
 end loop;
 for r in select value from jsonb_array_elements(records) loop
  person:=(r->>'personId')::uuid;
  if exists(select 1 from private.trainer_personal_imports where message_id=r->>'messageId') then results:=results||jsonb_build_array(jsonb_build_object('personId',person,'skipped',true));continue;end if;
  select * into d from private.trainer_personal_data where person_id=person for update;
  current_values:=private.trainer_personal_values(person);incoming:=r->'details';next_details:=coalesce(d.details,'{}');next_sources:=coalesce(d.sources,'{}');changed:='{}';conflicts:='{}';
  provenance:=jsonb_build_object('kind','gmail','messageId',r->>'messageId','sourceDate',r->>'sourceDate');
  for entry in select * from jsonb_each(incoming) where key<>'bank' loop
   if coalesce(entry.value#>>'{}','')='' then continue;end if;
   if (entry.key in ('email','phone','mobile') and coalesce(d.details->>entry.key,'')='') or (entry.key not in ('email','phone','mobile') and coalesce(current_values->>entry.key,'')='') then next_details:=next_details||jsonb_build_object(entry.key,entry.value);next_sources:=next_sources||jsonb_build_object(entry.key,provenance);changed:=array_append(changed,entry.key);
   elsif not private.trainer_personal_equivalent(entry.key,current_values->>entry.key,entry.value#>>'{}') then conflicts:=array_append(conflicts,entry.key);end if;
  end loop;
  if incoming ? 'bank' then
   old_bank:=case when d.details ? 'bank' or nullif(current_values#>>'{bank,iban}','') is not null then current_values->'bank' else '{}'::jsonb end;next_bank:=old_bank;
   if nullif(old_bank->>'iban','') is not null and old_bank->>'iban' is distinct from incoming#>>'{bank,iban}' then conflicts:=array_append(conflicts,'bank');
   elsif nullif(old_bank->>'iban','') is null and exists(select 1 from jsonb_each_text(old_bank) b where b.value<>'' and nullif(incoming->'bank'->>b.key,'') is not null and not private.trainer_personal_equivalent(b.key,b.value,incoming->'bank'->>b.key)) then conflicts:=array_append(conflicts,'bank');
   else
    for bank_entry in select * from jsonb_each(incoming->'bank') loop
     if coalesce(bank_entry.value#>>'{}','')='' then continue;end if;
     if coalesce(old_bank->>bank_entry.key,'')='' then next_bank:=next_bank||jsonb_build_object(bank_entry.key,bank_entry.value);changed:=array_append(changed,'bank.'||bank_entry.key);
     elsif not private.trainer_personal_equivalent(bank_entry.key,old_bank->>bank_entry.key,bank_entry.value#>>'{}') then conflicts:=array_append(conflicts,'bank.'||bank_entry.key);end if;
    end loop;
   end if;
   if next_bank is distinct from old_bank then next_details:=next_details||jsonb_build_object('bank',next_bank);next_sources:=next_sources||jsonb_build_object('bank',provenance);end if;
  end if;
  if cardinality(changed)>0 then
   insert into private.trainer_personal_data(person_id,details,sources,updated_by) values(person,next_details,next_sources,actor)
   on conflict(person_id) do update set details=excluded.details,sources=excluded.sources,version=trainer_personal_data.version+1,updated_at=now(),updated_by=actor;
  end if;
  insert into private.trainer_personal_imports(message_id,person_id,source_date,actor,changed_fields,conflict_fields,ignored_fields) values(r->>'messageId',person,(r->>'sourceDate')::timestamptz,actor,changed,conflicts,array(select jsonb_array_elements_text(coalesce(r->'ignoredFields','[]'))));
  results:=results||jsonb_build_array(jsonb_build_object('personId',person,'changedFields',to_jsonb(changed),'conflictFields',to_jsonb(conflicts)));
 end loop;
 return jsonb_build_object('ok',true,'results',results);
end $$;
revoke all on function private.trainer_personal_equivalent(text,text,text),private.import_trainer_personal_data(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.trainer_personal_equivalent(text,text,text),private.import_trainer_personal_data(uuid,jsonb) to service_role;

-- Include protected onboarding data in drafts and reject stale bank/contact sources.
create or replace function public.trainer_contract_request(actor uuid,payload jsonb) returns jsonb
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
   'people',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(trim(tp.first_name||' '||tp.last_name),''),p.display_name),'active',p.active and coalesce(tp.active,true),'version',coalesce(tp.version,0),'qualification',coalesce(tp.qualification,''),'personalVersion',coalesce(pd.version,0),'personalBank',pd.details->'bank','birth_date',coalesce(pd.details->>'birthDate',p.birth_date::text,''),'street',coalesce(pd.details->>'street',tp.street,''),'postcode',coalesce(pd.details->>'postcode',tp.postcode,''),'city',coalesce(pd.details->>'city',tp.city,''),'email',coalesce(pd.details->>'email',tp.email,''),'previousBank',(select old.snapshot->'bank' from private.trainer_contracts old where old.person_id=p.id and old.status<>'cancelled' and nullif(old.snapshot#>>'{bank,iban}','') is not null order by old.updated_at desc limit 1)) order by p.display_name),'[]') from public.social_people p left join private.trainer_profiles tp on tp.person_id=p.id left join private.trainer_personal_data pd on pd.person_id=p.id where exists(select 1 from public.social_team_people a join public.social_teams t on t.id=a.team_id where a.person_id=p.id and a.staff_slot is not null and (t.slug in ('herren-1','herren-2','frauen-1','frauen-2') or t.slug ~ '^u[0-9]'))),
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
   perform 1 from private.trainer_personal_data where person_id=c.person_id for share;
   perform 1 from public.social_teams where id=c.team_id for share;
   if c.status<>'draft' or c.person_id is null or c.team_id is null then return jsonb_build_object('error','Nur ein zugeordneter Entwurf kann freigegeben werden.','status',409);end if;
   if not exists(select 1 from public.social_team_people a join public.social_people p on p.id=a.person_id join private.trainer_profiles tp on tp.person_id=p.id join public.social_teams t on t.id=a.team_id where a.person_id=c.person_id and a.team_id=c.team_id and a.staff_slot=c.slot and p.active and tp.active and coalesce((select details->>'birthDate' from private.trainer_personal_data where person_id=p.id),p.birth_date::text,'')=coalesce(c.snapshot#>>'{source,birthDate}','') and t.name=c.snapshot#>>'{source,teamName}' and tp.version=(c.snapshot#>>'{source,personVersion}')::bigint and t.trainer_version=(c.snapshot#>>'{source,teamVersion}')::bigint) or coalesce((select version from private.trainer_personal_data where person_id=c.person_id),0)<>coalesce((c.snapshot#>>'{source,personalVersion}')::bigint,0) or coalesce((select version from private.trainer_compensation_plans where season=c.season),0)<>(c.snapshot#>>'{source,planVersion}')::bigint then return jsonb_build_object('error','Stammdaten oder Gehaltsplanung wurden geändert. Bitte die Quelldaten neu übernehmen.','status',409);end if;
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
