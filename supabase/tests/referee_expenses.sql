-- Apply both referee migrations in a disposable database first. No fixtures persist.
begin;
insert into auth.users(id,email) values
 ('a0000000-0000-4000-8000-000000000011','expense-test@example.invalid'),
 ('a0000000-0000-4000-8000-000000000012','other-expense-test@example.invalid');
insert into public.social_admins(user_id,email,role,is_active,access_areas) values
 ('a0000000-0000-4000-8000-000000000011','expense-test@example.invalid','referee-admin',true,array['referees']),
 ('a0000000-0000-4000-8000-000000000012','other-expense-test@example.invalid','sm-team',true,array['social_media']);
-- Inactive social-media youth teams still participate in referee administration.
insert into public.social_teams(id,slug,name,competition,active) values
 ('b0000000-0000-4000-8000-000000000011','expense-test-one','D1 Test','Test',false),
 ('b0000000-0000-4000-8000-000000000012','expense-test-two','D2 Test','Test',false);
insert into public.social_people(id,slug,display_name,birth_date) values
 ('c0000000-0000-4000-8000-000000000011','expense-test-coach','Test Coach','1980-01-01'),
 ('c0000000-0000-4000-8000-000000000012','expense-test-coach-two','Test Coach 2','1980-01-01');
insert into public.social_team_people(team_id,person_id,role) values
 ('b0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000011','Trainer'),
 ('b0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000012','Co-Trainer');
insert into public.referee_fee_cases(id,source_match_id,source_url,team_id,home_team,away_team,kickoff_at,game_status,appointment_state,checked_at) values
 ('d0000000-0000-4000-8000-000000000011',repeat('A',32),'https://example.invalid/one','b0000000-0000-4000-8000-000000000011','BSV','Gast',now()-interval '1 day','finished','assigned',now()),
 ('d0000000-0000-4000-8000-000000000012',repeat('B',32),'https://example.invalid/two','b0000000-0000-4000-8000-000000000012','BSV','Gast 2',now()-interval '2 days','finished','assigned',now()),
 ('d0000000-0000-4000-8000-000000000013',repeat('C',32),'https://example.invalid/three','b0000000-0000-4000-8000-000000000011','BSV','Gast 3',now()-interval '3 days','finished','assigned',now());
do $$
declare
 actor uuid:='a0000000-0000-4000-8000-000000000011'; other_actor uuid:='a0000000-0000-4000-8000-000000000012';
 target uuid:='d0000000-0000-4000-8000-000000000011'; claim_id uuid;
 credentials jsonb:='{"personId":"c0000000-0000-4000-8000-000000000011","teamId":"b0000000-0000-4000-8000-000000000011","birthDate":"1980-01-01","action":"expense_list"}';
 submit jsonb; result jsonb; admin_request jsonb; table_name text; role_name text; state text;
begin
 foreach role_name in array array['anon','authenticated'] loop
   foreach table_name in array array['public.referee_fee_cases','public.referee_receipts','public.referee_expenses','private.referee_bank_accounts','private.referee_expense_events','private.referee_payment_orders'] loop
     if has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Browser privilege on %',table_name; end if;
     if not (select relrowsecurity from pg_class where oid=table_name::regclass) then raise exception 'RLS missing on %',table_name; end if;
   end loop;
   if has_function_privilege(role_name,'public.referee_expense_coach_request(jsonb)','EXECUTE') or has_function_privilege(role_name,'public.referee_expense_admin_request(uuid,jsonb)','EXECUTE') then raise exception 'Browser RPC access'; end if;
 end loop;
 if not exists(select 1 from storage.buckets where id='referee-receipts' and not public and file_size_limit=8388608) then raise exception 'Receipt storage not private/bounded'; end if;
 result:=public.referee_expense_coach_request(credentials);
 if jsonb_array_length(result->'cases')<>2 or (result->>'paymentServiceConfigured')::boolean then raise exception 'Wrong cases or configured payment service'; end if;
 result:=public.referee_expense_coach_request(credentials || '{"birthDate":"1981-01-01"}');
 if result->>'status'<>'403' then raise exception 'Wrong birthday accepted'; end if;
 submit:=credentials || jsonb_build_object('action','expense_submit','caseId',target,'amountCents',3820,'ocrAmountCents',3740,'confirmed',true,'receiptPath','fake/receipt.png','receiptSha256',repeat('a',64),'receiptMime','image/png');
 result:=public.referee_expense_coach_request(submit || '{"caseId":"d0000000-0000-4000-8000-000000000012"}');
 if result->>'status'<>'403' then raise exception 'Foreign team accepted'; end if;
 foreach state in array array['scheduled','live','cancelled','postponed','aborted'] loop
   update public.referee_fee_cases set game_status=state where id=target;
   result:=public.referee_expense_coach_request(submit);
   if result->>'status'<>'409' then raise exception 'Non-finished claim accepted: %',state; end if;
 end loop;
 update public.referee_fee_cases set game_status='finished' where id=target;
 foreach state in array array['unknown','missing'] loop
   update public.referee_fee_cases set appointment_state=state where id=target;
   result:=public.referee_expense_coach_request(submit);
   if result->>'status'<>'409' then raise exception 'Unconfirmed appointment accepted'; end if;
 end loop;
 update public.referee_fee_cases set appointment_state='assigned',checked_at=now()-interval '49 hours' where id=target;
 result:=public.referee_expense_coach_request(submit);
 if result->>'status'<>'409' then raise exception 'Stale source accepted'; end if;
 update public.referee_fee_cases set checked_at=now(),kickoff_at=now()+interval '1 day' where id=target;
 result:=public.referee_expense_coach_request(submit);
 if result->>'status'<>'409' then raise exception 'Future claim accepted'; end if;
 update public.referee_fee_cases set kickoff_at=now()-interval '1 day' where id=target;
 result:=public.referee_expense_coach_request(submit || '{"confirmed":false}');
 if result->>'status'<>'400' then raise exception 'Unconfirmed advance accepted'; end if;
 result:=public.referee_expense_coach_request(submit);
 if result ? 'error' then raise exception 'Valid claim failed: %',result; end if;
 select id into claim_id from public.referee_expenses where case_id=target;
 if not exists(select 1 from public.referee_expenses where id=claim_id and amount_cents=3820 and ocr_amount_cents=3740) then raise exception 'Correction lost'; end if;
 result:=public.referee_expense_coach_request(submit);
 if result->>'status'<>'409' then raise exception 'Duplicate claim accepted'; end if;
 result:=public.referee_expense_coach_request(submit || '{"caseId":"d0000000-0000-4000-8000-000000000013"}');
 if result->>'status'<>'409' then raise exception 'Duplicate receipt reused'; end if;
 result:=public.referee_expense_coach_request(credentials || '{"personId":"c0000000-0000-4000-8000-000000000012"}');
 if result::text like '%3820%' or result::text like '%receipt%' or not exists(select 1 from jsonb_array_elements(result->'cases') c where c->>'id'=target::text and (c->>'reserved')::boolean and c->'claim'='null') then raise exception 'Other coach data leaked'; end if;
 admin_request:=jsonb_build_object('action','referee_approve_expense','id',claim_id,'version',1);
 result:=public.referee_expense_admin_request(other_actor,admin_request);
 if not result ? 'error' then raise exception 'Other admin approved'; end if;
 result:=public.referee_expense_admin_request(actor,admin_request);
 if not result ? 'error' then raise exception 'Approved without bank'; end if;
 result:=public.referee_expense_admin_request(actor,admin_request || '{"action":"referee_reject_expense","note":"Bitte Betrag korrigieren"}');
 if result ? 'error' then raise exception 'Reject failed'; end if;
 result:=public.referee_expense_coach_request(submit || '{"personId":"c0000000-0000-4000-8000-000000000012","version":2}');
 if result->>'status'<>'409' then raise exception 'Other payer replaced rejected claim'; end if;
 result:=public.referee_expense_coach_request(submit || '{"version":1}');
 if result->>'status'<>'409' then raise exception 'Stale resubmission accepted'; end if;
 result:=public.referee_expense_coach_request(submit || '{"version":2,"amountCents":3740}');
 if result ? 'error' then raise exception 'Resubmit failed: %',result; end if;
 result:=public.referee_expense_admin_request(actor,'{"action":"referee_import_account","personId":"c0000000-0000-4000-8000-000000000011","encryptedDetails":"test-ciphertext-v1","ibanLast4":"3000","sourceMessageId":"fake-message"}');
 if result ? 'error' then raise exception 'Bank import failed'; end if;
 update public.referee_fee_cases set appointment_state='unknown' where id=target;
 result:=public.referee_expense_admin_request(actor,admin_request || '{"version":3}');
 if not result ? 'error' then raise exception 'Approval accepted changed appointment'; end if;
 update public.referee_fee_cases set appointment_state='assigned' where id=target;
 result:=public.referee_expense_admin_request(actor,admin_request || '{"version":3}');
 if result ? 'error' then raise exception 'Approval failed: %',result; end if;
 result:=public.referee_expense_admin_request(actor,admin_request || '{"version":4}');
 if not result ? 'error' then raise exception 'Double approval accepted'; end if;
 if (select count(*) from private.referee_payment_orders where expense_id=claim_id and status='ready' and amount_cents=3740 and encrypted_destination='test-ciphertext-v1' and paid_at is null)<>1 then raise exception 'Wrong prepared payment'; end if;
 perform public.referee_expense_admin_request(actor,'{"action":"referee_import_account","personId":"c0000000-0000-4000-8000-000000000011","encryptedDetails":"test-ciphertext-v2","ibanLast4":"9999","sourceMessageId":"fake-new-message"}');
 if not exists(select 1 from private.referee_payment_orders where expense_id=claim_id and encrypted_destination='test-ciphertext-v1' and iban_last4='3000' and account_version=1) then raise exception 'Prepared destination changed'; end if;
 result:=public.referee_expense_admin_request(actor,'{"action":"referee_expense_load"}');
 if result::text like '%test-ciphertext%' or not exists(select 1 from jsonb_array_elements(result->'cases') c where c->>'id'=target::text and c->'claim'->>'bankLast4'='3000') then raise exception 'Wrong payment mask or leaked ciphertext'; end if;
 begin
   update public.referee_expenses set amount_cents=999 where id=claim_id;
   raise exception 'Expected immutable approved claim';
 exception when raise_exception then if sqlerrm<>'Freigegebene Erstattungen sind gesperrt.' then raise; end if; end;
 if (select count(*) from private.referee_expense_events where expense_id=claim_id)<>4 then raise exception 'Audit history incomplete'; end if;
 update public.social_teams set referee_enabled=false where id='b0000000-0000-4000-8000-000000000011';
 result:=public.referee_expense_coach_request(credentials);
 if result->>'status'<>'403' then raise exception 'Disabled team accepted'; end if;
 update public.social_teams set referee_enabled=true where id='b0000000-0000-4000-8000-000000000011';
end $$;
set local role service_role;
do $$ begin
 if public.referee_expense_coach_request('{"personId":"c0000000-0000-4000-8000-000000000011","teamId":"b0000000-0000-4000-8000-000000000011","birthDate":"1980-01-01","action":"expense_list"}') ? 'error' then raise exception 'Service role coach access failed'; end if;
 if public.referee_expense_admin_request('a0000000-0000-4000-8000-000000000011','{"action":"referee_expense_load"}') ? 'error' then raise exception 'Service role admin access failed'; end if;
end $$;
rollback;
