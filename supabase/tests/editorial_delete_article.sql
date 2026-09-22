begin;
do $$
declare i public.editorial_issues; aid uuid; revision integer; article_version integer; frozen jsonb;
begin
  select * into i from public.create_editorial_issue('{"title":"Delete test","kind":"stadium","starts_on":"2026-09-20","closes_on":"2026-09-24","publishes_on":"2026-09-27"}',
    '[{"title":"Bericht mit Bildern","kind":"free","position":1000}]','00000000-0000-0000-0000-000000000001');
  select id into aid from public.editorial_articles where issue_id=i.id;
  update public.editorial_articles set body='Veröffentlichter Bericht',gallery_groups='[{"id":"group","title":"Fest","cover_id":"photo","images":[{"id":"photo","alt":"Fest","photo_path":"frozen/photo.jpg"}]}]' where id=aid;
  update public.editorial_articles set status='ready',approved_at=now() where id=aid;
  update public.editorial_issues set cover_path='test/cover.jpg',advertising='{"issueDate":"2026-09-27","ads":[]}' where id=i.id;
  select version into revision from public.editorial_issues where id=i.id;
  perform public.preview_editorial_issue(i.id,revision);
  perform public.publish_editorial_issue(i.id,revision,'00000000-0000-0000-0000-000000000001');
  select snapshot into frozen from public.editorial_publications where issue_id=i.id;
  select version into article_version from public.editorial_articles where id=aid;
  delete from public.editorial_articles where id=aid and version=article_version-1;
  if not exists(select 1 from public.editorial_articles where id=aid) then raise exception 'Stale version deleted article'; end if;
  delete from public.editorial_articles where id=aid and version=article_version;
  if exists(select 1 from public.editorial_articles where id=aid) then raise exception 'Article retained'; end if;
  if exists(select 1 from public.editorial_article_revisions where article_id=aid) then raise exception 'Draft revisions retained'; end if;
  if (select version<=revision or previewed_version=version from public.editorial_issues where id=i.id) then raise exception 'Delete did not invalidate preview'; end if;
  if jsonb_array_length(private.editorial_snapshot(i.id)->'articles')<>0 then raise exception 'Deleted article in draft snapshot'; end if;
  if (select snapshot from public.editorial_publications where issue_id=i.id) is distinct from frozen then raise exception 'Published text or images changed'; end if;
  if frozen#>>'{articles,0,galleries,0,images,0,photo_path}'<>'frozen/photo.jpg' then raise exception 'Published image reference lost'; end if;
end $$;
rollback;
