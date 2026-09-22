begin;
do $$
declare i public.editorial_issues; aid uuid; revision integer; settings jsonb; frozen jsonb;
begin
  if has_table_privilege('authenticated','public.editorial_issues','UPDATE') or has_function_privilege('anon','private.editorial_snapshot(uuid)','EXECUTE') then raise exception 'Unprivileged access allowed'; end if;
  if not (select relrowsecurity from pg_class where oid='public.editorial_issues'::regclass) then raise exception 'Issue RLS missing'; end if;
  select * into i from public.create_editorial_issue('{"title":"Cover settings test","kind":"stadium","starts_on":"2026-09-20","closes_on":"2026-09-24","publishes_on":"2026-09-27"}',
    '[{"title":"Fest","kind":"free","position":1000}]','00000000-0000-0000-0000-000000000001');
  if i.cover_settings is not null then raise exception 'Existing defaults must remain automatic'; end if;
  select id into aid from public.editorial_articles where issue_id=i.id;
  update public.editorial_articles set body='Bericht' where id=aid;
  update public.editorial_articles set status='ready',approved_at=now() where id=aid;
  settings:=jsonb_build_object('showNumber',true,'number','07','showNamePart1',true,'namePart1','VEREINS','showNamePart2',true,'namePart2','leben','showHeadline',true,'headline','Willkommen','showDate',false,'teamSlugs','[]'::jsonb,'articles',jsonb_build_array(jsonb_build_object('id',aid,'alias','Das Vereinsfest')));
  update public.editorial_issues set cover_path='test/cover.jpg',advertising='{"issueDate":"2026-09-27","ads":[]}',cover_settings=settings where id=i.id;
  select version into revision from public.editorial_issues where id=i.id;
  frozen:=public.preview_editorial_issue(i.id,revision);
  if frozen->'cover_settings' is distinct from settings then raise exception 'Cover settings missing from preview'; end if;
  perform public.publish_editorial_issue(i.id,revision,'00000000-0000-0000-0000-000000000001');
  update public.editorial_issues set cover_alt='Neue Bildbeschreibung',cover_credit='Foto: Verein' where id=i.id;
  if (select cover_path from public.editorial_issues where id=i.id)<>'test/cover.jpg' then raise exception 'Metadata edit changed image'; end if;
  if (select version<=revision or version=previewed_version from public.editorial_issues where id=i.id) then raise exception 'Metadata edit did not invalidate preview'; end if;
  if (select snapshot->>'cover_alt' from public.editorial_publications where issue_id=i.id) is distinct from (frozen->>'cover_alt') then raise exception 'Published description changed'; end if;
  update public.editorial_issues set cover_settings=jsonb_set(settings,'{number}','"08"') where id=i.id;
  if (select version<=revision or version=previewed_version from public.editorial_issues where id=i.id) then raise exception 'Cover edit did not invalidate preview'; end if;
  if (select snapshot->'cover_settings' from public.editorial_publications where issue_id=i.id) is distinct from settings then raise exception 'Published cover mutated'; end if;
  delete from public.editorial_articles where id=aid;
  if jsonb_array_length(private.editorial_snapshot(i.id)#>'{cover_settings,articles}')<>0 then raise exception 'Deleted cover alias exposed'; end if;
  begin
    update public.editorial_issues set cover_settings='[]' where id=i.id;
    raise exception using errcode='XX000',message='Invalid settings accepted';
  exception when check_violation then null; end;
end $$;
rollback;
