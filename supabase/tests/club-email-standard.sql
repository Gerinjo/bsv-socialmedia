begin;
set local role service_role;
do $test$
declare a jsonb:='[{"id":"test-a","name":"Test Sponsor","website":"https://example.test","logo":"https://bsvnordstern.de/images/sponsors/test.png","width":112,"height":64}]';b jsonb;blocked boolean:=false;
begin
 b:=public.email_sponsor_snapshot(repeat('a',64),a);if b<>a then raise exception 'First selection not preserved';end if;
 b:=public.email_sponsor_snapshot(repeat('a',64),'[]');if b<>a then raise exception 'Cold retry changed the selected partners';end if;
 b:=public.email_sponsor_snapshot(repeat('b',64),'[]');b:=public.email_sponsor_snapshot(repeat('b',64),a);if b<>'[]' then raise exception 'Empty preparation was not frozen';end if;
 begin perform public.email_sponsor_snapshot(repeat('c',64),jsonb_set(a,'{0,bank}','"must-not-be-stored"'));exception when others then blocked:=true;end;
 if not blocked then raise exception 'Private field accepted';end if;
 if has_function_privilege('anon','public.email_sponsor_snapshot(text,jsonb)','execute') or has_function_privilege('authenticated','public.email_sponsor_snapshot(text,jsonb)','execute') or has_table_privilege('authenticated','private.email_sponsor_snapshots','select') then raise exception 'Client cache access granted';end if;
end $test$;
rollback;
select 'PASS: public-only immutable sponsor snapshots, cold retries, empty selections and service-only access; fixtures rolled back' as test;
