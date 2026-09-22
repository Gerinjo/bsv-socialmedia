begin;
do $$
declare i public.editorial_issues; aid uuid; frozen jsonb; revision integer;
begin
  if (select public from storage.buckets where id='editorial-galleries') then raise exception 'Gallery bucket must be private'; end if;
  select * into i from public.create_editorial_issue('{"title":"Gallery test","kind":"stadium","starts_on":"2026-09-20","closes_on":"2026-09-24","publishes_on":"2026-09-27"}',
    '[{"title":"Fest","kind":"free","position":1000}]','00000000-0000-0000-0000-000000000001');
  select id into aid from public.editorial_articles where issue_id=i.id;
  update public.editorial_articles set body='Bericht',gallery_groups='[{"id":"group","title":"Fest","cover_id":"first","images":[{"id":"first","alt":"Erstes Bild","photo_path":"frozen/first.jpg"},{"id":"second","alt":"Zweites Bild","photo_path":"frozen/second.jpg"}]}]' where id=aid;
  update public.editorial_articles set status='ready',approved_at=now() where id=aid;
  update public.editorial_issues set cover_path='test/cover.jpg',advertising='{"issueDate":"2026-09-27","ads":[]}' where id=i.id;
  select version into revision from public.editorial_issues where id=i.id;
  frozen:=public.preview_editorial_issue(i.id,revision);
  if frozen#>>'{articles,0,galleries,0,cover_id}'<>'first' then raise exception 'Gallery cover omitted'; end if;
  perform public.publish_editorial_issue(i.id,revision,'00000000-0000-0000-0000-000000000001');
  update public.editorial_articles set gallery_groups=jsonb_set(gallery_groups,'{0,cover_id}','"second"') where id=aid;
  if (select status from public.editorial_articles where id=aid)<>'review' then raise exception 'Gallery change retained approval'; end if;
  if (select approved_at from public.editorial_articles where id=aid) is not null then raise exception 'Gallery change retained approval timestamp'; end if;
  if (select version from public.editorial_issues where id=i.id)<=revision then raise exception 'Issue version unchanged'; end if;
  if (select snapshot#>>'{articles,0,galleries,0,cover_id}' from public.editorial_publications where issue_id=i.id)<>'first' then raise exception 'Published cover changed'; end if;
end $$;
rollback;
