begin;
do $$
declare i public.editorial_issues; aid uuid; revision integer;
begin
  select * into i from public.create_editorial_issue('{"title":"Auto sports","kind":"stadium","starts_on":"2026-09-20","closes_on":"2026-09-24","publishes_on":"2026-09-27"}','[{"title":"A-Jugend","kind":"sports","position":0,"automatic_sports":true}]','00000000-0000-0000-0000-000000000001');
  select id into aid from public.editorial_articles where issue_id=i.id;
  if not (select automatic_sports from public.editorial_articles where id=aid) then raise exception 'Seed lost automatic flag'; end if;
  update public.editorial_articles set status='ready',body='Unverified result' where id=aid;
  if (select status from public.editorial_articles where id=aid)<>'draft' then raise exception 'Approved unverified data'; end if;
  update public.editorial_articles set body='Generated result',source_snapshot='{"generatedBody":"Generated result","autoApprovalEligible":true}',status='review' where id=aid;
  if (select status from public.editorial_articles where id=aid)<>'ready' then raise exception 'Fresh data requires manual approval'; end if;
  if (select approved_at is null or approved_by is not null from public.editorial_articles where id=aid) then raise exception 'Automatic audit incorrect'; end if;
  update public.editorial_issues set cover_path='test/cover.png',advertising='{"issueDate":"2026-09-27","ads":[]}' where id=i.id;
  select version into revision from public.editorial_issues where id=i.id;
  perform public.preview_editorial_issue(i.id,revision);
  perform public.publish_editorial_issue(i.id,revision,'00000000-0000-0000-0000-000000000001');
  if (select p.snapshot#>>'{articles,0,automatic_sports}' from public.editorial_publications p where p.issue_id=i.id)<>'true' then raise exception 'Publication lost youth layout flag'; end if;
  update public.editorial_articles set body='Edited result',status='ready' where id=aid;
  if (select status from public.editorial_articles where id=aid)<>'draft' then raise exception 'Edited body retained automatic approval'; end if;
  update public.editorial_articles set body='New generated result',source_snapshot='{"generatedBody":"New generated result","autoApprovalEligible":true}' where id=aid;
  if (select status from public.editorial_articles where id=aid)<>'ready' then raise exception 'Refresh lost automatic approval'; end if;
  if (select p.snapshot#>>'{articles,0,body}' from public.editorial_publications p where p.issue_id=i.id)<>'Generated result' then raise exception 'Published sport changed on refresh'; end if;
  update public.editorial_articles set source_snapshot=jsonb_set(source_snapshot,'{autoApprovalEligible}','false') where id=aid;
  if (select status from public.editorial_articles where id=aid)<>'draft' then raise exception 'Failed source auto approved'; end if;
end $$;
rollback;
