-- Youth leadership may restock the safe while retaining its withdrawal permissions.
-- Capabilities come from active server-side accounts and current club / Suite roles.
begin;

create or replace function private.cashbook_ledger(before_sequence bigint,viewer uuid,all_evidence boolean) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'sequence',e.sequence,'direction',e.direction,'amountCents',e.amount_cents,
  'balanceAfterCents',e.balance_after_cents,'personName',e.person_name,'teamId',e.team_id,'teamName',e.team_name,'note',e.note,'createdAt',e.created_at,
  'entryType',e.entry_type,'originalEntryId',e.original_entry_id,'recordAmountCents',coalesce(e.record_amount_cents,e.amount_cents),
  'changeReason',e.change_reason,'superseded',exists(select 1 from private.cashbook_entries c where c.supersedes_entry_id=e.id),
  'canManage',coalesce(e.account_id=viewer and a.role='trainer' and e.created_by_user_id=a.suite_user_id
    and (e.entry_type<>'booking' or e.direction='withdrawal') and e.entry_type<>'cancellation' and not exists(select 1 from private.cashbook_entries c where c.supersedes_entry_id=e.id),false),
  'canViewEvidence',all_evidence or e.account_id=viewer) order by e.sequence desc),'[]'::jsonb)
 from (select * from private.cashbook_entries where before_sequence is null or sequence<before_sequence order by sequence desc limit 31) e
 left join private.cashbook_accounts a on a.id=e.account_id
$$;

create or replace function public.cashbook_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare account private.cashbook_accounts; person public.social_people; safe private.cashbook_safe; entry private.cashbook_entries;
 teams jsonb:='[]'; balance bigint; amount integer; team uuid; team_name text; records jsonb; act text:=payload->>'action';
 administrator boolean; youth_leader boolean:=false; can_deposit boolean:=false;
begin
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
  if coalesce(payload->>'direction','') not in ('deposit','withdrawal') or (payload->>'confirmed')::boolean is distinct from true
   or coalesce(payload->>'amountCents','') !~ '^[0-9]{1,8}$'
   or coalesce(payload->>'evidenceHash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','Unvollständige Buchung.','status',400); end if;
  amount:=(payload->>'amountCents')::integer;
  if amount<1 or length(coalesce(payload->>'note',''))>500 then return jsonb_build_object('error','Ungültiger Betrag oder Verwendungszweck.','status',400); end if;
  if payload->>'direction'='deposit' and not can_deposit then return jsonb_build_object('error','Nur die Kasse und die Jugendleitung dürfen Einzahlungen erfassen.','status',403); end if;
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
 return jsonb_build_object('user',jsonb_build_object('id',account.id,'name',person.display_name,'username',account.username,'role',coalesce(account.role,'observer'),'isYouthLeader',youth_leader),
  'canBook',account.id is not null,'canDeposit',account.id is not null and can_deposit,
  'canWithdraw',account.id is not null and account.role='trainer' and jsonb_array_length(teams)>0,'canExport',administrator or coalesce(account.role='cashier',false),'teams',teams,'balanceCents',balance,'thresholdCents',safe.threshold_cents,'instructions',safe.instructions,'entries',records,
  'entryId',entry.id,'notificationPending',exists(select 1 from private.cashbook_alerts where sent_at is null));
end $$;

revoke all on function public.cashbook_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cashbook_request(uuid,jsonb) to service_role;

commit;
