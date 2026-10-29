begin;
create function pg_temp.check_editorial_people(ok boolean,label text) returns void language plpgsql as $$begin if ok is not true then raise exception 'Editorial people: %',label;end if;end $$;
set local role service_role;
do $$
declare person uuid; youth private.employee_assignments; board private.employee_assignments; entry jsonb; trainer_path text; youth_path text; board_path text;
begin
 select id into person from public.social_people where slug='jerome-ernsberger';
 select * into youth from private.employee_assignments where person_id=person and group_key='youth' and role_label='Jugendleiter';
 select * into board from private.employee_assignments where person_id=person and group_key='board' and role_label='IT & Administration';
 trainer_path:=person::text||'/'||repeat('a',64)||'.png';youth_path:=person::text||'/'||repeat('b',64)||'.png';board_path:=person::text||'/'||repeat('c',64)||'.png';
 update private.trainer_profiles set photo_path=trainer_path where person_id=person;
 insert into private.employee_role_photos(person_id,role_key,photo_path) values(person,'role-'||youth.id::text,youth_path),(person,'role-'||board.id::text,board_path);
 select value into entry from jsonb_array_elements(public.editorial_people_catalog()) where value->>'id'=person::text;
 perform pg_temp.check_editorial_people(entry is not null and entry->'roles' ? 'Jugendleiter','current employee role available');
 perform pg_temp.check_editorial_people(exists(select 1 from jsonb_array_elements(entry->'role_photos') r where r->>'role'='Jugendleiter' and r#>>'{photo_source,path}'=youth_path),'own youth image available');
 perform pg_temp.check_editorial_people(exists(select 1 from jsonb_array_elements(entry->'role_photos') r where r->>'role'='IT & Administration' and r#>>'{photo_source,path}'=board_path),'own other-role image remains distinct');
 perform pg_temp.check_editorial_people(not exists(select 1 from jsonb_array_elements(entry->'teams') t where t#>>'{photo_source,path}' is distinct from trainer_path),'trainer roles retain their own upload');
 perform pg_temp.check_editorial_people(not entry ?| array['email','phone','birth_date','notes','password','street','postcode','suite_user_id'],'no private personnel details');
 update private.employee_assignments set active=false where person_id=person and role_label='Jugendleiter';
 select value into entry from jsonb_array_elements(public.editorial_people_catalog()) where value->>'id'=person::text;
 perform pg_temp.check_editorial_people(not entry->'roles' ? 'Jugendleiter','removed roles do not survive via old social catalog');
 update public.social_people set active=false where id=person;
 perform pg_temp.check_editorial_people(not exists(select 1 from jsonb_array_elements(public.editorial_people_catalog()) p where p->>'id'=person::text),'inactive person excluded');
end $$;
reset role;
select pg_temp.check_editorial_people(not has_function_privilege('anon','public.editorial_people_catalog()','EXECUTE') and not has_function_privilege('authenticated','public.editorial_people_catalog()','EXECUTE'),'catalog restricted to editorial service');
select pg_temp.check_editorial_people((select public from storage.buckets where id='editorial-public-images') and not (select public from storage.buckets where id='employee-portraits') and not (select public from storage.buckets where id='trainer-portraits'),'only mail copies are public');
rollback;
