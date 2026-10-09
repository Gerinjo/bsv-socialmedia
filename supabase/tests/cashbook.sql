-- Run only in the isolated test database via npm run test:cashbook:db.
begin;
create function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$begin if value is distinct from true then raise exception '%',message; end if; end$$;
create function pg_temp.cashbook_as(payload jsonb) returns jsonb language sql as $$
 select public.cashbook_request((payload->>'actor')::uuid,payload-'actor')
$$;
do $$
declare trainer private.cashbook_accounts; cashier private.cashbook_accounts; other private.cashbook_accounts; team uuid; foreign_team uuid;
 result jsonb; book jsonb; deposit jsonb; record_id uuid; count_before bigint; media jsonb;
begin
 select * into trainer from private.cashbook_accounts where username='jentm';
 select * into cashier from private.cashbook_accounts where username='barow';
 select * into other from private.cashbook_accounts where username='schmo';
 select id into team from public.social_teams where slug='u19-junioren';
 select id into foreign_team from public.social_teams where slug='u15-c1-junioren';
 perform pg_temp.assert_true(trainer.id is not null and cashier.role='cashier','Expected club accounts missing');
 perform pg_temp.assert_true(exists(select 1 from private.cashbook_accounts where username='gastc' and role='cashier'),'Claudia cashier missing');
 perform pg_temp.assert_true((select count(*)=15 from private.cashbook_accounts where role='trainer'),'Import must include all D-A coaches and youth leaders, including fitnesscoach');
 perform pg_temp.assert_true(not exists(select 1 from public.social_team_people tp join public.social_teams t on t.id=tp.team_id join public.social_people p on p.id=tp.person_id where t.slug in ('u13-d1-junioren','u13-d2-junioren','u13-d3-junioren') and (tp.role ilike '%trainer%' or tp.role ilike '%coach%') and p.active and not exists(select 1 from private.cashbook_accounts a where a.person_id=p.id)),'A D-youth coach was not imported');
 perform pg_temp.assert_true((select count(*)=7 from private.cashbook_teams where enabled),'D-A team defaults missing');
 perform pg_temp.assert_true(not exists(select 1 from private.cashbook_teams ct join public.social_teams t on t.id=ct.team_id where t.slug like '%juniorinnen%' or t.slug like 'u11%'),'Other age groups or girls teams accidentally enabled');
 perform pg_temp.assert_true(not has_table_privilege('anon','private.cashbook_entries','select') and not has_table_privilege('authenticated','private.cashbook_entries','insert'),'Ledger exposed to browsers');
 perform pg_temp.assert_true(not has_function_privilege('anon','public.cashbook_request(uuid,jsonb)','execute') and not has_function_privilege('authenticated','public.cashbook_admin_request(uuid,jsonb)','execute'),'RPC exposed to browsers');
 perform pg_temp.assert_true((select bool_and(relrowsecurity) from pg_class where relnamespace='private'::regnamespace and relname like 'cashbook_%' and relkind='r'),'RLS missing');
 perform pg_temp.assert_true((select not public from storage.buckets where id='cashbook-evidence'),'Evidence bucket must be private');
 perform pg_temp.assert_true((private.cashbook_import_accounts()->>'added')::int=0,'Import should be idempotent');
 -- Youth leaders also import without a coaching assignment; one person gets one login.
 delete from public.social_team_people where person_id=(select id from public.social_people where slug='jerome-ernsberger');
 delete from private.cashbook_accounts where person_id=(select id from public.social_people where slug='jerome-ernsberger');
 perform pg_temp.assert_true((private.cashbook_import_accounts()->>'added')::int=1,'Youth leader without a team assignment was not imported');
 perform pg_temp.assert_true((select count(*)=1 from private.cashbook_accounts a join public.social_people p on p.id=a.person_id where p.slug='ole-schmal'),'Youth leader and coach got duplicate accounts');
 -- One suite identity; ledger responses never include birthday/password data.
 update private.cashbook_accounts set suite_user_id=person_id where suite_user_id is null;
 result:=pg_temp.cashbook_as(jsonb_build_object('action','list','actor',trainer.suite_user_id));
 perform pg_temp.assert_true(result->'user'->>'id'=trainer.id::text and jsonb_array_length(result->'teams')=1,'Trainer login failed while social publishing is inactive');
 perform pg_temp.assert_true(result::text not like '%1980-01-01%','Birthday leaked');
 perform pg_temp.cashbook_as(jsonb_build_object('action','list','actor',cashier.suite_user_id));
 perform pg_temp.cashbook_as(jsonb_build_object('action','list','actor',other.suite_user_id));
 deposit:=jsonb_build_object('action','book','actor',cashier.suite_user_id,'requestId',gen_random_uuid(),'direction','deposit','amountCents',10000,'confirmed',true,'evidenceHash',repeat('a',64));
 deposit:=deposit||jsonb_build_object('evidencePath',cashier.id::text||'/'||(deposit->>'requestId')||'/photo');
 result:=pg_temp.cashbook_as(deposit);perform pg_temp.assert_true((result->>'balanceCents')::bigint=10000,'Deposit balance incorrect');
 result:=pg_temp.cashbook_as(deposit);perform pg_temp.assert_true((select count(*)=1 from private.cashbook_entries),'Duplicate deposit');
 result:=pg_temp.cashbook_as(deposit||jsonb_build_object('amountCents',10001));perform pg_temp.assert_true(result->>'status'='409','Changed retry must conflict');
 result:=pg_temp.cashbook_as(deposit||jsonb_build_object('actor',trainer.suite_user_id,'requestId',gen_random_uuid()));perform pg_temp.assert_true(result->>'status'='403','Trainer deposited');
 book:=jsonb_build_object('action','book','actor',trainer.suite_user_id,'requestId',gen_random_uuid(),'direction','withdrawal','amountCents',5000,'confirmed',true,'teamId',team,'evidenceHash',repeat('b',64),'signatureHash',repeat('c',64));
 book:=book||jsonb_build_object('evidencePath',trainer.id::text||'/'||(book->>'requestId')||'/photo','signaturePath',trainer.id::text||'/'||(book->>'requestId')||'/signature');
 result:=pg_temp.cashbook_as(book||jsonb_build_object('teamId',foreign_team));perform pg_temp.assert_true(result->>'status'='403','Foreign-team withdrawal');
 result:=pg_temp.cashbook_as(book-'signatureHash');perform pg_temp.assert_true(result->>'status'='400','Unsigned withdrawal');
 result:=pg_temp.cashbook_as(book||jsonb_build_object('amountCents',10001));perform pg_temp.assert_true(result->>'status'='409','Overdraw allowed');
 result:=pg_temp.cashbook_as(book);record_id:=(result->>'entryId')::uuid;perform pg_temp.assert_true((result->>'balanceCents')::bigint=5000,'Withdrawal balance incorrect');
 perform pg_temp.assert_true((select count(*)=0 from private.cashbook_alerts),'50 EUR must not trigger alert');
 perform pg_temp.cashbook_as(book);perform pg_temp.assert_true((select count(*)=2 from private.cashbook_entries),'Duplicate withdrawal');
 result:=pg_temp.cashbook_as(book||jsonb_build_object('requestId',gen_random_uuid()));perform pg_temp.assert_true(result->>'status'='400' or result->>'status'='409','Invalid path or duplicate receipt allowed');
 -- New withdrawal of one cent crosses the threshold.
 book:=book||jsonb_build_object('requestId',gen_random_uuid(),'amountCents',1,'evidenceHash',repeat('e',64));
 book:=book||jsonb_build_object('evidencePath',trainer.id::text||'/'||(book->>'requestId')||'/photo','signaturePath',trainer.id::text||'/'||(book->>'requestId')||'/signature');
 result:=pg_temp.cashbook_as(book);perform pg_temp.assert_true((result->>'balanceCents')::bigint=4999,'Cent precision lost');
 perform pg_temp.assert_true((select count(*)=1 from private.cashbook_alerts where recipient='jugendkasse@bsvnordstern.de'),'Threshold must queue Wiebke reminder');
 book:=book||jsonb_build_object('requestId',gen_random_uuid(),'evidenceHash',repeat('f',64));
 book:=book||jsonb_build_object('evidencePath',trainer.id::text||'/'||(book->>'requestId')||'/photo','signaturePath',trainer.id::text||'/'||(book->>'requestId')||'/signature');
 perform pg_temp.cashbook_as(book);perform pg_temp.assert_true((select count(*)=1 from private.cashbook_alerts),'Repeated low stock reminder');
 media:=pg_temp.cashbook_as(jsonb_build_object('action','media','actor',other.suite_user_id,'id',record_id));perform pg_temp.assert_true(media->>'status'='403','Another trainer can read private receipt');
 media:=pg_temp.cashbook_as(jsonb_build_object('action','media','actor',cashier.suite_user_id,'id',record_id));perform pg_temp.assert_true(media->>'signaturePath' is not null,'Cashier cannot audit receipt and signature');
 -- Restocking rearms, and another drop below the threshold creates a new episode.
 deposit:=deposit||jsonb_build_object('requestId',gen_random_uuid(),'amountCents',10000,'evidenceHash',repeat('9',64));
 deposit:=deposit||jsonb_build_object('evidencePath',cashier.id::text||'/'||(deposit->>'requestId')||'/photo');
 perform pg_temp.cashbook_as(deposit);
 book:=book||jsonb_build_object('requestId',gen_random_uuid(),'amountCents',10000,'evidenceHash',repeat('8',64));
 book:=book||jsonb_build_object('evidencePath',trainer.id::text||'/'||(book->>'requestId')||'/photo','signaturePath',trainer.id::text||'/'||(book->>'requestId')||'/signature');
 perform pg_temp.cashbook_as(book);perform pg_temp.assert_true((select count(*)=2 from private.cashbook_alerts),'Restock must rearm low-stock reminder');
 -- Snapshots and server timestamps are immutable, even when the roster changes.
 update public.social_people set display_name='Changed name' where id=trainer.person_id;
 perform pg_temp.assert_true((select person_name='Michael Jentsch' and created_at>now()-interval '1 minute' from private.cashbook_entries where id=record_id),'Snapshot or timestamp incorrect');
 begin update private.cashbook_entries set amount_cents=1 where id=record_id;raise exception 'Expected immutability error';exception when raise_exception then if sqlerrm='Expected immutability error' then raise;end if;end;
 begin delete from private.cashbook_entries where id=record_id;raise exception 'Expected immutability error';exception when raise_exception then if sqlerrm='Expected immutability error' then raise;end if;end;
 update private.cashbook_teams set enabled=false where team_id=team;
 result:=pg_temp.cashbook_as(jsonb_build_object('action','list','actor',trainer.suite_user_id));perform pg_temp.assert_true(result->>'status'='403','Disabled team retained access');
 update private.cashbook_teams set enabled=true where team_id=team;
 update private.cashbook_accounts set active=false where id=trainer.id;
 result:=pg_temp.cashbook_as(jsonb_build_object('action','list','actor',trainer.suite_user_id));perform pg_temp.assert_true(result->>'status'='403','Disabled account retained access');
 update private.cashbook_accounts set active=true where id=trainer.id;
 -- Revocation of the suite area and suite account is checked immediately.
 update public.social_admins set access_areas=array['editorial']::text[] where user_id=trainer.suite_user_id;
 result:=pg_temp.cashbook_as(jsonb_build_object('action','list','actor',trainer.suite_user_id));
 perform pg_temp.assert_true(result->>'status'='403','Removed suite area retained cash access');
 update public.social_admins set access_areas=array['cashbook']::text[],is_active=false where user_id=trainer.suite_user_id;
 result:=pg_temp.cashbook_as(jsonb_build_object('action','list','actor',trainer.suite_user_id));
 perform pg_temp.assert_true(result->>'status'='403','Blocked suite user retained cash access');
 update public.social_admins set is_active=true where user_id=trainer.suite_user_id;
 for count_before in 1..5 loop
  result:=public.suite_cashbook_login(jsonb_build_object('action','attempt','username','jentm'));
  perform pg_temp.assert_true(result->>'email'='jentm@example.test','Alias did not resolve suite identity');
 end loop;
 result:=public.suite_cashbook_login(jsonb_build_object('action','attempt','username','jentm'));
 perform pg_temp.assert_true(result->>'status'='429','Alias throttling missing');
 update private.cashbook_accounts set window_started_at=now()-interval '16 minutes' where id=trainer.id;
 result:=public.suite_cashbook_login(jsonb_build_object('action','attempt','username','jentm'));
 perform pg_temp.assert_true(result->>'error' is null,'Alias throttle did not expire');
 result:=public.cashbook_admin_request(trainer.suite_user_id,jsonb_build_object('action','cashbook_load'));
 perform pg_temp.assert_true(result->>'status'='403','Trainer got administrator privileges');
 -- A superadmin without a cash profile has read-only access and cannot book.
 insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000001','admin@example.test');
 insert into public.social_admins(user_id,email,role,is_active) values('00000000-0000-4000-8000-000000000001','admin@example.test','admin',true);
 result:=public.cashbook_request('00000000-0000-4000-8000-000000000001','{"action":"list"}');
 perform pg_temp.assert_true(result->>'canBook'='false' and result->>'canExport'='true','Unassigned admin should audit without booking');
 result:=public.cashbook_request('00000000-0000-4000-8000-000000000001',deposit-'actor');
 perform pg_temp.assert_true(result->>'status'='403','Unassigned admin booked money');

 -- Linking an existing suite user preserves their other rights and keeps one profile per identity.
 insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000002','existing@example.test');
 insert into public.social_admins(user_id,email,role,is_active,access_areas)
  values('00000000-0000-4000-8000-000000000002','existing@example.test','sm-team',true,array['editorial']::text[]);
 result:=public.cashbook_request('00000000-0000-4000-8000-000000000002','{"action":"list"}');
 perform pg_temp.assert_true(result->>'status'='403','User without cashbook area read the balance');
 update public.social_admins set access_areas=array['cashbook','editorial']::text[] where user_id='00000000-0000-4000-8000-000000000002';
 result:=public.cashbook_request('00000000-0000-4000-8000-000000000002','{"action":"list"}');
 perform pg_temp.assert_true(result->>'canBook'='false' and result->>'canExport'='false','Unlinked cashbook-area user must have read-only access');
 result:=public.cashbook_request('00000000-0000-4000-8000-000000000002',jsonb_build_object('action','media','id',record_id));
 perform pg_temp.assert_true(result->>'status'='403','Unlinked read-only user opened a private receipt');
 result:=public.cashbook_admin_request('00000000-0000-4000-8000-000000000001',jsonb_build_object('action','cashbook_account','personId',trainer.person_id,'username',trainer.username,'role','trainer','active',true,'suiteUserId','00000000-0000-4000-8000-000000000002'));
 perform pg_temp.assert_true(result->>'error' is null,'Cannot link an existing suite user');
 perform pg_temp.assert_true((select access_areas @> array['editorial','cashbook']::text[] from public.social_admins where user_id='00000000-0000-4000-8000-000000000002'),'Linking removed existing suite rights');
 result:=public.cashbook_request(trainer.suite_user_id,'{"action":"list"}');
 perform pg_temp.assert_true(result->>'canBook'='false','Previous suite identity retained booking privileges after relinking');
 result:=public.cashbook_request('00000000-0000-4000-8000-000000000002','{"action":"list"}');
 perform pg_temp.assert_true(result->>'canBook'='true','Linked user did not gain the profile role');
 result:=public.cashbook_admin_request('00000000-0000-4000-8000-000000000001',jsonb_build_object('action','cashbook_account','personId',other.person_id,'username',other.username,'role','trainer','active',true,'suiteUserId','00000000-0000-4000-8000-000000000002'));
 perform pg_temp.assert_true(result->>'status'='409','Two people share a suite identity');
 perform pg_temp.assert_true((select suite_user_id=other.suite_user_id from private.cashbook_accounts where id=other.id),'Failed linking mutated the previous profile');
 perform pg_temp.assert_true(not has_function_privilege('authenticated','public.suite_cashbook_login(jsonb)','execute'),'Browser can bypass alias throttling');

end $$;
do $$
declare leader private.cashbook_accounts; dcoach private.cashbook_accounts; team uuid; result jsonb; booking jsonb;
begin
 select a.* into leader from private.cashbook_accounts a join public.social_people p on p.id=a.person_id where p.slug='jerome-ernsberger';
 select a.* into dcoach from private.cashbook_accounts a join public.social_people p on p.id=a.person_id where p.slug='stephan-hellmann';
 select id into team from public.social_teams where slug='u13-d1-junioren';
 result:=pg_temp.cashbook_as(jsonb_build_object('action','list','actor',leader.suite_user_id));
 perform pg_temp.assert_true(result->'user'->>'isYouthLeader'='true' and jsonb_array_length(result->'teams')=7,'Youth leader needs all enabled D-A teams without coaching assignment');
 result:=pg_temp.cashbook_as(jsonb_build_object('action','list','actor',dcoach.suite_user_id));
 perform pg_temp.assert_true(result->'user'->>'isYouthLeader'='false' and jsonb_array_length(result->'teams')=1 and result->'teams'->0->>'id'=team::text,'D coach needs their own team only');
 booking:=jsonb_build_object('action','book','actor',leader.suite_user_id,'requestId',gen_random_uuid(),'direction','withdrawal','amountCents',1,'confirmed',true,'teamId',team,'evidenceHash',repeat('5',64),'signatureHash',repeat('5',64));
 booking:=booking||jsonb_build_object('evidencePath',leader.id::text||'/'||(booking->>'requestId')||'/photo','signaturePath',leader.id::text||'/'||(booking->>'requestId')||'/signature');
 result:=pg_temp.cashbook_as(booking);
 perform pg_temp.assert_true(result->>'error' is null,'Youth leader cannot withdraw for a D team');
 perform pg_temp.assert_true(exists(select 1 from private.cashbook_entries where id=(result->>'entryId')::uuid and person_name='Jérôme Ernsberger' and team_id=team),'Youth leader withdrawal must retain person and responsible team');
 booking:=booking||jsonb_build_object('actor',dcoach.suite_user_id,'requestId',gen_random_uuid(),'evidenceHash',repeat('6',64),'signatureHash',repeat('6',64));
 booking:=booking||jsonb_build_object('evidencePath',dcoach.id::text||'/'||(booking->>'requestId')||'/photo','signaturePath',dcoach.id::text||'/'||(booking->>'requestId')||'/signature');
 result:=pg_temp.cashbook_as(booking);perform pg_temp.assert_true(result->>'error' is null,'D coach cannot withdraw for their own team');
 result:=pg_temp.cashbook_as(booking||jsonb_build_object('teamId',(select id from public.social_teams where slug='u13-d2-junioren')));perform pg_temp.assert_true(result->>'status'='403','D coach can withdraw for another D team');
 update private.referee_club_roles set active=false where person_id=leader.person_id;
 result:=pg_temp.cashbook_as(jsonb_build_object('action','list','actor',leader.suite_user_id));perform pg_temp.assert_true(result->>'status'='403','Revoked youth leadership retained cross-team session access');
 result:=pg_temp.cashbook_as(jsonb_build_object('action','list','actor',leader.suite_user_id));perform pg_temp.assert_true(result->>'status'='403','Revoked youth leader without a coaching assignment can log in');
 update private.referee_club_roles set active=true where person_id=leader.person_id;
 result:=pg_temp.cashbook_as(jsonb_build_object('action','list','actor',leader.suite_user_id));perform pg_temp.assert_true(jsonb_array_length(result->'teams')=7,'Restored youth leader did not regain enabled teams');
 insert into public.social_teams(slug,name) values('cashbook-test-new-youth','New enabled youth team') returning id into team;
 insert into private.cashbook_teams(team_id) values(team);
 result:=pg_temp.cashbook_as(jsonb_build_object('action','list','actor',leader.suite_user_id));perform pg_temp.assert_true(jsonb_array_length(result->'teams')=8,'New enabled team is missing for youth leaders');
 update private.cashbook_teams set enabled=false where team_id=team;
 result:=pg_temp.cashbook_as(jsonb_build_object('action','list','actor',leader.suite_user_id));perform pg_temp.assert_true(jsonb_array_length(result->'teams')=7,'Youth leader kept disabled team');
end $$;
-- Service role can invoke the RPC and read permitted state without bypass tricks.
set local role service_role;
select pg_temp.assert_true(private.cashbook_balance()>=0,'Service-role access failed');
select pg_temp.assert_true(not has_table_privilege('service_role','auth.users','select'),'Fixture must match hosted Auth table permissions');
select pg_temp.assert_true(public.suite_cashbook_login('{"action":"attempt","username":"barow"}')->>'email'='barow@example.test','Alias lookup must work without Auth table access');
reset role;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000003','new@example.test');
set local role service_role;
do $$
declare cashier private.cashbook_accounts; result jsonb;
begin
 select * into cashier from private.cashbook_accounts where username='barow';
 update private.cashbook_accounts set suite_user_id=null where id=cashier.id;
 result:=public.cashbook_admin_request('00000000-0000-4000-8000-000000000001',jsonb_build_object('action','cashbook_bind','personId',cashier.person_id,'userId',cashier.suite_user_id));
 perform pg_temp.assert_true(result->>'error' is null,'Binding an existing member requires no Auth SELECT');
 update private.cashbook_accounts set suite_user_id=null where id=cashier.id;
 result:=public.cashbook_admin_request('00000000-0000-4000-8000-000000000001',jsonb_build_object('action','cashbook_bind','personId',cashier.person_id,'userId','00000000-0000-4000-8000-000000000003','email','new@example.test'));
 perform pg_temp.assert_true(result->>'error' is null,'Binding a new Auth user requires no Auth SELECT');
 perform pg_temp.assert_true((select access_areas=array['cashbook']::text[] from public.social_admins where user_id='00000000-0000-4000-8000-000000000003'),'New user received unintended Suite rights');
 perform pg_temp.assert_true(public.suite_cashbook_login('{"action":"attempt","username":"barow"}')->>'email'='new@example.test','New member alias did not resolve');
end $$;
reset role;
rollback;
