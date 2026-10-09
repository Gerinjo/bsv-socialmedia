-- Corrections and cancellations append signed differences; original evidence stays immutable.
begin;
alter table private.cashbook_entries
 add column entry_type text not null default 'booking' check(entry_type in ('booking','correction','cancellation')),
 add column original_entry_id uuid references private.cashbook_entries(id) on delete restrict,
 add column supersedes_entry_id uuid unique references private.cashbook_entries(id) on delete restrict,
 add column record_amount_cents integer check(record_amount_cents between 0 and 99999999),
 add column change_reason text check(length(change_reason) between 1 and 500),
 add column created_by_user_id uuid;
-- Capture the existing binding once for legacy rows. Money, evidence and times never change.
-- The migration's exclusive table lock and transaction prevent callers from bypassing the trigger.
alter table private.cashbook_entries disable trigger cashbook_entries_immutable;
update private.cashbook_entries e set created_by_user_id=a.suite_user_id
 from private.cashbook_accounts a where a.id=e.account_id and e.created_by_user_id is null;
alter table private.cashbook_entries enable trigger cashbook_entries_immutable;
alter table private.cashbook_entries drop constraint cashbook_entries_amount_cents_check;
alter table private.cashbook_entries add constraint cashbook_entries_amount_cents_check
 check(amount_cents between 0 and 99999999 and (entry_type<>'booking' or amount_cents>0));
-- A cancellation deliberately retains the previously stored photo.
alter table private.cashbook_entries drop constraint cashbook_entries_evidence_path_key;
alter table private.cashbook_entries add constraint cashbook_change_shape_check check(
 (entry_type='booking' and original_entry_id is null and supersedes_entry_id is null and record_amount_cents is null and change_reason is null)
 or (entry_type<>'booking' and original_entry_id is not null and supersedes_entry_id is not null and created_by_user_id is not null
  and change_reason is not null and team_id is not null and signature_path is not null and signature_hash is not null and signature_hash ~ '^[a-f0-9]{64}$'
  and ((entry_type='correction' and record_amount_cents>0) or (entry_type='cancellation' and record_amount_cents=0))));
drop index private.cashbook_receipt_once_idx;
create unique index cashbook_receipt_once_idx on private.cashbook_entries(evidence_hash) where direction='withdrawal' and entry_type='booking';
create index cashbook_entries_original_idx on private.cashbook_entries(original_entry_id);

create or replace function private.cashbook_ledger(before_sequence bigint,viewer uuid,all_evidence boolean) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'sequence',e.sequence,'direction',e.direction,'amountCents',e.amount_cents,
  'balanceAfterCents',e.balance_after_cents,'personName',e.person_name,'teamId',e.team_id,'teamName',e.team_name,'note',e.note,'createdAt',e.created_at,
  'entryType',e.entry_type,'originalEntryId',e.original_entry_id,'recordAmountCents',coalesce(e.record_amount_cents,e.amount_cents),
  'changeReason',e.change_reason,'superseded',exists(select 1 from private.cashbook_entries c where c.supersedes_entry_id=e.id),
  'canManage',coalesce(e.account_id=viewer and a.role='trainer' and e.created_by_user_id=a.suite_user_id
    and e.entry_type<>'cancellation' and not exists(select 1 from private.cashbook_entries c where c.supersedes_entry_id=e.id),false),
  'canViewEvidence',all_evidence or e.account_id=viewer) order by e.sequence desc),'[]'::jsonb)
 from (select * from private.cashbook_entries where before_sequence is null or sequence<before_sequence order by sequence desc limit 31) e
 left join private.cashbook_accounts a on a.id=e.account_id
$$;

create function public.cashbook_change_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
 if target.id is null or target.account_id<>account.id or original.direction<>'withdrawal'
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
 delta:=old_amount-amount; balance:=private.cashbook_balance()+delta;
 if balance<0 then return jsonb_build_object('error','Der Safe enthält nicht genug Geld für die zusätzliche Entnahme.','status',409); end if;
 insert into private.cashbook_entries(account_id,request_id,direction,amount_cents,balance_after_cents,person_name,team_id,team_name,note,
  evidence_path,evidence_hash,signature_path,signature_hash,entry_type,original_entry_id,supersedes_entry_id,record_amount_cents,change_reason,created_by_user_id)
 values(account.id,request_id,case when delta>=0 then 'deposit' else 'withdrawal' end,abs(delta),balance,
  identity->'user'->>'name',team,(select name from public.social_teams where id=team),case when action='cancel' then target.note else coalesce(payload->>'note','') end,
  evidence_path,evidence_hash,payload->>'signaturePath',payload->>'signatureHash',kind,original.id,target.id,amount,reason,actor) returning * into entry;
 if balance<safe.threshold_cents and not safe.low_alert_active then
  update private.cashbook_safe set low_alert_active=true,alert_episode=alert_episode+1 where id=true returning * into safe;
  insert into private.cashbook_alerts(episode,balance_cents,recipient) values(safe.alert_episode,balance,safe.notification_email);
 elsif balance>=safe.threshold_cents then update private.cashbook_safe set low_alert_active=false where id=true; end if;
 return public.cashbook_request(actor,'{"action":"list"}'::jsonb)||jsonb_build_object('entryId',entry.id);
exception when invalid_text_representation or numeric_value_out_of_range then
 return jsonb_build_object('error','Ungültige Änderungsangaben.','status',400);
end $$;
revoke all on function public.cashbook_change_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cashbook_change_request(uuid,jsonb) to service_role;

create or replace function public.cashbook_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare account private.cashbook_accounts; person public.social_people; safe private.cashbook_safe; entry private.cashbook_entries;
 teams jsonb:='[]'; balance bigint; amount integer; team uuid; team_name text; records jsonb; act text:=payload->>'action';
 administrator boolean;
begin
 if act in ('authorize_change','edit','cancel') then return public.cashbook_change_request(actor,payload); end if;
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
   if payload->>'direction'='withdrawal' and exists(select 1 from private.cashbook_entries where team_id is not null and evidence_hash=payload->>'evidenceHash') then
    return jsonb_build_object('error','Diese Quittung wurde bereits gebucht.','status',409);
   end if;
   balance:=private.cashbook_balance();
   if payload->>'direction'='withdrawal' and amount>balance then return jsonb_build_object('error','Der Safe enthält nicht genug Geld. Bitte die Kasse verständigen.','status',409); end if;
   balance:=balance+case payload->>'direction' when 'deposit' then amount else -amount end;
   insert into private.cashbook_entries(account_id,request_id,direction,amount_cents,balance_after_cents,person_name,team_id,team_name,note,evidence_path,evidence_hash,signature_path,signature_hash,created_by_user_id)
    values(account.id,(payload->>'requestId')::uuid,payload->>'direction',amount,balance,person.display_name,team,team_name,coalesce(payload->>'note',''),payload->>'evidencePath',payload->>'evidenceHash',payload->>'signaturePath',payload->>'signatureHash',actor) returning * into entry;
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


commit;
