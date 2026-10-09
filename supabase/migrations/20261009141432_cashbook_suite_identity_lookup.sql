-- Use the Suite directory and Auth foreign key; service_role cannot SELECT auth.users.
create or replace function public.cashbook_admin_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare act text:=payload->>'action'; accounts jsonb; people jsonb; teams jsonb; report jsonb; account private.cashbook_accounts; birthday date; suite_user uuid; suite_email text;
begin
 if not exists(select 1 from public.social_admins where user_id=actor and is_active and role='admin') then return jsonb_build_object('error','Nur der Super-Admin darf das Kassenbuch verwalten.','status',403); end if;
 if act='cashbook_provision_data' then
  return (select jsonb_build_object('accounts',coalesce(jsonb_agg(jsonb_build_object('id',a.id,'personId',a.person_id,'username',a.username,'name',p.display_name,'birthDate',p.birth_date)),'[]'))
   from private.cashbook_accounts a join public.social_people p on p.id=a.person_id and p.active
   where a.active and a.suite_user_id is null and (nullif(payload->>'personId','') is null or a.person_id=(payload->>'personId')::uuid));
 elsif act='cashbook_bind' then
  suite_user:=(payload->>'userId')::uuid;
  select email into suite_email from public.social_admins where user_id=suite_user;
  if suite_email is null then suite_email:=nullif(payload->>'email',''); end if;
  if coalesce(suite_email,'') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return jsonb_build_object('error','Suite-Benutzer wurde nicht gefunden.','status',400); end if;
  -- The foreign key verifies the Auth identity without querying auth.users.
  if exists(select 1 from private.cashbook_accounts where suite_user_id=suite_user and person_id<>(payload->>'personId')::uuid) then return jsonb_build_object('error','Dieser Suite-Benutzer ist bereits einer anderen Person zugeordnet.','status',409); end if;
  perform 1 from public.social_admins where user_id=suite_user for update;
  update private.cashbook_accounts set suite_user_id=suite_user where person_id=(payload->>'personId')::uuid and suite_user_id is null;
  if not found then return jsonb_build_object('error','Der Zugang ist bereits zugeordnet.','status',409); end if;
  insert into public.social_admins(user_id,email,role,is_active,access_areas)
   values(suite_user,suite_email,'sm-team',true,array['cashbook']::text[])
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

create or replace function public.suite_cashbook_login(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
 select m.email into email from public.social_admins m where m.user_id=account.suite_user_id;
 return jsonb_build_object('email',email);
end $$;

