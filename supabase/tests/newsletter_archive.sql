begin;
set local role service_role;
do $$
declare i public.editorial_issues; stadium public.editorial_issues; aid uuid; n integer;
begin
  select * into i from public.create_editorial_issue('{"title":"Newsletter archive test","kind":"newsletter","starts_on":"2026-10-30","closes_on":"2026-11-04","publishes_on":"2026-11-06"}',
    '[{"title":"Vereinsleben","kind":"free","position":0}]','00000000-0000-0000-0000-000000000001');
  select id into aid from public.editorial_articles where issue_id=i.id;
  select version into n from public.editorial_issues where id=i.id;
  begin
    perform public.manage_editorial_newsletter(i.id,n,'complete');
    raise exception 'ASSERT: unfinished newsletter completed';
  exception when others then if sqlerrm like 'ASSERT:%' then raise; end if; end;
  update public.editorial_articles set body='Testbeitrag' where id=aid;
  update public.editorial_articles set status='ready',approved_at=now() where id=aid;
  select version into n from public.editorial_issues where id=i.id;
  begin
    perform public.manage_editorial_newsletter(i.id,n,'complete');
    raise exception 'ASSERT: unreviewed newsletter completed';
  exception when others then if sqlerrm like 'ASSERT:%' then raise; end if; end;
  perform public.preview_editorial_issue(i.id,n);
  perform public.manage_editorial_newsletter(i.id,n,'complete');
  if not exists(select 1 from public.editorial_issues where id=i.id and published_at is not null and published_version=version) then raise exception 'ASSERT: newsletter not archived'; end if;
  begin
    perform public.manage_editorial_newsletter(i.id,n-1,'delete');
    raise exception 'ASSERT: stale deletion accepted';
  exception when others then if sqlerrm like 'ASSERT:%' then raise; end if; end;
  -- Legacy newsletter snapshots must not block deleting the issue.
  insert into public.editorial_publications(issue_id,issue_version,snapshot,published_by) values(i.id,n,'{}','00000000-0000-0000-0000-000000000001');
  perform public.manage_editorial_newsletter(i.id,n,'delete');
  if exists(select 1 from public.editorial_issues where id=i.id)
    or exists(select 1 from public.editorial_articles where issue_id=i.id)
    or exists(select 1 from public.editorial_article_revisions where article_id=aid)
    or exists(select 1 from public.editorial_publications where issue_id=i.id) then raise exception 'ASSERT: newsletter data retained'; end if;
  select * into stadium from public.create_editorial_issue('{"title":"Protected stadium test","kind":"stadium","starts_on":"2026-10-30","closes_on":"2026-11-04","publishes_on":"2026-11-06"}','[]','00000000-0000-0000-0000-000000000001');
  begin
    perform public.manage_editorial_newsletter(stadium.id,stadium.version,'delete');
    raise exception 'ASSERT: stadium deletion accepted';
  exception when others then if sqlerrm like 'ASSERT:%' then raise; end if; end;
  if has_function_privilege('anon','public.manage_editorial_newsletter(uuid,integer,text)','execute')
    or has_function_privilege('authenticated','public.manage_editorial_newsletter(uuid,integer,text)','execute') then raise exception 'ASSERT: client can mutate newsletter directly'; end if;
end $$;
rollback;
