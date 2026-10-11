-- Personal advances remain outside the cash balance. Settlement is an immutable two-party log.
begin;
alter table private.cashbook_entries drop constraint cashbook_entries_direction_check;
alter table private.cashbook_entries add constraint cashbook_entries_direction_check check(direction in ('deposit','withdrawal','advance'));
alter table private.cashbook_entries add column notification_email text;
alter table private.cashbook_entries add constraint cashbook_advance_email_check check(direction<>'advance' or (notification_email is not null and length(notification_email)<=254 and notification_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and lower(notification_email) not like '%.invalid'));
drop index private.cashbook_receipt_once_idx;
create unique index cashbook_receipt_once_idx on private.cashbook_entries(evidence_hash) where direction in ('withdrawal','advance') and entry_type='booking';

create table private.cashbook_settlement_events (
 id uuid primary key default gen_random_uuid(),
 entry_id uuid not null references private.cashbook_entries(id) on delete restrict,
 action text not null check(action in ('mark_transferred','confirm_received')),
 request_id uuid not null,
 actor_user_id uuid not null,
 actor_name text not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(entry_id,action),
 unique(actor_user_id,request_id)
);
alter table private.cashbook_settlement_events enable row level security;
revoke all on private.cashbook_settlement_events from public,anon,authenticated,service_role;
grant select,insert on private.cashbook_settlement_events to service_role;
create trigger cashbook_settlement_events_immutable before update or delete on private.cashbook_settlement_events for each row execute function private.cashbook_immutable();
alter table private.cashbook_alerts alter column episode drop not null;
alter table private.cashbook_alerts add column kind text not null default 'low_balance' check(kind in ('low_balance','advance_transferred')),
 add column entry_id uuid references private.cashbook_entries(id) on delete restrict,
 add constraint cashbook_alert_shape_check check((kind='low_balance' and episode is not null and entry_id is null) or (kind='advance_transferred' and episode is null and entry_id is not null)),
 add constraint cashbook_alert_entry_once unique(kind,entry_id);

create or replace function private.cashbook_balance() returns bigint language sql stable security invoker set search_path='' as $$
 select coalesce(sum(case direction when 'deposit' then amount_cents when 'withdrawal' then -amount_cents else 0 end),0)::bigint from private.cashbook_entries
$$;

create function private.cashbook_entry_json(e private.cashbook_entries,viewer uuid,all_evidence boolean) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',e.id,'sequence',e.sequence,'direction',e.direction,'amountCents',e.amount_cents,
  'balanceAfterCents',e.balance_after_cents,'personName',e.person_name,'teamId',e.team_id,'teamName',e.team_name,'note',e.note,'createdAt',e.created_at,
  'entryType',e.entry_type,'originalEntryId',e.original_entry_id,'recordAmountCents',coalesce(e.record_amount_cents,e.amount_cents),
  'changeReason',e.change_reason,'superseded',s.superseded,
  'status',case when e.entry_type='cancellation' then 'cancelled' when s.superseded then 'superseded' when e.direction<>'advance' or received.id is not null then 'completed' when transferred.id is not null then 'transferred' else 'advanced' end,
  'canManage',coalesce(e.account_id=viewer and owner.role='trainer' and e.created_by_user_id=owner.suite_user_id
    and (e.entry_type<>'booking' or e.direction in ('withdrawal','advance')) and e.entry_type<>'cancellation' and not s.superseded and transferred.id is null,false),
  'canViewEvidence',all_evidence or e.account_id=viewer,
  'canMarkTransferred',coalesce(e.direction='advance' and e.entry_type<>'cancellation' and not s.superseded and transferred.id is null and viewer_account.role='cashier',false),
  'canConfirmReceived',coalesce(e.direction='advance' and e.entry_type<>'cancellation' and not s.superseded and transferred.id is not null and received.id is null and e.account_id=viewer and e.created_by_user_id=viewer_account.suite_user_id and viewer_account.role='trainer',false),
  'transferredAt',transferred.created_at,'transferredBy',transferred.actor_name,'receivedAt',received.created_at,'receivedBy',received.actor_name,
  'notificationState',case when not (all_evidence or e.account_id=viewer) or mail.id is null then null when mail.sent_at is not null then 'sent' when mail.last_error is not null then 'retry' else 'pending' end,
  'notificationEmail',case when all_evidence or e.account_id=viewer then e.notification_email end)
 from (select exists(select 1 from private.cashbook_entries c where c.supersedes_entry_id=e.id) superseded) s
 left join private.cashbook_accounts owner on owner.id=e.account_id
 left join private.cashbook_accounts viewer_account on viewer_account.id=viewer
 left join private.cashbook_settlement_events transferred on transferred.entry_id=e.id and transferred.action='mark_transferred'
 left join private.cashbook_settlement_events received on received.entry_id=e.id and received.action='confirm_received'
 left join private.cashbook_alerts mail on mail.entry_id=e.id and mail.kind='advance_transferred'
$$;
create or replace function private.cashbook_ledger(before_sequence bigint,viewer uuid,all_evidence boolean) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(private.cashbook_entry_json(e,viewer,all_evidence) order by e.sequence desc),'[]'::jsonb)
 from (select * from private.cashbook_entries where before_sequence is null or sequence<before_sequence order by sequence desc limit 31) e
$$;
create function private.cashbook_open_advances(viewer uuid,all_evidence boolean) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(private.cashbook_entry_json(e,viewer,all_evidence) order by e.sequence),'[]'::jsonb)
 from private.cashbook_entries e where e.direction='advance' and e.entry_type<>'cancellation'
  and (all_evidence or e.account_id=viewer) and not exists(select 1 from private.cashbook_entries c where c.supersedes_entry_id=e.id)
  and not exists(select 1 from private.cashbook_settlement_events s where s.entry_id=e.id and s.action='confirm_received')
$$;
create or replace function public.cashbook_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare account private.cashbook_accounts; person public.social_people; safe private.cashbook_safe; entry private.cashbook_entries;
 teams jsonb:='[]'; balance bigint; amount integer; team uuid; team_name text; records jsonb; act text:=payload->>'action';
 administrator boolean; youth_leader boolean:=false; can_deposit boolean:=false;
begin
 if act in ('mark_transferred','confirm_received') then return public.cashbook_settlement_request(actor,payload); end if;
 if act in ('authorize_change','edit','cancel') then return public.cashbook_change_request(actor,payload); end if;
 select role='admin',suite_role_key='youth-leadership' into administrator,youth_leader from public.social_admins
  where user_id=actor and is_active and not is_blocked and (role='admin' or (role<>'referee-admin' and 'cashbook'=any(access_areas))) for share;
 if not found then return jsonb_build_object('error','Kein Zugriff auf das Kassenbuch der Jugendabteilung.','status',403); end if;
 select * into account from private.cashbook_accounts where suite_user_id=actor for share;
 if found then
  select * into person from public.social_people where id=account.person_id and active for share;
  if not account.active or person.id is null then return jsonb_build_object('error','Der Kassenzugang ist gesperrt.','status',403); end if;
  youth_leader:=youth_leader or private.cashbook_is_youth_leader(account.person_id);
  can_deposit:=account.role='cashier' or youth_leader;
  teams:=private.cashbook_current_teams(account.person_id);
  if account.role='trainer' and not youth_leader and jsonb_array_length(teams)=0 then return jsonb_build_object('error','Der Mannschaftszugang ist nicht mehr aktiv.','status',403); end if;
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
  if coalesce(payload->>'direction','') not in ('deposit','withdrawal','advance') or (payload->>'confirmed')::boolean is distinct from true
   or coalesce(payload->>'amountCents','') !~ '^[0-9]{1,8}$'
   or coalesce(payload->>'evidenceHash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','Unvollständige Buchung.','status',400); end if;
  amount:=(payload->>'amountCents')::integer;
  if amount<1 or length(coalesce(payload->>'note',''))>500 then return jsonb_build_object('error','Ungültiger Betrag oder Verwendungszweck.','status',400); end if;
  if payload->>'direction'='deposit' and not can_deposit then return jsonb_build_object('error','Nur die Kasse und die Jugendleitung dürfen Einzahlungen erfassen.','status',403); end if;
  team:=(payload->>'teamId')::uuid;
  if payload->>'direction' in ('withdrawal','advance') then
   if account.role<>'trainer' or not exists(select 1 from jsonb_array_elements(teams) t where t->>'id'=team::text) then return jsonb_build_object('error','Bitte eine eigene Mannschaft auswählen.','status',403); end if;
   if coalesce(payload->>'signatureHash','') !~ '^[a-f0-9]{64}$' or coalesce(payload->>'signaturePath','')='' then return jsonb_build_object('error','Bitte die Entnahme unterschreiben.','status',400); end if;
   select name into team_name from public.social_teams where id=team;
  else team:=null; team_name:='Vereinskasse / Jugendkasse'; end if;
  if coalesce(payload->>'evidencePath','') not like account.id::text||'/'||(payload->>'requestId')||'/%'
   or (payload->>'direction' in ('withdrawal','advance') and coalesce(payload->>'signaturePath','') not like account.id::text||'/'||(payload->>'requestId')||'/%') then
   return jsonb_build_object('error','Ungültiger Beleg.','status',400);
  end if;
  if payload->>'direction'='advance' and (coalesce(payload->>'notificationEmail','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(payload->>'notificationEmail')>254 or lower(payload->>'notificationEmail') like '%.invalid') then return jsonb_build_object('error','Bitte eine erreichbare E-Mail-Adresse für die Erstattungsbenachrichtigung angeben.','status',400); end if;
  -- Serialize the balance check, append and low-stock transition in one transaction.
  select * into safe from private.cashbook_safe where id=true for update;
  select * into entry from private.cashbook_entries where account_id=account.id and request_id=(payload->>'requestId')::uuid;
  if found then
   if entry.direction is distinct from payload->>'direction' or entry.amount_cents<>amount or entry.team_id is distinct from team
    or entry.evidence_hash is distinct from payload->>'evidenceHash' or entry.signature_hash is distinct from payload->>'signatureHash'
    or (entry.direction='advance' and entry.notification_email is distinct from lower(trim(payload->>'notificationEmail')))
    or entry.note is distinct from coalesce(payload->>'note','') then return jsonb_build_object('error','Diese Buchungsnummer gehört zu anderen Angaben.','status',409); end if;
  else
   if payload->>'direction' in ('withdrawal','advance') and exists(select 1 from private.cashbook_entries where team_id is not null and evidence_hash=payload->>'evidenceHash') then
    return jsonb_build_object('error','Diese Quittung wurde bereits gebucht.','status',409);
   end if;
   balance:=private.cashbook_balance();
   if payload->>'direction'='withdrawal' and amount>balance then return jsonb_build_object('error','Der Safe enthält nicht genug Geld. Bitte die Kasse verständigen oder die Zahlung mit „Vorstrecken“ erfassen.','status',409); end if;
   balance:=balance+case payload->>'direction' when 'deposit' then amount when 'withdrawal' then -amount else 0 end;
   insert into private.cashbook_entries(account_id,request_id,direction,amount_cents,balance_after_cents,person_name,team_id,team_name,note,evidence_path,evidence_hash,signature_path,signature_hash,created_by_user_id,notification_email)
    values(account.id,(payload->>'requestId')::uuid,payload->>'direction',amount,balance,person.display_name,team,team_name,coalesce(payload->>'note',''),payload->>'evidencePath',payload->>'evidenceHash',payload->>'signaturePath',payload->>'signatureHash',actor,case when payload->>'direction'='advance' then lower(trim(payload->>'notificationEmail')) else null end) returning * into entry;
   if payload->>'direction'<>'advance' then
   if balance<safe.threshold_cents and not safe.low_alert_active then
    update private.cashbook_safe set low_alert_active=true,alert_episode=alert_episode+1 where id=true returning * into safe;
    insert into private.cashbook_alerts(episode,balance_cents,recipient) values(safe.alert_episode,balance,safe.notification_email);
   elsif balance>=safe.threshold_cents then update private.cashbook_safe set low_alert_active=false where id=true; end if;
   end if;
  end if;
 end if;
 balance:=private.cashbook_balance();
 records:=private.cashbook_ledger((payload->>'before')::bigint,account.id,administrator or coalesce(account.role='cashier',false));
 return jsonb_build_object('user',jsonb_build_object('id',account.id,'name',person.display_name,'username',account.username,'role',coalesce(account.role,'observer'),'isYouthLeader',youth_leader,'notificationEmail',coalesce((select e.notification_email from private.cashbook_entries e where e.created_by_user_id=actor and e.direction='advance' order by e.sequence desc limit 1),(select case when email not like '%.invalid' then email end from public.social_admins where user_id=actor))),
  'canBook',account.id is not null,'canReimburse',coalesce(account.role='cashier',false),
  'openAdvances',private.cashbook_open_advances(account.id,administrator or coalesce(account.role='cashier',false)),'canDeposit',account.id is not null and can_deposit,
  'canWithdraw',account.id is not null and account.role='trainer' and jsonb_array_length(teams)>0,'canExport',administrator or coalesce(account.role='cashier',false),'teams',teams,'balanceCents',balance,'thresholdCents',safe.threshold_cents,'instructions',safe.instructions,'entries',records,
  'entryId',entry.id,'notificationPending',exists(select 1 from private.cashbook_alerts where sent_at is null));
end $$;


create function public.cashbook_settlement_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare identity jsonb; account private.cashbook_accounts; target private.cashbook_entries; original private.cashbook_entries;
 prior private.cashbook_settlement_events; act text:=payload->>'action'; target_id uuid; operation_id uuid; actor_name text;
begin
 if act not in ('mark_transferred','confirm_received') then return jsonb_build_object('error','Unbekannte Erstattungsaktion.','status',400); end if;
 if payload->>'confirmed' is distinct from 'true' then return jsonb_build_object('error','Bitte die Überweisung beziehungsweise den Geldeingang bestätigen.','status',400); end if;
 target_id:=(payload->>'id')::uuid; operation_id:=(payload->>'requestId')::uuid;
 if target_id is null or operation_id is null then return jsonb_build_object('error','Ungültige Erstattungsangaben.','status',400); end if;
 identity:=public.cashbook_request(actor,'{"action":"authorize"}');
 if identity ? 'error' then return identity; end if;
 select * into account from private.cashbook_accounts where suite_user_id=actor for share;
 if account.id is null then return jsonb_build_object('error','Für Erstattungen ist eine Kassenrolle erforderlich.','status',403); end if;
 if act='mark_transferred' and account.role<>'cashier' then return jsonb_build_object('error','Nur die Kasse darf eine Überweisung bestätigen.','status',403); end if;
 perform 1 from private.cashbook_safe where id=true for update;
 select * into target from private.cashbook_entries where id=target_id;
 select * into original from private.cashbook_entries where id=coalesce(target.original_entry_id,target.id);
 if target.id is null or target.direction<>'advance' then return jsonb_build_object('error','Dieser Eintrag ist keine vorgestreckte Zahlung.','status',400); end if;
 if act='confirm_received' and (account.role<>'trainer' or original.created_by_user_id is distinct from actor or target.account_id<>account.id) then return jsonb_build_object('error','Du darfst nur den Eingang deiner eigenen Erstattung bestätigen.','status',403); end if;
 select * into prior from private.cashbook_settlement_events where actor_user_id=actor and request_id=operation_id;
 if prior.id is not null then
  if prior.entry_id<>target.id or prior.action<>act then return jsonb_build_object('error','Diese Bestätigungsnummer gehört zu anderen Angaben.','status',409); end if;
  return public.cashbook_request(actor,'{"action":"list"}')||jsonb_build_object('entryId',target.id);
 end if;
 if target.entry_type='cancellation' or exists(select 1 from private.cashbook_entries c where c.supersedes_entry_id=target.id) then return jsonb_build_object('error','Dieser Eintrag wurde geändert oder storniert. Bitte das Kassenbuch aktualisieren.','status',409); end if;
 if exists(select 1 from private.cashbook_settlement_events s where s.entry_id=target.id and s.action=act) then return jsonb_build_object('error','Dieser Schritt wurde bereits bestätigt. Bitte das Kassenbuch aktualisieren.','status',409); end if;
 if act='confirm_received' and not exists(select 1 from private.cashbook_settlement_events s where s.entry_id=target.id and s.action='mark_transferred') then return jsonb_build_object('error','Die Kasse hat die Überweisung noch nicht bestätigt.','status',409); end if;
 actor_name:=identity->'user'->>'name';
 insert into private.cashbook_settlement_events(entry_id,action,request_id,actor_user_id,actor_name) values(target.id,act,operation_id,actor,actor_name);
 if act='mark_transferred' then
  insert into private.cashbook_alerts(kind,entry_id,balance_cents,recipient) values('advance_transferred',target.id,private.cashbook_balance(),target.notification_email);
 end if;
 return public.cashbook_request(actor,'{"action":"list"}')||jsonb_build_object('entryId',target.id);
exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('error','Ungültige Erstattungsangaben.','status',400);
end $$;
create or replace function public.cashbook_change_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
<<change_operation>>
declare identity jsonb; account private.cashbook_accounts; target private.cashbook_entries; original private.cashbook_entries;
 prior private.cashbook_entries; safe private.cashbook_safe; entry private.cashbook_entries; action text:=payload->>'action';
 kind text; request_id uuid; target_id uuid; amount integer; old_amount integer; delta integer; balance bigint; team uuid;
 evidence_path text; evidence_hash text; reason text;
begin
 if action not in ('authorize_change','edit','cancel') then return jsonb_build_object('error','Unbekannte Änderung.','status',400); end if;
 identity:=public.cashbook_request(actor,'{"action":"authorize"}'::jsonb);
 if identity ? 'error' then return identity; end if;
 select * into account from private.cashbook_accounts where suite_user_id=actor for share;
 if account.id is null or account.role<>'trainer' then return jsonb_build_object('error','Nur Trainer und Jugendleitung dürfen eigene Entnahmen ändern.','status',403); end if;
 target_id:=(payload->>'id')::uuid; request_id:=(payload->>'requestId')::uuid;
 if target_id is null or request_id is null then return jsonb_build_object('error','Ungültige Änderung.','status',400); end if;
 -- Global ordering is also used by normal bookings: no negative balances or competing revisions.
 select * into safe from private.cashbook_safe where id=true for update;
 select * into target from private.cashbook_entries where id=target_id;
 select * into original from private.cashbook_entries where id=coalesce(target.original_entry_id,target.id);
 if target.id is null or target.account_id<>account.id or original.direction not in ('withdrawal','advance')
  or original.created_by_user_id is distinct from actor then
  return jsonb_build_object('error','Du darfst nur eigene Einträge bearbeiten oder löschen.','status',403);
 end if;
 select * into prior from private.cashbook_entries where account_id=account.id and cashbook_entries.request_id=change_operation.request_id;
 if prior.id is not null and (prior.supersedes_entry_id is distinct from target.id or
  prior.entry_type is distinct from (case coalesce(payload->>'changeAction',action) when 'edit' then 'correction' when 'cancel' then 'cancellation' else '' end)) then
  return jsonb_build_object('error','Diese Änderungsnummer gehört zu anderen Angaben.','status',409);
 end if;
 if prior.id is null and (target.entry_type='cancellation' or exists(select 1 from private.cashbook_entries c where c.supersedes_entry_id=target.id)) then
  return jsonb_build_object('error','Dieser Eintrag wurde bereits geändert. Bitte das Kassenbuch aktualisieren.','status',409);
 end if;
 if prior.id is null and original.direction='advance' and exists(select 1 from private.cashbook_settlement_events s where s.entry_id=target.id) then return jsonb_build_object('error','Nach der Überweisung kann dieser Eintrag nicht mehr geändert oder gelöscht werden.','status',409); end if;
 if action='authorize_change' then
  return identity||jsonb_build_object('entry',jsonb_build_object('id',target.id,'amountCents',coalesce(target.record_amount_cents,target.amount_cents),
   'teamId',target.team_id,'evidencePath',target.evidence_path,'evidenceHash',target.evidence_hash));
 end if;
 if payload->>'confirmed' is distinct from 'true' or coalesce(payload->>'signatureHash','') !~ '^[a-f0-9]{64}$'
  or coalesce(payload->>'signaturePath','') not like account.id::text||'/'||request_id::text||'/%' then
  return jsonb_build_object('error','Bitte die Änderung bestätigen und unterschreiben.','status',400);
 end if;
 reason:=trim(coalesce(payload->>'reason',''));
 if length(reason) not between 1 and 500 or length(coalesce(payload->>'note',''))>500 then
  return jsonb_build_object('error','Bitte einen Änderungsgrund mit höchstens 500 Zeichen eingeben.','status',400);
 end if;
 old_amount:=coalesce(target.record_amount_cents,target.amount_cents);
 if action='edit' then
  if coalesce(payload->>'amountCents','') !~ '^[0-9]{1,8}$' or (payload->>'amountCents')::integer<1 then return jsonb_build_object('error','Ungültiger Betrag.','status',400); end if;
  amount:=(payload->>'amountCents')::integer; team:=(payload->>'teamId')::uuid;
  if not exists(select 1 from jsonb_array_elements(identity->'teams') t where t->>'id'=team::text) then return jsonb_build_object('error','Bitte eine eigene Mannschaft auswählen.','status',403); end if;
  if coalesce(payload->>'evidenceHash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','Ungültiger Beleg.','status',400); end if;
  evidence_path:=payload->>'evidencePath'; evidence_hash:=payload->>'evidenceHash';
  if not (evidence_path=target.evidence_path and evidence_hash=target.evidence_hash)
   and coalesce(evidence_path,'') not like account.id::text||'/'||request_id::text||'/%' then return jsonb_build_object('error','Ungültiger Beleg.','status',400); end if;
  if exists(select 1 from private.cashbook_entries e where e.team_id is not null and e.evidence_hash=change_operation.evidence_hash
    and coalesce(e.original_entry_id,e.id)<>original.id) then return jsonb_build_object('error','Diese Quittung gehört bereits zu einer anderen Buchung.','status',409); end if;
  kind:='correction';
 else amount:=0; team:=target.team_id; evidence_path:=target.evidence_path; evidence_hash:=target.evidence_hash; kind:='cancellation'; end if;
 if prior.id is not null then
  if prior.record_amount_cents<>amount or prior.team_id is distinct from team or prior.change_reason is distinct from reason
   or prior.evidence_hash is distinct from evidence_hash or prior.signature_hash is distinct from payload->>'signatureHash'
   or prior.note is distinct from (case when action='cancel' then target.note else coalesce(payload->>'note','') end) then
   return jsonb_build_object('error','Diese Änderungsnummer gehört zu anderen Angaben.','status',409);
  end if;
  return public.cashbook_request(actor,'{"action":"list"}'::jsonb)||jsonb_build_object('entryId',prior.id);
 end if;
 delta:=case when original.direction='advance' then 0 else old_amount-amount end; balance:=private.cashbook_balance()+delta;
 if balance<0 then return jsonb_build_object('error','Der Safe enthält nicht genug Geld für die zusätzliche Entnahme.','status',409); end if;
 insert into private.cashbook_entries(account_id,request_id,direction,amount_cents,balance_after_cents,person_name,team_id,team_name,note,
  evidence_path,evidence_hash,signature_path,signature_hash,entry_type,original_entry_id,supersedes_entry_id,record_amount_cents,change_reason,created_by_user_id,notification_email)
 values(account.id,request_id,case when original.direction='advance' then 'advance' when delta>=0 then 'deposit' else 'withdrawal' end,abs(delta),balance,
  identity->'user'->>'name',team,(select name from public.social_teams where id=team),case when action='cancel' then target.note else coalesce(payload->>'note','') end,
  evidence_path,evidence_hash,payload->>'signaturePath',payload->>'signatureHash',kind,original.id,target.id,amount,reason,actor,target.notification_email) returning * into entry;
 if original.direction<>'advance' then
 if balance<safe.threshold_cents and not safe.low_alert_active then
  update private.cashbook_safe set low_alert_active=true,alert_episode=alert_episode+1 where id=true returning * into safe;
  insert into private.cashbook_alerts(episode,balance_cents,recipient) values(safe.alert_episode,balance,safe.notification_email);
 elsif balance>=safe.threshold_cents then update private.cashbook_safe set low_alert_active=false where id=true; end if;
 end if;
 return public.cashbook_request(actor,'{"action":"list"}'::jsonb)||jsonb_build_object('entryId',entry.id);
exception when invalid_text_representation or numeric_value_out_of_range then
 return jsonb_build_object('error','Ungültige Änderungsangaben.','status',400);
end $$;
create or replace function public.cashbook_alert_request(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare alert private.cashbook_alerts;
begin
 if payload->>'action'='claim' then
  select * into alert from private.cashbook_alerts where sent_at is null and next_attempt_at<=now() and (locked_until is null or locked_until<=now()) order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update private.cashbook_alerts set locked_until=now()+interval '2 minutes',lease_id=gen_random_uuid(),attempts=attempts+1 where id=alert.id returning * into alert;
  return to_jsonb(alert)||coalesce((select jsonb_build_object('person_name',e.person_name,'team_name',e.team_name,'amount_cents',coalesce(e.record_amount_cents,e.amount_cents),'sequence',e.sequence) from private.cashbook_entries e where e.id=alert.entry_id),'{}'::jsonb);
 elsif payload->>'action'='sent' then
  update private.cashbook_alerts set sent_at=now(),locked_until=null,last_error=null where id=(payload->>'id')::uuid and lease_id=(payload->>'leaseId')::uuid and sent_at is null;
 elsif payload->>'action'='failed' then
  update private.cashbook_alerts set locked_until=null,next_attempt_at=now()+interval '5 minutes',last_error=left(payload->>'error',200)
   where id=(payload->>'id')::uuid and lease_id=(payload->>'leaseId')::uuid and sent_at is null;
 else raise exception 'Ungültige Aktion'; end if;
 return jsonb_build_object('ok',true);
end $$;

revoke all on function private.cashbook_entry_json(private.cashbook_entries,uuid,boolean),private.cashbook_open_advances(uuid,boolean) from public,anon,authenticated;
grant execute on function private.cashbook_entry_json(private.cashbook_entries,uuid,boolean),private.cashbook_open_advances(uuid,boolean) to service_role;
revoke all on function public.cashbook_settlement_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cashbook_settlement_request(uuid,jsonb) to service_role;
commit;
