-- Kassenbuch der Jugendabteilung shares Supabase Auth and the suite's per-user permissions.
alter table public.social_admins drop constraint if exists social_admins_access_areas_check;
alter table public.social_admins add constraint social_admins_access_areas_check
 check(access_areas <@ array['social_media','sponsoring','editorial','referees','administration','user_management','cashbook']::text[]);
-- Team eligibility remains independent of social publishing.
create table private.cashbook_teams (
 team_id uuid primary key references public.social_teams(id) on delete restrict,
 enabled boolean not null default true
);
insert into private.cashbook_teams(team_id)
 select id from public.social_teams where slug in ('u19-junioren','u17-junioren','u15-c1-junioren','u15-c2-junioren','u13-d1-junioren','u13-d2-junioren','u13-d3-junioren');

create table private.cashbook_accounts (
 id uuid primary key default gen_random_uuid(),
 person_id uuid not null unique references public.social_people(id) on delete restrict,
 suite_user_id uuid unique references auth.users(id) on delete set null,
 username text not null unique check(username ~ '^[a-z]{2,30}$'),
 role text not null check(role in ('trainer','cashier')),
 active boolean not null default true,
 failures integer not null default 0,
 window_started_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create table private.cashbook_safe (
 id boolean primary key default true check(id),
 threshold_cents integer not null default 5000 check(threshold_cents=5000),
 notification_email text not null default 'jugendkasse@bsvnordstern.de',
 instructions text not null default 'Öffne den Safe mit deinem Schlüssel oder dem vereinbarten Zahlencode. Lege Einzahlungen in den Umschlag und bestätige den tatsächlich eingelegten oder entnommenen Betrag.',
 low_alert_active boolean not null default false,
 alert_episode bigint not null default 0
);
insert into private.cashbook_safe(id) values(true);
create table private.cashbook_entries (
 id uuid primary key default gen_random_uuid(),
 sequence bigint generated always as identity unique,
 account_id uuid not null references private.cashbook_accounts(id) on delete restrict,
 request_id uuid not null,
 direction text not null check(direction in ('deposit','withdrawal')),
 amount_cents integer not null check(amount_cents between 1 and 99999999),
 balance_after_cents bigint not null check(balance_after_cents>=0),
 person_name text not null,
 team_id uuid references public.social_teams(id) on delete restrict,
 team_name text not null,
 note text not null default '' check(length(note)<=500),
 evidence_path text not null unique,
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),
 signature_path text,
 signature_hash text,
 created_at timestamptz not null default clock_timestamp(),
 unique(account_id,request_id),
 check(direction='deposit' or (team_id is not null and signature_path is not null and signature_hash is not null and signature_hash ~ '^[a-f0-9]{64}$'))
);
create index cashbook_entries_account_idx on private.cashbook_entries(account_id);
create index cashbook_entries_team_idx on private.cashbook_entries(team_id);
create unique index cashbook_receipt_once_idx on private.cashbook_entries(evidence_hash) where direction='withdrawal';
create table private.cashbook_alerts (
 id uuid primary key default gen_random_uuid(),
 episode bigint not null unique,
 balance_cents bigint not null,
 recipient text not null,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 locked_until timestamptz,
 lease_id uuid,
 last_error text
);
create index cashbook_alerts_pending_idx on private.cashbook_alerts(next_attempt_at) where sent_at is null;

do $$ declare tab text; begin
 foreach tab in array array['cashbook_teams','cashbook_accounts','cashbook_safe','cashbook_entries','cashbook_alerts'] loop
  execute format('alter table private.%I enable row level security',tab);
  execute format('revoke all on private.%I from public,anon,authenticated',tab);
  execute format('grant select,insert,update,delete on private.%I to service_role',tab);
 end loop;
end $$;
revoke update,delete,truncate on private.cashbook_entries from service_role;
grant usage,select on sequence private.cashbook_entries_sequence_seq to service_role;

create function private.cashbook_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Bestätigte Kassenbuchungen sind unveränderlich.'; end $$;
create trigger cashbook_entries_immutable before update or delete on private.cashbook_entries for each row execute function private.cashbook_immutable();

create function private.cashbook_username(display_name text) returns text language sql immutable set search_path='' as $$
 select left(regexp_replace(translate(replace(lower(regexp_replace(trim(display_name),'^[^ ]+\s+','')),'ß','ss'),'äöüéèêáàâíìîóòôúùû','aoueeeaaaiiiooouuu'),'[^a-z]','','g'),4)
 || left(regexp_replace(translate(lower(split_part(trim(display_name),' ',1)),'äöüéèêáàâíìîóòôúùû','aoueeeaaaiiiooouuu'),'[^a-z]','','g'),1)
$$;

-- Reuse the existing, service-only club role registry and recheck it on each request.
create function private.cashbook_is_youth_leader(person uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from private.referee_club_roles r where r.person_id=person and r.role='youth_leadership' and r.active)
$$;
create function private.cashbook_import_accounts() returns jsonb language plpgsql security invoker set search_path='' as $$
declare person record; login text; added integer:=0; collisions jsonb:='[]';
begin
 for person in
  select p.id,p.display_name from public.social_people p where p.active and (
   private.cashbook_is_youth_leader(p.id) or exists(
    select 1 from public.social_team_people tp join private.cashbook_teams t on t.team_id=tp.team_id and t.enabled
    where tp.person_id=p.id and (tp.role ilike '%trainer%' or tp.role ilike '%coach%')
   )
  ) order by p.id
 loop
  if exists(select 1 from private.cashbook_accounts where person_id=person.id) then continue; end if;
  login:=private.cashbook_username(person.display_name);
  if length(login)<2 or exists(select 1 from private.cashbook_accounts where username=login) then
   collisions:=collisions||jsonb_build_array(jsonb_build_object('personId',person.id,'name',person.display_name,'username',login));
  else
   insert into private.cashbook_accounts(person_id,username,role) values(person.id,login,'trainer'); added:=added+1;
  end if;
 end loop;
 return jsonb_build_object('added',added,'collisions',collisions);
end $$;
-- Known cashiers from the club directory; never invent names or birthdays.
insert into private.cashbook_accounts(person_id,username,role)
 select id,private.cashbook_username(display_name),'cashier' from public.social_people
 where active and slug in ('wiebke-baronner-dieterle','claudia-gastaudo') on conflict do nothing;
select private.cashbook_import_accounts();

create function private.cashbook_current_teams(person uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.sort_order,t.name),'[]'::jsonb)
 from public.social_teams t join private.cashbook_teams ct on ct.team_id=t.id and ct.enabled
 where exists(select 1 from public.social_team_people tp where tp.team_id=t.id and tp.person_id=person and (tp.role ilike '%trainer%' or tp.role ilike '%coach%'))
  or private.cashbook_is_youth_leader(person)
$$;
create function private.cashbook_balance() returns bigint language sql stable security invoker set search_path='' as $$
 select coalesce(sum(case direction when 'deposit' then amount_cents else -amount_cents end),0)::bigint from private.cashbook_entries
$$;
create function private.cashbook_ledger(before_sequence bigint,viewer uuid,all_evidence boolean) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'sequence',e.sequence,'direction',e.direction,'amountCents',e.amount_cents,
  'balanceAfterCents',e.balance_after_cents,'personName',e.person_name,'teamName',e.team_name,'note',e.note,'createdAt',e.created_at,
  'canViewEvidence',all_evidence or e.account_id=viewer) order by e.sequence desc),'[]'::jsonb)
 from (select * from private.cashbook_entries where before_sequence is null or sequence<before_sequence order by sequence desc limit 31) e
$$;

-- The API supplies actor from the verified suite JWT, never from request JSON.
create function public.cashbook_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare account private.cashbook_accounts; person public.social_people; safe private.cashbook_safe; entry private.cashbook_entries;
 teams jsonb:='[]'; balance bigint; amount integer; team uuid; team_name text; records jsonb; act text:=payload->>'action';
 administrator boolean;
begin
 select role='admin' into administrator from public.social_admins
  where user_id=actor and is_active and (role='admin' or (role<>'referee-admin' and 'cashbook'=any(access_areas))) for share;
 if not found then return jsonb_build_object('error','Kein Zugriff auf das Kassenbuch der Jugendabteilung.','status',403); end if;
 select * into account from private.cashbook_accounts where suite_user_id=actor for share;
 if found then
  select * into person from public.social_people where id=account.person_id and active for share;
  if not account.active or person.id is null then return jsonb_build_object('error','Der Kassenzugang ist gesperrt.','status',403); end if;
  teams:=private.cashbook_current_teams(account.person_id);
  if account.role='trainer' and jsonb_array_length(teams)=0 then return jsonb_build_object('error','Der Mannschaftszugang ist nicht mehr aktiv.','status',403); end if;
 end if;
 if act='book' and account.id is null then return jsonb_build_object('error','Für Buchungen ist eine Zuordnung als Trainer oder Kasse erforderlich.','status',403); end if;
 if act='media' then
  select * into entry from private.cashbook_entries where id=(payload->>'id')::uuid;
  if not found or not (administrator or coalesce(account.role='cashier',false) or coalesce(entry.account_id=account.id,false)) then return jsonb_build_object('error','Kein Zugriff auf diesen Beleg.','status',403); end if;
  return jsonb_build_object('evidencePath',entry.evidence_path,'signaturePath',entry.signature_path);
 end if;
 if act not in ('authorize','list','book') then return jsonb_build_object('error','Unbekannte Aktion.','status',400); end if;
 select * into safe from private.cashbook_safe where id=true;
 if act='book' then
  if coalesce(payload->>'direction','') not in ('deposit','withdrawal') or (payload->>'confirmed')::boolean is distinct from true
   or coalesce(payload->>'amountCents','') !~ '^[0-9]{1,8}$'
   or coalesce(payload->>'evidenceHash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','Unvollständige Buchung.','status',400); end if;
  amount:=(payload->>'amountCents')::integer;
  if amount<1 or length(coalesce(payload->>'note',''))>500 then return jsonb_build_object('error','Ungültiger Betrag oder Verwendungszweck.','status',400); end if;
  if payload->>'direction'='deposit' and account.role<>'cashier' then return jsonb_build_object('error','Nur die Kasse darf Einzahlungen erfassen.','status',403); end if;
  team:=(payload->>'teamId')::uuid;
  if payload->>'direction'='withdrawal' then
   if account.role<>'trainer' or not exists(select 1 from jsonb_array_elements(teams) t where t->>'id'=team::text) then return jsonb_build_object('error','Bitte eine eigene Mannschaft auswählen.','status',403); end if;
   if coalesce(payload->>'signatureHash','') !~ '^[a-f0-9]{64}$' or coalesce(payload->>'signaturePath','')='' then return jsonb_build_object('error','Bitte die Entnahme unterschreiben.','status',400); end if;
   select name into team_name from public.social_teams where id=team;
  else team:=null; team_name:='Vereinskasse / Jugendkasse'; end if;
  if coalesce(payload->>'evidencePath','') not like account.id::text||'/'||(payload->>'requestId')||'/%'
   or (payload->>'direction'='withdrawal' and coalesce(payload->>'signaturePath','') not like account.id::text||'/'||(payload->>'requestId')||'/%') then
   return jsonb_build_object('error','Ungültiger Beleg.','status',400);
  end if;
  -- Serialize the balance check, append and low-stock transition in one transaction.
  select * into safe from private.cashbook_safe where id=true for update;
  select * into entry from private.cashbook_entries where account_id=account.id and request_id=(payload->>'requestId')::uuid;
  if found then
   if entry.direction is distinct from payload->>'direction' or entry.amount_cents<>amount or entry.team_id is distinct from team
    or entry.evidence_hash is distinct from payload->>'evidenceHash' or entry.signature_hash is distinct from payload->>'signatureHash'
    or entry.note is distinct from coalesce(payload->>'note','') then return jsonb_build_object('error','Diese Buchungsnummer gehört zu anderen Angaben.','status',409); end if;
  else
   if payload->>'direction'='withdrawal' and exists(select 1 from private.cashbook_entries where direction='withdrawal' and evidence_hash=payload->>'evidenceHash') then
    return jsonb_build_object('error','Diese Quittung wurde bereits gebucht.','status',409);
   end if;
   balance:=private.cashbook_balance();
   if payload->>'direction'='withdrawal' and amount>balance then return jsonb_build_object('error','Der Safe enthält nicht genug Geld. Bitte die Kasse verständigen.','status',409); end if;
   balance:=balance+case payload->>'direction' when 'deposit' then amount else -amount end;
   insert into private.cashbook_entries(account_id,request_id,direction,amount_cents,balance_after_cents,person_name,team_id,team_name,note,evidence_path,evidence_hash,signature_path,signature_hash)
    values(account.id,(payload->>'requestId')::uuid,payload->>'direction',amount,balance,person.display_name,team,team_name,coalesce(payload->>'note',''),payload->>'evidencePath',payload->>'evidenceHash',payload->>'signaturePath',payload->>'signatureHash') returning * into entry;
   if balance<safe.threshold_cents and not safe.low_alert_active then
    update private.cashbook_safe set low_alert_active=true,alert_episode=alert_episode+1 where id=true returning * into safe;
    insert into private.cashbook_alerts(episode,balance_cents,recipient) values(safe.alert_episode,balance,safe.notification_email);
   elsif balance>=safe.threshold_cents then update private.cashbook_safe set low_alert_active=false where id=true; end if;
  end if;
 end if;
 balance:=private.cashbook_balance();
 records:=private.cashbook_ledger((payload->>'before')::bigint,account.id,administrator or coalesce(account.role='cashier',false));
 return jsonb_build_object('user',jsonb_build_object('id',account.id,'name',person.display_name,'username',account.username,'role',coalesce(account.role,'observer'),'isYouthLeader',private.cashbook_is_youth_leader(account.person_id)),
  'canBook',account.id is not null,'canExport',administrator or coalesce(account.role='cashier',false),'teams',teams,'balanceCents',balance,'thresholdCents',safe.threshold_cents,'instructions',safe.instructions,'entries',records,
  'entryId',entry.id,'notificationPending',exists(select 1 from private.cashbook_alerts where sent_at is null));
end $$;

create function public.cashbook_admin_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare act text:=payload->>'action'; accounts jsonb; people jsonb; teams jsonb; report jsonb; account private.cashbook_accounts; birthday date; suite_user uuid;
begin
 if not exists(select 1 from public.social_admins where user_id=actor and is_active and role='admin') then return jsonb_build_object('error','Nur der Super-Admin darf das Kassenbuch verwalten.','status',403); end if;
 if act='cashbook_provision_data' then
  return (select jsonb_build_object('accounts',coalesce(jsonb_agg(jsonb_build_object('id',a.id,'personId',a.person_id,'username',a.username,'name',p.display_name,'birthDate',p.birth_date)),'[]'))
   from private.cashbook_accounts a join public.social_people p on p.id=a.person_id and p.active
   where a.active and a.suite_user_id is null and (nullif(payload->>'personId','') is null or a.person_id=(payload->>'personId')::uuid));
 elsif act='cashbook_bind' then
  suite_user:=(payload->>'userId')::uuid;
  if not exists(select 1 from auth.users where id=suite_user) then return jsonb_build_object('error','Suite-Benutzer wurde nicht gefunden.','status',400); end if;
  if exists(select 1 from private.cashbook_accounts where suite_user_id=suite_user and person_id<>(payload->>'personId')::uuid) then return jsonb_build_object('error','Dieser Suite-Benutzer ist bereits einer anderen Person zugeordnet.','status',409); end if;
  perform 1 from public.social_admins where user_id=suite_user for update;
  update private.cashbook_accounts set suite_user_id=suite_user where person_id=(payload->>'personId')::uuid and suite_user_id is null;
  if not found then return jsonb_build_object('error','Der Zugang ist bereits zugeordnet.','status',409); end if;
  insert into public.social_admins(user_id,email,role,is_active,access_areas)
   select id,email,'sm-team',true,array['cashbook']::text[] from auth.users where id=suite_user
   on conflict(user_id) do update set access_areas=case when 'cashbook'=any(public.social_admins.access_areas) then public.social_admins.access_areas else array_append(public.social_admins.access_areas,'cashbook') end;
 elsif act='cashbook_import'  then report:=private.cashbook_import_accounts();
 elsif act='cashbook_account' then
  if coalesce(payload->>'username','') !~ '^[a-z]{2,30}$' or coalesce(payload->>'role','') not in ('trainer','cashier') then return jsonb_build_object('error','Bitte ein eindeutiges Login und eine Rolle angeben.','status',400); end if;
  if not exists(select 1 from public.social_people where id=(payload->>'personId')::uuid and active) then return jsonb_build_object('error','Person wurde nicht gefunden.','status',400); end if;
  if exists(select 1 from private.cashbook_accounts where username=payload->>'username' and person_id<>(payload->>'personId')::uuid) then return jsonb_build_object('error','Dieses Login ist bereits vergeben.','status',409); end if;
  if payload ? 'suiteUserId' then
   suite_user:=nullif(payload->>'suiteUserId','')::uuid;
   if suite_user is not null and not exists(select 1 from public.social_admins where user_id=suite_user and role<>'referee-admin') then return jsonb_build_object('error','Bitte einen regulären Suite-Benutzer auswählen.','status',400); end if;
   if exists(select 1 from private.cashbook_accounts where suite_user_id=suite_user and person_id<>(payload->>'personId')::uuid) then return jsonb_build_object('error','Dieser Suite-Benutzer ist bereits einer anderen Person zugeordnet.','status',409); end if;
  end if;
  perform 1 from public.social_admins where user_id in (suite_user,(select suite_user_id from private.cashbook_accounts where person_id=(payload->>'personId')::uuid)) order by user_id for update;
  insert into private.cashbook_accounts(person_id,username,role,active) values((payload->>'personId')::uuid,payload->>'username',payload->>'role',(payload->>'active')::boolean)
   on conflict(person_id) do update set username=excluded.username,role=excluded.role,active=excluded.active,failures=0 returning * into account;
  if payload ? 'suiteUserId' then
   update private.cashbook_accounts set suite_user_id=suite_user where id=account.id;
   if suite_user is not null then update public.social_admins set access_areas=case when 'cashbook'=any(access_areas) then access_areas else array_append(access_areas,'cashbook') end where user_id=suite_user; end if;
  end if;
  if nullif(payload->>'birthDate','') is not null then
   birthday:=(payload->>'birthDate')::date;
   if birthday<date '1900-01-01' or birthday>current_date then raise exception 'Ungültiges Geburtsdatum'; end if;
   update public.social_people set birth_date=birthday where id=account.person_id;
  end if;
 elsif act='cashbook_settings' then
  if coalesce(payload->>'email','') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(payload->>'email')>254 or length(coalesce(payload->>'instructions',''))>1000 then return jsonb_build_object('error','Bitte eine gültige E-Mail-Adresse und höchstens 1000 Zeichen für den Safe-Hinweis angeben.','status',400); end if;
  update private.cashbook_safe set notification_email=payload->>'email',instructions=coalesce(payload->>'instructions','') where id=true;
  update private.cashbook_alerts set recipient=payload->>'email' where sent_at is null;
 elsif act='cashbook_team' then
  insert into private.cashbook_teams(team_id,enabled) values((payload->>'teamId')::uuid,(payload->>'enabled')::boolean)
   on conflict(team_id) do update set enabled=excluded.enabled;
 elsif act='cashbook_media' then
  return (select jsonb_build_object('evidencePath',evidence_path,'signaturePath',signature_path) from private.cashbook_entries where id=(payload->>'id')::uuid);
 elsif act<>'cashbook_load' then return jsonb_build_object('error','Unbekannte Aktion.','status',400); end if;
 select coalesce(jsonb_agg(jsonb_build_object('personId',p.id,'suiteUserId',a.suite_user_id,'name',p.display_name,'username',a.username,'role',a.role,'active',a.active,'birthdayReady',p.birth_date is not null,'isYouthLeader',private.cashbook_is_youth_leader(p.id),'teams',private.cashbook_current_teams(p.id)) order by p.display_name),'[]') into accounts
  from private.cashbook_accounts a join public.social_people p on p.id=a.person_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by display_name),'[]') into people from public.social_people where active;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'enabled',coalesce(ct.enabled,false)) order by t.sort_order,t.name),'[]') into teams from public.social_teams t left join private.cashbook_teams ct on ct.team_id=t.id;
 return jsonb_build_object('accounts',accounts,'members',(select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'email',email,'active',is_active) order by email),'[]') from public.social_admins where role<>'referee-admin'),'people',people,'teams',teams,'import',report,'balanceCents',private.cashbook_balance(),
  'entries',private.cashbook_ledger((payload->>'before')::bigint,null,true),'settings',(select jsonb_build_object('email',notification_email,'instructions',instructions) from private.cashbook_safe where id=true),
  'notifications',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'recipient',a.recipient,'createdAt',a.created_at,'sentAt',a.sent_at,'attempts',a.attempts,'error',a.last_error) order by a.created_at desc),'[]') from (select * from private.cashbook_alerts order by created_at desc limit 10) a));
end $$;

create function public.suite_cashbook_login(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare account private.cashbook_accounts; email text;
begin
 select * into account from private.cashbook_accounts where username=lower(trim(payload->>'username')) for update;
 if not found or not account.active or account.suite_user_id is null then return jsonb_build_object('error','Anmeldung fehlgeschlagen.','status',403); end if;
 if not exists(select 1 from public.social_admins where user_id=account.suite_user_id and is_active
  and (role='admin' or (role<>'referee-admin' and 'cashbook'=any(access_areas))))
  or not exists(select 1 from public.social_people where id=account.person_id and active)
  or (account.role='trainer' and jsonb_array_length(private.cashbook_current_teams(account.person_id))=0)
 then return jsonb_build_object('error','Anmeldung fehlgeschlagen.','status',403); end if;
 if payload->>'action'='success' then
  update private.cashbook_accounts set failures=0 where id=account.id;
  return jsonb_build_object('ok',true);
 end if;
 if account.window_started_at<=now()-interval '15 minutes' then
  update private.cashbook_accounts set failures=0,window_started_at=now() where id=account.id; account.failures:=0;
 end if;
 if account.failures>=5 then return jsonb_build_object('error','Zu viele Versuche. Bitte nach 15 Minuten erneut versuchen.','status',429); end if;
 update private.cashbook_accounts set failures=failures+1 where id=account.id;
 select u.email into email from auth.users u where u.id=account.suite_user_id;
 return jsonb_build_object('email',email);
end $$;

create function public.cashbook_alert_request(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare alert private.cashbook_alerts;
begin
 if payload->>'action'='claim' then
  select * into alert from private.cashbook_alerts where sent_at is null and next_attempt_at<=now() and (locked_until is null or locked_until<=now()) order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update private.cashbook_alerts set locked_until=now()+interval '2 minutes',lease_id=gen_random_uuid(),attempts=attempts+1 where id=alert.id returning * into alert;
  return to_jsonb(alert);
 elsif payload->>'action'='sent' then
  update private.cashbook_alerts set sent_at=now(),locked_until=null,last_error=null where id=(payload->>'id')::uuid and lease_id=(payload->>'leaseId')::uuid and sent_at is null;
 elsif payload->>'action'='failed' then
  update private.cashbook_alerts set locked_until=null,next_attempt_at=now()+interval '5 minutes',last_error=left(payload->>'error',200)
   where id=(payload->>'id')::uuid and lease_id=(payload->>'leaseId')::uuid and sent_at is null;
 else raise exception 'Ungültige Aktion'; end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function private.cashbook_immutable(),private.cashbook_username(text),private.cashbook_is_youth_leader(uuid),private.cashbook_import_accounts(),private.cashbook_current_teams(uuid),private.cashbook_balance(),private.cashbook_ledger(bigint,uuid,boolean) from public,anon,authenticated;
grant execute on function private.cashbook_username(text),private.cashbook_is_youth_leader(uuid),private.cashbook_import_accounts(),private.cashbook_current_teams(uuid),private.cashbook_balance(),private.cashbook_ledger(bigint,uuid,boolean) to service_role;
revoke all on function public.cashbook_request(uuid,jsonb),public.cashbook_admin_request(uuid,jsonb),public.cashbook_alert_request(jsonb),public.suite_cashbook_login(jsonb) from public,anon,authenticated;
grant execute on function public.cashbook_request(uuid,jsonb),public.cashbook_admin_request(uuid,jsonb),public.cashbook_alert_request(jsonb),public.suite_cashbook_login(jsonb) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('cashbook-evidence','cashbook-evidence',false,8388608,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;

-- Delivery is retried independently of the browser and booking success.
select cron.schedule('bsv-cashbook-alerts','*/5 * * * *',$cron$
 select net.http_post(url:='https://maejihwjzxkmthjavgnx.supabase.co/functions/v1/cashbook-alerts',
  headers:=jsonb_build_object('Content-Type','application/json','x-bsv-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='social_worker_cron_secret' limit 1)),
  body:=jsonb_build_object('trigger','cron'),timeout_milliseconds:=30000);
$cron$);
