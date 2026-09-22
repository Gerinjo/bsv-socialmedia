begin;
do $$
declare i public.editorial_issues; aid uuid; snapshot jsonb; revision integer;
begin
  if has_table_privilege('authenticated','public.editorial_publications','SELECT') or has_table_privilege('service_role','public.editorial_publications','UPDATE') then raise exception 'Publication grants too broad'; end if;
  if has_function_privilege('anon','public.publish_editorial_issue(uuid,integer,uuid)','EXECUTE') then raise exception 'Anonymous publication permitted'; end if;
  select * into i from public.create_editorial_issue('{"title":"Publication test","kind":"stadium","starts_on":"2026-09-20","closes_on":"2026-09-24","publishes_on":"2026-09-27"}','[{"title":"Test article","kind":"free","position":0}]','00000000-0000-0000-0000-000000000001');
  select id into aid from public.editorial_articles where issue_id=i.id;
  begin
    perform public.preview_editorial_issue(i.id,i.version);
    raise exception using errcode='XX000',message='Preview accepted without advertising inventory';
  exception when raise_exception then
    if sqlerrm not like '%Anzeigenstand%' then raise; end if;
  end;
  begin
    perform public.publish_editorial_issue(i.id,i.version,'00000000-0000-0000-0000-000000000001');
    raise exception using errcode='XX000',message='Published with missing cover and article';
  exception when raise_exception then null; end;
  update public.editorial_issues set cover_path='test/cover.jpg',cover_alt='Cover',advertising='{"issueDate":"2026-09-27","ads":[{"id":"partner","name":"Sponsor alt","asset_path":"frozen.png"}]}' where id=i.id;
  update public.editorial_articles set body='Public body',original_body='PRIVATE ORIGINAL',author='Author' where id=aid;
  select version into revision from public.editorial_issues where id=i.id;
  perform public.preview_editorial_issue(i.id,revision);
  begin
    perform public.publish_editorial_issue(i.id,revision,'00000000-0000-0000-0000-000000000001');
    raise exception using errcode='XX000',message='Published unapproved article';
  exception when raise_exception then null; end;
  update public.editorial_articles set status='ready',approved_by='00000000-0000-0000-0000-000000000001',approved_at=now() where id=aid;
  select version into revision from public.editorial_issues where id=i.id;
  begin
    perform public.publish_editorial_issue(i.id,revision,'00000000-0000-0000-0000-000000000001');
    raise exception using errcode='XX000',message='Published without latest preview';
  exception when raise_exception then null; end;
  snapshot:=public.preview_editorial_issue(i.id,revision);
  if snapshot::text like '%PRIVATE ORIGINAL%' then raise exception 'Original leaked into snapshot'; end if;
  perform public.publish_editorial_issue(i.id,revision,'00000000-0000-0000-0000-000000000001');
  perform public.publish_editorial_issue(i.id,revision,'00000000-0000-0000-0000-000000000001');
  if (select count(*) from public.editorial_publications where issue_id=i.id)<>1 then raise exception 'Publication retry is not idempotent'; end if;
  update public.editorial_issues set advertising=jsonb_set(advertising,'{ads,0,name}','"Sponsor neu"') where id=i.id;
  if (select p.snapshot#>>'{advertising,ads,0,name}' from public.editorial_publications p where p.issue_id=i.id)<>'Sponsor alt' then raise exception 'Published advertisement changed'; end if;
  update public.editorial_articles set title='Changed headline',status='ready' where id=aid;
  if (select status from public.editorial_articles where id=aid)<>'review' then raise exception 'Editing retained approval'; end if;
  if (select approved_at from public.editorial_articles where id=aid) is not null then raise exception 'Approval audit not cleared'; end if;
  if (select p.snapshot#>>'{articles,0,title}' from public.editorial_publications p where p.issue_id=i.id)<>'Test article' then raise exception 'Published snapshot changed'; end if;
  select version into revision from public.editorial_issues where id=i.id;
  if (select previewed_version from public.editorial_issues where id=i.id)=revision then raise exception 'Edit did not invalidate preview'; end if;
end $$;
rollback;
