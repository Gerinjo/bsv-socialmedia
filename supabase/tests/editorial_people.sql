begin;
do $$
declare i public.editorial_issues; aid uuid; frozen jsonb; revision integer;
begin
  if (select public from storage.buckets where id='editorial-portraits') then raise exception 'Portrait bucket must be private'; end if;
  select * into i from public.create_editorial_issue('{"title":"Portrait test","kind":"stadium","starts_on":"2026-09-20","closes_on":"2026-09-24","publishes_on":"2026-09-27"}',
    '[{"title":"Grußwort","kind":"board","position":0}]','00000000-0000-0000-0000-000000000001');
  select id into aid from public.editorial_articles where issue_id=i.id;
  update public.editorial_articles set body='Grußwort',people_snapshot='[{"person_id":"PRIVATE ID","source_photo_url":"PRIVATE SOURCE","name":"Vorstand","role":"1. Vorstand","photo_path":"frozen/photo.jpg"}]' where id=aid;
  update public.editorial_articles set status='ready',approved_at=now() where id=aid;
  update public.editorial_issues set cover_path='test/cover.jpg',advertising='{"issueDate":"2026-09-27","ads":[]}' where id=i.id;
  select version into revision from public.editorial_issues where id=i.id;
  frozen:=public.preview_editorial_issue(i.id,revision);
  if frozen::text like '%PRIVATE%' then raise exception 'Private person data leaked'; end if;
  if frozen#>>'{articles,0,people,0,photo_path}'<>'frozen/photo.jpg' then raise exception 'Portrait omitted'; end if;
  perform public.publish_editorial_issue(i.id,revision,'00000000-0000-0000-0000-000000000001');
  update public.editorial_articles set people_snapshot=jsonb_set(people_snapshot,'{0,photo_path}','"new/photo.jpg"') where id=aid;
  if (select status from public.editorial_articles where id=aid)<>'review' then raise exception 'Portrait change retained approval'; end if;
  if (select snapshot#>>'{articles,0,people,0,photo_path}' from public.editorial_publications where issue_id=i.id)<>'frozen/photo.jpg' then raise exception 'Published portrait changed'; end if;
end $$;
rollback;
