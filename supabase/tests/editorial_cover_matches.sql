begin;
do $$
declare i public.editorial_issues; aid uuid; frozen jsonb; revision integer;
begin
  insert into public.social_teams(id,slug,name,competition,active,sort_order) values
    ('00000000-0000-0000-0000-000000000101','herren-1','Herren I','Test',true,10),
    ('00000000-0000-0000-0000-000000000102','herren-2','Herren II','Test',true,11),
    ('00000000-0000-0000-0000-000000000103','frauen-1','Frauen I','Test',true,20),
    ('00000000-0000-0000-0000-000000000104','frauen-2','Frauen II','Test',true,21),
    ('00000000-0000-0000-0000-000000000105','a-jugend','A-Jugend','Test',true,30),
    ('00000000-0000-0000-0000-000000000106','herren-3','Herren III','Test',false,12);
  select * into i from public.create_editorial_issue(
    '{"title":"Cover test","kind":"stadium","starts_on":"2026-09-20","closes_on":"2026-09-24","publishes_on":"2026-09-27"}',
    '[{"title":"Sport Herren I","kind":"sports","team_id":"00000000-0000-0000-0000-000000000101","position":0}]',
    '00000000-0000-0000-0000-000000000001');
  select id into aid from public.editorial_articles where issue_id=i.id;
  update public.editorial_articles set body='Spielplan',source_snapshot='{"fetchedAt":"2026-09-20","private":"PRIVATE SOURCE","upcoming":[
    {"date":"2026-10-04","scheduled":true,"home":"Later","away":"BSV"},
    {"date":"2026-09-26","scheduled":true,"home":"Earlier","away":"BSV"},
    {"date":"2026-09-27","time":"12:00","scheduled":false,"home":"Cancelled","away":"BSV"},
    {"date":"2026-09-27","time":"13:00","scheduled":true,"finished":true,"home":"Finished","away":"BSV"},
    {"date":"2026-09-27","time":"15:00","scheduled":true,"home":"Gastgeber","away":"BSV"},
    {"date":"2026-09-27","time":"14:00","scheduled":true,"home":"Gastgeber","away":"BSV"}
  ]}' where id=aid;
  update public.editorial_articles set status='ready',approved_at=now() where id=aid;
  update public.editorial_issues set cover_path='test/cover.jpg',advertising='{"issueDate":"2026-09-27","ads":[]}' where id=i.id;
  select version into revision from public.editorial_issues where id=i.id;
  frozen:=public.preview_editorial_issue(i.id,revision);
  if jsonb_array_length(frozen->'coverMatches')<>4 then raise exception 'Cover must contain the four active adult teams'; end if;
  if frozen#>>'{coverMatches,0,date}'<>'2026-09-27' or frozen#>>'{coverMatches,0,time}'<>'14:00' then raise exception 'Wrong next fixture'; end if;
  if frozen#>>'{coverMatches,0,home}'<>'Gastgeber' or frozen#>>'{coverMatches,0,away}'<>'BSV' then raise exception 'Home/away reversed'; end if;
  if frozen#>>'{coverMatches,0,articleId}'<>aid::text then raise exception 'Wrong article link'; end if;
  if frozen#>>'{coverMatches,3,team}'<>'Frauen II' or frozen#>>'{coverMatches,3,state}'<>'pending' then raise exception 'Missing source must remain visible'; end if;
  if frozen::text like '%PRIVATE SOURCE%' then raise exception 'Private source leaked'; end if;
  perform public.publish_editorial_issue(i.id,revision,'00000000-0000-0000-0000-000000000001');
  update public.editorial_articles set source_snapshot=jsonb_set(source_snapshot,'{upcoming,5,away}','"Changed"') where id=aid;
  if (select snapshot#>>'{coverMatches,0,away}' from public.editorial_publications where issue_id=i.id)<>'BSV' then raise exception 'Published cover changed'; end if;
  update public.editorial_articles set source_snapshot='{"fetchedAt":"2026-09-20","upcoming":[]}' where id=aid;
  if private.editorial_snapshot(i.id)#>>'{coverMatches,0,state}'<>'unavailable' then raise exception 'Missing next fixture must be labelled'; end if;
end $$;
rollback;
