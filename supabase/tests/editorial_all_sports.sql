begin;
do $$
declare i public.editorial_issues; aid uuid; revision integer; actor uuid:='00000000-0000-0000-0000-000000000001';
begin
 select * into i from public.create_editorial_issue('{"title":"Adult automatic sports","kind":"stadium","starts_on":"2026-09-20","closes_on":"2026-09-24","publishes_on":"2026-09-27"}',
 '[{"title":"Herren II","kind":"sports","position":1,"automatic_sports":true}]',actor);
 select id into aid from public.editorial_articles where issue_id=i.id;
 if (select status from public.editorial_articles where id=aid)<>'draft' then raise exception 'Missing adult source was approved'; end if;
 update public.editorial_articles set body='Official adult source',source_snapshot='{"generatedBody":"Official adult source","autoApprovalEligible":true,"compact":false,"teamPhoto":{"photo_path":"old.jpg"}}' where id=aid;
 if (select status from public.editorial_articles where id=aid)<>'ready' then raise exception 'Adult data require manual approval'; end if;
 if (select approved_by from public.editorial_articles where id=aid) is not null then raise exception 'Automatic approval pretended to be human'; end if;
 update public.editorial_issues set cover_path='cover.jpg',advertising='{"issueDate":"2026-09-27","ads":[]}' where id=i.id;
 select version into revision from public.editorial_issues where id=i.id;
 perform public.preview_editorial_issue(i.id,revision);
 perform public.publish_editorial_issue(i.id,revision,actor);
 update public.editorial_articles set source_snapshot=jsonb_set(source_snapshot,'{teamPhoto,photo_path}','"new.jpg"') where id=aid;
 if (select status from public.editorial_articles where id=aid)<>'ready' then raise exception 'Adult photo broke automatic approval'; end if;
 if (select snapshot#>>'{articles,0,team_photo,photo_path}' from public.editorial_publications where issue_id=i.id)<>'old.jpg' then raise exception 'Publication changed'; end if;
 update public.editorial_articles set source_snapshot=jsonb_set(source_snapshot,'{autoApprovalEligible}','false') where id=aid;
 select version into revision from public.editorial_issues where id=i.id;
 perform public.preview_editorial_issue(i.id,revision);
 begin
   perform public.publish_editorial_issue(i.id,revision,actor);
   raise exception using errcode='XX000',message='Missing automatic source allowed publication';
 exception when raise_exception then
   if sqlerrm not like '%Sportdaten aktualisieren%' then raise; end if;
 end;
end $$;
rollback;
