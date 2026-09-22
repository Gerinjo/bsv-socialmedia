begin;
do $$
declare i public.editorial_issues; aid uuid; frozen jsonb; revision integer;
begin
  if (select public from storage.buckets where id='editorial-portraits') then raise exception 'Team photos must be private'; end if;
  select * into i from public.create_editorial_issue('{"title":"Team photo test","kind":"stadium","starts_on":"2026-09-20","closes_on":"2026-09-24","publishes_on":"2026-09-27"}',
    '[{"title":"Sport","kind":"sports","position":0}]','00000000-0000-0000-0000-000000000001');
  select id into aid from public.editorial_articles where issue_id=i.id;
  update public.editorial_articles set body='Sportdaten',source_snapshot='{"teamPhoto":{"source_url":"PRIVATE SOURCE","hash":"PRIVATE HASH","photo_path":"frozen/team.jpg","alt":"Mannschaft"},"generatedBody":"Sportdaten","autoApprovalEligible":true}' where id=aid;
  update public.editorial_articles set status='ready',approved_at=now() where id=aid;
  update public.editorial_issues set cover_path='test/cover.jpg',advertising='{"issueDate":"2026-09-27","ads":[]}' where id=i.id;
  select version into revision from public.editorial_issues where id=i.id;
  frozen:=public.preview_editorial_issue(i.id,revision);
  if frozen#>>'{articles,0,team_photo,photo_path}'<>'frozen/team.jpg' then raise exception 'Team photo omitted'; end if;
  if frozen::text like '%PRIVATE%' then raise exception 'Private source metadata leaked'; end if;
  perform public.publish_editorial_issue(i.id,revision,'00000000-0000-0000-0000-000000000001');
  update public.editorial_articles set source_snapshot=jsonb_set(source_snapshot,'{teamPhoto,photo_path}','"new/team.jpg"') where id=aid;
  if (select status from public.editorial_articles where id=aid)<>'review' then raise exception 'Team photo change retained adult approval'; end if;
  if (select snapshot#>>'{articles,0,team_photo,photo_path}' from public.editorial_publications where issue_id=i.id)<>'frozen/team.jpg' then raise exception 'Published photo changed'; end if;
  update public.editorial_articles set automatic_sports=true where id=aid;
  update public.editorial_articles set source_snapshot=jsonb_set(source_snapshot,'{teamPhoto,photo_path}','"newer/team.jpg"') where id=aid;
  if (select status from public.editorial_articles where id=aid)<>'ready' then raise exception 'Youth sources must stay automatically approved'; end if;
end $$;
rollback;
