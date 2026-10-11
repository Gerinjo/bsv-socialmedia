-- Runs only in the isolated PostgreSQL test database. Every change rolls back.
begin;
create function pg_temp.youth_check(ok boolean,description text) returns void language plpgsql as $$begin if ok is not true then raise exception 'Youth deposit test: %',description;end if;end $$;
set local role service_role;
do $$
declare youth private.cashbook_accounts; trainer private.cashbook_accounts; cashier private.cashbook_accounts;
 result jsonb; payload jsonb; request_id uuid:=gen_random_uuid(); entry_id uuid; balance_before bigint; count_before bigint; team uuid;
begin
 select * into youth from private.cashbook_accounts where username='schmo';
 select * into trainer from private.cashbook_accounts where username='jentm';
 select * into cashier from private.cashbook_accounts where username='barow';
 balance_before:=private.cashbook_balance();select count(*) into count_before from private.cashbook_entries;
 result:=public.cashbook_request(youth.suite_user_id,'{"action":"authorize"}');
 perform pg_temp.youth_check((result->>'canDeposit')::boolean and (result->>'canWithdraw')::boolean,'youth leadership can deposit and withdraw');
 result:=public.cashbook_request(trainer.suite_user_id,'{"action":"authorize"}');
 perform pg_temp.youth_check(not (result->>'canDeposit')::boolean and (result->>'canWithdraw')::boolean,'trainer remains withdrawal only');
 result:=public.cashbook_request(cashier.suite_user_id,'{"action":"authorize"}');
 perform pg_temp.youth_check((result->>'canDeposit')::boolean and not (result->>'canWithdraw')::boolean,'cashier remains deposit only');
 payload:=jsonb_build_object('action','book','requestId',request_id,'direction','deposit','amountCents',2500,'confirmed',true,
  'evidencePath',youth.id::text||'/'||request_id::text||'/photo','evidenceHash',repeat('a',64),'note','Jugendleitung: Safe aufgefüllt');
 result:=public.cashbook_request(youth.suite_user_id,payload);entry_id:=(result->>'entryId')::uuid;
 perform pg_temp.youth_check((result->>'balanceCents')::bigint=balance_before+2500,'deposit updates balance exactly');
 perform pg_temp.youth_check(exists(select 1 from private.cashbook_entries where id=entry_id and created_by_user_id=youth.suite_user_id and account_id=youth.id and direction='deposit' and team_id is null and signature_path is null and created_at>=now()-interval '1 minute'),'deposit attribution, timestamp and evidence recorded');
 perform pg_temp.youth_check(exists(select 1 from jsonb_array_elements(result->'entries') e where e->>'id'=entry_id::text and not (e->>'canManage')::boolean and (e->>'canViewEvidence')::boolean),'deposit stays immutable and its own photo is visible');
 perform public.cashbook_request(youth.suite_user_id,payload);
 perform pg_temp.youth_check((select count(*)=count_before+1 from private.cashbook_entries),'retry does not duplicate deposit');
 result:=public.cashbook_request(youth.suite_user_id,payload||'{"amountCents":2501}');
 perform pg_temp.youth_check(result->>'status'='409','changed retry rejected');
 result:=public.cashbook_request(youth.suite_user_id,jsonb_build_object('action','authorize_change','id',entry_id,'requestId',gen_random_uuid(),'changeAction','cancel'));
 perform pg_temp.youth_check(result->>'status'='403','deposit cannot be canceled through withdrawal editing');
 result:=public.cashbook_request(trainer.suite_user_id,payload||jsonb_build_object('requestId',gen_random_uuid(),'isYouthLeader',true,'canDeposit',true));
 perform pg_temp.youth_check(result->>'status'='403','client cannot grant itself deposit rights');
 -- A youth leader can still pay a referee with team, photo and signature.
 result:=public.cashbook_request(youth.suite_user_id,'{"action":"authorize"}');team:=(result->'teams'->0->>'id')::uuid;request_id:=gen_random_uuid();
 result:=public.cashbook_request(youth.suite_user_id,jsonb_build_object('action','book','requestId',request_id,'direction','withdrawal','amountCents',100,'teamId',team,'confirmed',true,
  'evidencePath',youth.id::text||'/'||request_id::text||'/receipt','evidenceHash',md5(request_id::text)||md5(request_id::text),
  'signaturePath',youth.id::text||'/'||request_id::text||'/signature','signatureHash',repeat('b',64)));
 perform pg_temp.youth_check(not (result ? 'error') and (result->>'balanceCents')::bigint=balance_before+2400,'withdrawal remains available');
 -- Role grants are taken from the server, even without a club leadership record or teams.
 update public.social_admins set suite_role_key='youth-leadership' where user_id=trainer.suite_user_id;
 delete from public.social_team_people where person_id=trainer.person_id;
 result:=public.cashbook_request(trainer.suite_user_id,'{"action":"authorize"}');
 perform pg_temp.youth_check((result->>'canDeposit')::boolean and not (result->>'canWithdraw')::boolean,'Suite youth role can restock without team assignment');
 update public.social_admins set suite_role_key='trainer' where user_id=trainer.suite_user_id;
 result:=public.cashbook_request(trainer.suite_user_id,'{"action":"authorize"}');
 perform pg_temp.youth_check(result->>'status'='403','role removal takes effect immediately');
 update public.social_admins set is_blocked=true where user_id=youth.suite_user_id;
 result:=public.cashbook_request(youth.suite_user_id,'{"action":"authorize"}');
 perform pg_temp.youth_check(result->>'status'='403','blocked user cannot restock');
 update public.social_admins set is_blocked=false,suite_role_key='user',extra_access_areas='{}',access_areas='{}' where user_id=youth.suite_user_id;
 result:=public.cashbook_request(youth.suite_user_id,'{"action":"authorize"}');
 perform pg_temp.youth_check(result->>'status'='403','cashbook access remains mandatory');
 perform pg_temp.youth_check(not has_function_privilege('anon','public.cashbook_request(uuid,jsonb)','execute') and not has_function_privilege('authenticated','public.cashbook_request(uuid,jsonb)','execute'),'browser RPC stays closed');
end $$;
rollback;
