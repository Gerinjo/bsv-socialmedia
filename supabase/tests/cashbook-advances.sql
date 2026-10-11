-- Isolated integration test. No real money, users, storage objects or e-mails are created.
begin;
create function pg_temp.advance_check(ok boolean,description text) returns void language plpgsql as $$begin if ok is not true then raise exception 'Advance test: %',description;end if;end $$;
set local role service_role;
do $$
declare trainer private.cashbook_accounts; other private.cashbook_accounts; cashier private.cashbook_accounts;
 payload jsonb; result jsonb; transfer jsonb; receipt jsonb; change jsonb; target_id uuid; edited_id uuid; cancel_id uuid;
 operation_id uuid; balance_before bigint; alerts_before bigint; team uuid; hash text; mail jsonb;
begin
 select * into trainer from private.cashbook_accounts where username='jentm';
 select * into other from private.cashbook_accounts where username='schmo';
 select * into cashier from private.cashbook_accounts where username='barow';
 select id into team from public.social_teams where slug='u19-junioren';
 balance_before:=private.cashbook_balance();select count(*) into alerts_before from private.cashbook_alerts;
 operation_id:=gen_random_uuid(); hash:=md5(operation_id::text)||md5(operation_id::text);
 payload:=jsonb_build_object('action','book','requestId',operation_id,'direction','advance','amountCents',balance_before+10000,'teamId',team,'confirmed',true,
  'notificationEmail','Trainer@Example.org','evidenceHash',hash,'signatureHash',repeat('b',64),'note','Kunstrasen: privat bezahlt',
  'evidencePath',trainer.id::text||'/'||operation_id::text||'/receipt','signaturePath',trainer.id::text||'/'||operation_id::text||'/signature');
 result:=public.cashbook_request(trainer.suite_user_id,payload-'notificationEmail');perform pg_temp.advance_check(result->>'status'='400','email required');
 result:=public.cashbook_request(trainer.suite_user_id,payload||'{"notificationEmail":"cashbook-user@suite.bsvnordstern.invalid"}');perform pg_temp.advance_check(result->>'status'='400','technical mailbox rejected');
 result:=public.cashbook_request(trainer.suite_user_id,payload-'signatureHash');perform pg_temp.advance_check(result->>'status'='400','signature required');
 result:=public.cashbook_request(cashier.suite_user_id,payload);perform pg_temp.advance_check(result->>'status'='403','cashier cannot claim trainer advance');
 result:=public.cashbook_request(trainer.suite_user_id,payload);target_id:=(result->>'entryId')::uuid;
 perform pg_temp.advance_check(target_id is not null and not (result ? 'error'),'advance above safe balance succeeds');
 perform pg_temp.advance_check((result->>'balanceCents')::bigint=balance_before,'advance leaves safe unchanged');
 perform pg_temp.advance_check((select count(*)=alerts_before from private.cashbook_alerts),'advance does not trigger refill alert');
 perform pg_temp.advance_check(result->'user'->>'notificationEmail'='trainer@example.org','real address remembered without changing login');
 perform pg_temp.advance_check(exists(select 1 from jsonb_array_elements(result->'openAdvances') e where e->>'id'=target_id::text and e->>'status'='advanced' and (e->>'canManage')::boolean and not (e->>'canMarkTransferred')::boolean),'owner sees pending advance');
 perform pg_temp.advance_check((select created_by_user_id=trainer.suite_user_id and notification_email='trainer@example.org' and created_at>=now()-interval '1 minute' from private.cashbook_entries where id=target_id),'amount, immutable actor, email and server timestamp retained');
 result:=public.cashbook_request(trainer.suite_user_id,payload);perform pg_temp.advance_check(result->>'entryId'=target_id::text,'identical retry returns existing advance');
 result:=public.cashbook_request(trainer.suite_user_id,payload||'{"notificationEmail":"different@example.org"}');perform pg_temp.advance_check(result->>'status'='409','changed retry rejected');
 result:=public.cashbook_request(trainer.suite_user_id,payload||'{"direction":"withdrawal"}'||jsonb_build_object('requestId',gen_random_uuid(),'evidencePath',trainer.id::text||'/other/receipt','signaturePath',trainer.id::text||'/other/signature'));perform pg_temp.advance_check(result->>'status'='400','untrusted evidence paths rejected');
 operation_id:=gen_random_uuid();result:=public.cashbook_request(trainer.suite_user_id,payload||jsonb_build_object('direction','withdrawal','requestId',operation_id,'evidencePath',trainer.id::text||'/'||operation_id::text||'/receipt','signaturePath',trainer.id::text||'/'||operation_id::text||'/signature'));
 perform pg_temp.advance_check(result->>'status'='409','same receipt cannot be withdrawn after advancing');
 receipt:=jsonb_build_object('action','confirm_received','id',target_id,'requestId',gen_random_uuid(),'confirmed',true);
 result:=public.cashbook_request(trainer.suite_user_id,receipt);perform pg_temp.advance_check(result->>'status'='409','receipt cannot precede transfer');
 transfer:=jsonb_build_object('action','mark_transferred','id',target_id,'requestId',gen_random_uuid(),'confirmed',true);
 result:=public.cashbook_request(trainer.suite_user_id,transfer);perform pg_temp.advance_check(result->>'status'='403','trainer cannot transfer');
 result:=public.cashbook_request(other.suite_user_id,transfer);perform pg_temp.advance_check(result->>'status'='403','youth leader cannot impersonate cashier');
 result:=public.cashbook_request(cashier.suite_user_id,transfer||'{"confirmed":false}');perform pg_temp.advance_check(result->>'status'='400','explicit transfer confirmation required');
 update public.social_admins set is_blocked=true where user_id=cashier.suite_user_id;
 result:=public.cashbook_request(cashier.suite_user_id,transfer);perform pg_temp.advance_check(result->>'status'='403','blocked cashier cannot transfer');
 update public.social_admins set is_blocked=false where user_id=cashier.suite_user_id;
 result:=public.cashbook_request(cashier.suite_user_id,transfer);
 perform pg_temp.advance_check(not (result ? 'error') and (result->>'balanceCents')::bigint=balance_before,'transfer does not change cash');
 perform pg_temp.advance_check(exists(select 1 from jsonb_array_elements(result->'openAdvances') e where e->>'id'=target_id::text and e->>'status'='transferred' and not (e->>'canManage')::boolean and not (e->>'canMarkTransferred')::boolean and e->>'transferredAt' is not null),'transfer stays open and locks amount');
 perform pg_temp.advance_check((select count(*)=1 from private.cashbook_alerts where entry_id=target_id and kind='advance_transferred'),'one durable transfer e-mail queued');
 perform pg_temp.advance_check(exists(select 1 from private.cashbook_alerts a where a.entry_id=target_id and a.recipient='trainer@example.org'),'mail uses real trainer address');
 perform public.cashbook_request(cashier.suite_user_id,transfer);
 perform pg_temp.advance_check((select count(*)=1 from private.cashbook_settlement_events e where e.entry_id=target_id and action='mark_transferred'),'transfer retry does not duplicate event');
 result:=public.cashbook_request(cashier.suite_user_id,transfer||jsonb_build_object('requestId',gen_random_uuid()));perform pg_temp.advance_check(result->>'status'='409','a second transfer is rejected');
 result:=public.cashbook_request(trainer.suite_user_id,jsonb_build_object('action','authorize_change','id',target_id,'requestId',gen_random_uuid(),'changeAction','cancel'));
 perform pg_temp.advance_check(result->>'status'='409','transferred amount cannot be canceled');
 result:=public.cashbook_request(other.suite_user_id,receipt);perform pg_temp.advance_check(result->>'status'='403','foreign trainer cannot confirm receipt');
 result:=public.cashbook_request(cashier.suite_user_id,receipt);perform pg_temp.advance_check(result->>'status'='403','cashier cannot close on behalf of trainer');
 result:=public.cashbook_request(trainer.suite_user_id,'{"action":"list"}');
 perform pg_temp.advance_check(exists(select 1 from jsonb_array_elements(result->'openAdvances') e where e->>'id'=target_id::text and (e->>'canConfirmReceived')::boolean),'owner can confirm receipt');
 result:=public.cashbook_request(other.suite_user_id,'{"action":"list"}');perform pg_temp.advance_check(jsonb_array_length(result->'openAdvances')=0,'trainer outstanding list excludes foreign claims');
 -- Open claims are returned independently of the 31 most recent ledger rows.
 for i in 1..32 loop
  operation_id:=gen_random_uuid();hash:=md5(operation_id::text)||md5(operation_id::text);
  perform public.cashbook_request(trainer.suite_user_id,payload||jsonb_build_object('requestId',operation_id,'evidenceHash',hash,'evidencePath',trainer.id::text||'/'||operation_id::text||'/receipt','signaturePath',trainer.id::text||'/'||operation_id::text||'/signature'));
 end loop;
 result:=public.cashbook_request(trainer.suite_user_id,'{"action":"list"}');
 perform pg_temp.advance_check(jsonb_array_length(result->'entries')=31 and jsonb_array_length(result->'openAdvances')=33,'all open claims remain available after pagination');
 perform pg_temp.advance_check(exists(select 1 from jsonb_array_elements(result->'openAdvances') e where e->>'id'=target_id::text),'old transfer remains actionable');
 result:=public.cashbook_request(trainer.suite_user_id,receipt);
 perform pg_temp.advance_check(not (result ? 'error') and not exists(select 1 from jsonb_array_elements(result->'openAdvances') e where e->>'id'=target_id::text),'receipt closes outstanding claim');
 perform pg_temp.advance_check(private.cashbook_entry_json((select e from private.cashbook_entries e where e.id=target_id),trainer.id,false)->>'status'='completed','only owner receipt completes advance');
 perform public.cashbook_request(trainer.suite_user_id,receipt);
 perform pg_temp.advance_check((select count(*)=2 from private.cashbook_settlement_events e where e.entry_id=target_id),'receipt retry does not duplicate event');
 -- Pre-transfer edits and cancellations retain evidence, never touch cash or trigger refill e-mails.
 select id into edited_id from private.cashbook_entries where direction='advance' and id<>target_id order by sequence desc limit 1;
 change:=jsonb_build_object('action','edit','id',edited_id,'requestId',gen_random_uuid(),'amountCents',99999999,'teamId',team,'confirmed',true,'reason','Betrag korrigiert','signatureHash',repeat('c',64));
 change:=change||jsonb_build_object('signaturePath',trainer.id::text||'/'||(change->>'requestId')||'/signature','evidencePath',(select evidence_path from private.cashbook_entries where id=edited_id),'evidenceHash',(select evidence_hash from private.cashbook_entries where id=edited_id));
 result:=public.cashbook_request(trainer.suite_user_id,change);cancel_id:=(result->>'entryId')::uuid;
 perform pg_temp.advance_check(not (result ? 'error') and (result->>'balanceCents')::bigint=balance_before,'advance correction ignores safe funds');
 perform pg_temp.advance_check((select direction='advance' and amount_cents=0 and record_amount_cents=99999999 from private.cashbook_entries where id=cancel_id),'correction separates claim amount from cash delta');
 change:=jsonb_build_object('action','cancel','id',cancel_id,'requestId',gen_random_uuid(),'confirmed',true,'reason','Irrtümlicher Eintrag','signatureHash',repeat('d',64));
 change:=change||jsonb_build_object('signaturePath',trainer.id::text||'/'||(change->>'requestId')||'/signature');
 result:=public.cashbook_request(trainer.suite_user_id,change);
 perform pg_temp.advance_check(not (result ? 'error') and private.cashbook_balance()=balance_before,'advance cancellation never returns fictitious cash');
 result:=public.cashbook_request(cashier.suite_user_id,transfer||jsonb_build_object('id',cancel_id,'requestId',gen_random_uuid()));perform pg_temp.advance_check(result->>'status'='409','superseded claim cannot transfer');
 -- Regular cash transactions still finish immediately.
 result:=public.cashbook_request(cashier.suite_user_id,'{"action":"list"}');
 perform pg_temp.advance_check(not exists(select 1 from jsonb_array_elements(result->'entries') e where e->>'direction'<>'advance' and not (e->>'superseded')::boolean and e->>'entryType'<>'cancellation' and e->>'status'<>'completed'),'regular entries remain completed');
 perform pg_temp.advance_check((select count(*)=alerts_before+1 from private.cashbook_alerts),'only transfer generated notification');
 perform pg_temp.advance_check(not has_table_privilege('authenticated','private.cashbook_settlement_events','select') and not has_table_privilege('anon','private.cashbook_settlement_events','insert') and not has_table_privilege('service_role','private.cashbook_settlement_events','update'),'settlement audit is private and append-only');
 perform pg_temp.advance_check(not has_function_privilege('anon','public.cashbook_settlement_request(uuid,jsonb)','execute') and not has_function_privilege('authenticated','public.cashbook_settlement_request(uuid,jsonb)','execute'),'settlement RPC unavailable to browser roles');
 -- Even privileged direct updates are blocked by the immutable trigger.
 begin update private.cashbook_settlement_events set actor_name='Fake' where entry_id=target_id;raise exception 'audit update unexpectedly allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
