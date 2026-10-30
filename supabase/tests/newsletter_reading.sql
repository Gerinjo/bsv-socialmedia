begin;
set local role service_role;
do $$
declare i public.editorial_issues; source public.editorial_issues; aid uuid; n integer; frozen jsonb;
begin
 select * into source from public.create_editorial_issue('{"title":"Source edition","kind":"stadium","starts_on":"2026-10-30","closes_on":"2026-11-04","publishes_on":"2026-11-06"}','[]','00000000-0000-0000-0000-000000000001');
 insert into public.editorial_publications(issue_id,issue_version,snapshot,published_by) values(source.id,1,
  '{"kind":"stadium","articles":[{"id":"imported","body":"The entire original article beyond the teaser.","status":"ready"}]}','00000000-0000-0000-0000-000000000001');
 select * into i from public.create_editorial_issue('{"title":"Reading test","kind":"newsletter","starts_on":"2026-10-30","closes_on":"2026-11-04","publishes_on":"2026-11-06"}',
  '[{"title":"Own article","kind":"free","position":0}]','00000000-0000-0000-0000-000000000001');
 select id into aid from public.editorial_articles where issue_id=i.id;
 update public.editorial_articles set body='Full original text' where id=aid;
 update public.editorial_articles set status='ready' where id=aid;
 update public.editorial_issues set newsletter_selection=jsonb_build_object('issue_id',source.id,'issue_version',1,'articles','[{"id":"imported","title":"Imported article","excerpt":"Teaser"}]'::jsonb) where id=i.id;
 select version into n from public.editorial_issues where id=i.id;
 perform public.preview_editorial_issue(i.id,n);
 if exists(select 1 from public.editorial_publications where issue_id=i.id) then raise exception 'ASSERT: draft became public';end if;
 perform public.manage_editorial_newsletter(i.id,n,'complete');
 select snapshot into frozen from public.editorial_publications where issue_id=i.id and issue_version=n;
 if frozen#>>'{articles,0,body}'<>'Full original text' or frozen#>>'{newsletter_selection,articles,0,body}'<>'The entire original article beyond the teaser.' then raise exception 'ASSERT: full text missing';end if;
 perform public.manage_editorial_newsletter(i.id,n,'complete');
 if (select count(*) from public.editorial_publications where issue_id=i.id)<>1 then raise exception 'ASSERT: duplicate edition';end if;
 update public.editorial_articles set body='Unpublished revision' where id=aid;
 if (select snapshot from public.editorial_publications where issue_id=i.id and issue_version=n) is distinct from frozen then raise exception 'ASSERT: publication changed after edit';end if;
 if has_table_privilege('anon','public.editorial_publications','select') or has_table_privilege('authenticated','public.editorial_publications','insert') then raise exception 'ASSERT: direct publication access';end if;
end $$;
rollback;
