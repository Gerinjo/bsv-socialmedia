-- Run against a disposable database after migrations. Always rolled back.
begin;
do $$
declare issue public.editorial_issues; article public.editorial_articles; before_count integer;
begin
  if has_table_privilege('anon','public.editorial_articles','SELECT') or has_table_privilege('authenticated','public.editorial_articles','UPDATE') then raise exception 'Editorial data exposed to client roles'; end if;
  if has_function_privilege('authenticated','public.create_editorial_issue(jsonb,jsonb,uuid)','EXECUTE') then raise exception 'Creation RPC exposed'; end if;
  if exists(select 1 from pg_class where oid in ('public.editorial_issues'::regclass,'public.editorial_articles'::regclass,'public.editorial_article_revisions'::regclass) and not relrowsecurity) then raise exception 'RLS missing'; end if;
  select * into issue from public.create_editorial_issue('{"title":"Test","kind":"stadium","starts_on":"2026-09-20","closes_on":"2026-09-24","publishes_on":"2026-09-27"}', '[{"title":"Vorstand","kind":"board","template_key":"board","position":0}]', '00000000-0000-0000-0000-000000000001');
  select * into article from public.editorial_articles where issue_id=issue.id;
  if article.title <> 'Vorstand' or article.version <> 1 then raise exception 'Template not initialized'; end if;
  update public.editorial_articles set body='korrigiert',original_body='orginal' where id=article.id and version=1;
  update public.editorial_articles set body='stale overwrite' where id=article.id and version=1;
  if found then raise exception 'Stale write was accepted'; end if;
  if (select count(*) from public.editorial_article_revisions where article_id=article.id) <> 2 then raise exception 'Revision missing'; end if;
  if (select body from public.editorial_articles where id=article.id) <> 'korrigiert' then raise exception 'Correction lost'; end if;
  if (select snapshot->>'original_body' from public.editorial_article_revisions where article_id=article.id and version=2) <> 'orginal' then raise exception 'Original lost'; end if;
  select count(*) into before_count from public.editorial_issues;
  begin
    perform public.create_editorial_issue('{"title":"Atomic","kind":"stadium","starts_on":"2026-09-20","closes_on":"2026-09-24","publishes_on":"2026-09-27"}', '[{"title":"Bad team","kind":"coach","template_key":"coach","team_id":"00000000-0000-0000-0000-000000000999","position":0}]', '00000000-0000-0000-0000-000000000001');
    raise exception 'Invalid foreign key accepted';
  exception when foreign_key_violation then null; end;
  if (select count(*) from public.editorial_issues) <> before_count then raise exception 'Issue creation was not atomic'; end if;
  begin
    update public.editorial_issues set closes_on='2026-09-01' where id=issue.id;
    raise exception 'Invalid dates accepted';
  exception when check_violation then null; end;
end $$;
-- The API role needs to execute both the transaction and audit triggers.
set local role service_role;
select title from public.create_editorial_issue('{"title":"API role test","kind":"newsletter","starts_on":"2026-09-20","closes_on":"2026-09-24","publishes_on":"2026-09-27"}', '[{"title":"API article","kind":"free","position":0}]', '00000000-0000-0000-0000-000000000001');
rollback;
