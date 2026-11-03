begin;
set local role service_role;
do $test$
declare administrator uuid;ordinary uuid;person uuid:=gen_random_uuid();cid uuid:=gen_random_uuid();r jsonb;entry jsonb;
begin
 select user_id into administrator from public.social_admins where role='admin' and is_active and not is_blocked limit 1;
 select user_id into ordinary from public.social_admins where role<>'admin' and is_active and not is_blocked and not access_areas&&array['trainer_compensation','trainer_contracts']::text[] limit 1;
 if administrator is null or ordinary is null then raise exception 'Test actors missing';end if;
 insert into public.social_people(id,slug,display_name) values(person,'finance-test-'||person,'Finance Test Coach');
 insert into private.trainer_contracts(id,season,person_id,slot,status,snapshot,document_path,document_hash,signed_path,signed_hash)
 values(cid,'2024/2025',person,'trainer','signed',jsonb_build_object('name','Finance Test Coach','teamName','Archived Team','start','2024-07-01','end','2025-06-30','monthlyCents',10000,'paidMonths','[7,9,10,11,1,2,3,4,5,6]'::jsonb,'bank','NEVER-LEAK-BANK','street','NEVER-LEAK-ADDRESS','birthDate','1990-01-01','financialCategory','{"department":"Jugend","age":"C-Jugend"}'::jsonb),cid||'/issued/test.pdf',repeat('a',64),cid||'/signed/test.pdf',repeat('b',64));
 insert into private.trainer_contract_signatures(contract_id,part,request_id,actor,signer_name,place,strokes,values,document_hash,evidence_hash)
 values(cid,'waiver_november',gen_random_uuid(),administrator,'Test Signer','Radolfzell','[[[0.1,0.5],[0.2,0.3],[0.3,0.6],[0.4,0.2],[0.5,0.5]]]',jsonb_build_object('choice','partial','payoutCents',30000,'waivedCents',10000,'due','2024-11-28'),repeat('a',64),repeat('c',64)),
 (cid,'allowance',gen_random_uuid(),administrator,'Test Signer','Radolfzell','[[[0.1,0.5],[0.2,0.3],[0.3,0.6],[0.4,0.2],[0.5,0.5]]]',jsonb_build_object('otherPayments','NEVER-LEAK-TAX-DECLARATION'),repeat('a',64),repeat('d',64));
 r:=public.trainer_finances_request(ordinary,'{"action":"list","season":"2024/2025"}');if r->>'status'<>'403' then raise exception 'Ordinary staff admitted';end if;
 r:=public.trainer_finances_request(administrator,'{"action":"list","season":"2024/2025"}');if r ? 'error' or r->>'canViewDecisions'<>'true' then raise exception 'Admin financial listing failed: %',r->'error';end if;
 select c into entry from jsonb_array_elements(r->'contracts') c where c->>'id'=cid::text;
 if entry is null or entry#>>'{snapshot,monthlyCents}'<>'10000' or jsonb_array_length(entry->'declarations')<>1 or entry#>>'{declarations,0,waivedCents}'<>'10000' then raise exception 'Financial-only snapshot or waiver missing';end if;
 if r::text like '%NEVER-LEAK%' or entry ? 'strokes' or entry ? 'document_path' or entry#>'{snapshot,birthDate}' is not null then raise exception 'Unnecessary private data exposed';end if;
 if not exists(select 1 from jsonb_array_elements(r->'people') p where p->>'id'=person::text and p ? 'photoSource') then raise exception 'Archived contract person or portrait missing';end if;
 update public.social_admins set extra_access_areas=extra_access_areas||'trainer_compensation'::text where user_id=ordinary;
 r:=public.trainer_finances_request(ordinary,'{"action":"list","season":"2024/2025"}');if r ? 'error' or r->>'canViewDecisions'<>'false' or r->'contracts'<>'[]' then raise exception 'Salary-only grant leaks decisions';end if;
 update public.social_admins set extra_access_areas=array_remove(extra_access_areas,'trainer_compensation')||'trainer_contracts'::text where user_id=ordinary;
 r:=public.trainer_finances_request(ordinary,'{"action":"list","season":"2024/2025"}');if r ? 'error' or r->>'canViewDecisions'<>'true' then raise exception 'Contract-only grant denied';end if;
 r:=public.trainer_contract_request(ordinary,jsonb_build_object('action','get','id',cid));if r ? 'error' or not r ? 'photoSource' then raise exception 'Contract portrait source missing';end if;
 update public.social_admins set is_blocked=true where user_id=ordinary;
 r:=public.trainer_finances_request(ordinary,'{"action":"list","season":"2024/2025"}');if r->>'status'<>'403' then raise exception 'Blocked user admitted';end if;
 if has_function_privilege('authenticated','public.trainer_finances_request(uuid,jsonb)','execute') or has_function_privilege('anon','public.trainer_finances_request(uuid,jsonb)','execute') then raise exception 'Financial RPC directly exposed';end if;
end $test$;
rollback;
select 'PASS: financial scope, minimal snapshots, waiver isolation, photos, archived persons, explicit grants, blocked users and service-only execution; fixtures rolled back' as test;
