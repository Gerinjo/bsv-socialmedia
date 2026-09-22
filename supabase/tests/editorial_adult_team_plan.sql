begin;
create temp table editorial_plan_fixture(issue_id uuid,newsletter_id uuid,empty_coach uuid,written_coach uuid);
do $$
declare i public.editorial_issues; n public.editorial_issues; youth uuid; aid uuid; written uuid;
begin
  insert into public.social_teams(id,slug,name,active,sort_order) values(gen_random_uuid(),'herren-1','Erste',true,10),(gen_random_uuid(),'herren-2','Zweite',false,11),(gen_random_uuid(),'frauen-1','Frauen',true,20),(gen_random_uuid(),'frauen-2','Frauen II',false,21);
  insert into public.social_teams(id,slug,name,active) values(gen_random_uuid(),'u15-junioren','C-Jugend',true) returning id into youth;
  select * into i from public.create_editorial_issue('{"title":"Altbestand","kind":"stadium","starts_on":"2026-09-22","closes_on":"2026-09-23","publishes_on":"2026-09-27"}','[]',gen_random_uuid());
  select * into n from public.create_editorial_issue('{"title":"Newsletter","kind":"newsletter","starts_on":"2026-09-22","closes_on":"2026-09-23","publishes_on":"2026-09-27"}','[]',gen_random_uuid());
  insert into public.editorial_articles(issue_id,title,kind,team_id,updated_by,status) values(i.id,'Leer','coach',youth,i.created_by,'waived') returning id into aid;
  insert into public.editorial_articles(issue_id,title,kind,team_id,updated_by,body) values(i.id,'Vorhandener Text','coach',youth,i.created_by,'Bitte erhalten') returning id into written;
  insert into editorial_plan_fixture values(i.id,n.id,aid,written);
end $$;
\ir ../migrations/20260922140950_editorial_adult_team_plan.sql
do $$
declare f editorial_plan_fixture; i public.editorial_issues; next_issue public.editorial_issues; snapshot jsonb; settings jsonb;
begin
  select * into f from editorial_plan_fixture;
  if exists(select 1 from public.social_teams where slug in ('herren-2','frauen-2') and active) then raise exception 'Social-media activation changed'; end if;
  if (select count(*) from public.editorial_articles where issue_id=f.issue_id and kind='coach')<>4 then raise exception 'Missing adult coaches'; end if;
  if (select count(*) from public.editorial_articles where issue_id=f.issue_id and kind='sports' and automatic_sports)<>4 then raise exception 'Missing adult sports'; end if;
  if exists(select 1 from public.editorial_articles where id=f.empty_coach) then raise exception 'Empty youth greeting survived'; end if;
  if not exists(select 1 from public.editorial_articles where id=f.written_coach and kind='free' and body='Bitte erhalten') then raise exception 'Existing text lost'; end if;
  if not exists(select 1 from public.editorial_article_revisions r where article_id=f.written_coach and r.snapshot->>'body'='Bitte erhalten') then raise exception 'History lost'; end if;
  if exists(select 1 from public.editorial_articles where issue_id=f.newsletter_id) then raise exception 'Newsletter modified'; end if;
  snapshot:=private.editorial_snapshot(f.issue_id);
  if jsonb_array_length(snapshot->'coverMatches')<>4 then raise exception 'Inactive second teams missing from cover'; end if;
  select * into i from public.editorial_issues where id=f.issue_id;
  settings:='{"showNumber":true,"number":"01","showNamePart1":true,"namePart1":"Verein","showNamePart2":true,"namePart2":"News","showHeadline":true,"headline":"Test","showDate":true,"articles":[],"teamSlugs":["herren-2","frauen-2"]}';
  perform public.save_editorial_cover_defaults(i.id,i.version,settings,i.created_by);
  select * into next_issue from public.create_editorial_issue('{"title":"Neu","kind":"stadium","starts_on":"2026-09-22","closes_on":"2026-09-23","publishes_on":"2026-09-27"}','[]',i.created_by);
  if next_issue.cover_settings->'teamSlugs'<>'["herren-2","frauen-2"]'::jsonb then raise exception 'Defaults lost second teams'; end if;
end $$;
rollback;
