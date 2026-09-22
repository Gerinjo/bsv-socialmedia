begin;
do $$
declare i public.editorial_issues; aid uuid; second_id uuid; revision integer; frozen jsonb; actor uuid := '00000000-0000-0000-0000-000000000001';
begin
  if has_function_privilege('anon','public.publish_editorial_issue(uuid,integer,uuid)','EXECUTE') then raise exception 'Anonymous publication allowed'; end if;
  if has_table_privilege('authenticated','public.editorial_articles','UPDATE') then raise exception 'Unprivileged write allowed'; end if;
  select * into i from public.create_editorial_issue('{"title":"Coach waiver test","kind":"stadium","starts_on":"2026-09-20","closes_on":"2026-09-24","publishes_on":"2026-09-27"}',
    '[{"title":"Coach 1","kind":"coach","position":1},{"title":"Coach 2","kind":"coach","position":2}]',actor);
  select id into aid from public.editorial_articles where issue_id=i.id and position=1;
  select id into second_id from public.editorial_articles where issue_id=i.id and position=2;
  update public.editorial_issues set cover_path='test/cover.jpg',advertising='{"issueDate":"2026-09-27","ads":[]}' where id=i.id;
  update public.editorial_articles set body='PRIVATE UNAPPROVED COACH',original_body='Original retained' where id=aid;
  select version into revision from public.editorial_issues where id=i.id;
  frozen:=public.preview_editorial_issue(i.id,revision);
  if jsonb_array_length(frozen->'articles')<>0 then raise exception 'Unapproved coach leaked into preview'; end if;
  update public.editorial_articles set status='ready',approved_by=actor,approved_at=now() where id=aid;
  select version into revision from public.editorial_issues where id=i.id;
  perform public.preview_editorial_issue(i.id,revision);
  begin
    perform public.publish_editorial_issue(i.id,revision,actor);
    raise exception using errcode='XX000',message='An open coach did not block publication';
  exception when raise_exception then null; end;
  update public.editorial_articles set status='waived' where id=second_id;
  select version into revision from public.editorial_issues where id=i.id;
  begin
    perform public.publish_editorial_issue(i.id,revision,actor);
    raise exception using errcode='XX000',message='Waiver did not invalidate previous preview';
  exception when raise_exception then null; end;
  frozen:=public.preview_editorial_issue(i.id,revision);
  if jsonb_array_length(frozen->'articles')<>1 then raise exception 'Waived empty coach was included'; end if;
  perform public.publish_editorial_issue(i.id,revision,actor);
  update public.editorial_articles set status='waived' where id=aid;
  if (select body from public.editorial_articles where id=aid)<>'PRIVATE UNAPPROVED COACH' then raise exception 'Waiver erased text'; end if;
  if (select original_body from public.editorial_articles where id=aid)<>'Original retained' then raise exception 'Waiver erased original'; end if;
  if (select approved_at from public.editorial_articles where id=aid) is not null then raise exception 'Waiver kept approval'; end if;
  if not exists(select 1 from public.editorial_article_revisions where article_id=aid and snapshot->>'status'='waived') then raise exception 'Waiver not recorded in history'; end if;
  select version into revision from public.editorial_issues where id=i.id;
  frozen:=public.preview_editorial_issue(i.id,revision);
  if jsonb_array_length(frozen->'articles')<>0 then raise exception 'Waived saved text leaked'; end if;
  if (select jsonb_array_length(snapshot->'articles') from public.editorial_publications where issue_id=i.id)<>1 then raise exception 'Old publication modified'; end if;
  update public.editorial_articles set status='review' where id=aid;
  select version into revision from public.editorial_issues where id=i.id;
  perform public.preview_editorial_issue(i.id,revision);
  begin
    perform public.publish_editorial_issue(i.id,revision,actor);
    raise exception using errcode='XX000',message='Reopened coach must block publication';
  exception when raise_exception then null; end;
  begin
    insert into public.editorial_articles(issue_id,title,kind,status,updated_by) values(i.id,'Sport','sports','waived',actor);
    raise exception using errcode='XX000',message='Waiver accepted for sports';
  exception when check_violation then null; end;
end $$;
rollback;
