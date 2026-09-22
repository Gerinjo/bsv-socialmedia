begin;
do $$
declare first_issue public.editorial_issues; next_issue public.editorial_issues; newsletter public.editorial_issues; latest public.editorial_issues;
  seed jsonb := '[{"title":"Vorstand","kind":"board","template_key":"board","position":0},{"title":"Beitrag","kind":"free","position":1}]';
  data jsonb := '{"title":"Test","kind":"stadium","starts_on":"2026-09-20","closes_on":"2026-09-22","publishes_on":"2026-09-27"}';
  actor uuid := '00000000-0000-0000-0000-000000000001'; aid uuid; fid uuid; settings jsonb; original jsonb;
begin
  if has_table_privilege('authenticated','public.editorial_cover_defaults','SELECT') or has_function_privilege('anon','public.save_editorial_cover_defaults(uuid,integer,jsonb,uuid)','EXECUTE') then raise exception 'Defaults exposed'; end if;
  if not (select relrowsecurity from pg_class where oid='public.editorial_cover_defaults'::regclass) then raise exception 'Defaults RLS missing'; end if;
  insert into public.social_teams(id,slug,name) values(gen_random_uuid(),'herren-1','Erste');
  select * into first_issue from public.create_editorial_issue(data,seed,actor);
  if first_issue.cover_settings is not null then raise exception 'Unexpected initial defaults'; end if;
  select id into aid from public.editorial_articles where issue_id=first_issue.id and kind='board';
  select id into fid from public.editorial_articles where issue_id=first_issue.id and kind='free';
  settings:=jsonb_build_object('showNumber',false,'number','07','showNamePart1',true,'namePart1','VEREINS','showNamePart2',true,'namePart2','leben','showHeadline',true,'headline','Willkommen','showDate',false,'teamSlugs','["herren-1","frauen-9"]'::jsonb,'articles',jsonb_build_array(jsonb_build_object('id',aid,'alias','Unser Vorstand'),jsonb_build_object('id',fid,'alias','Nur diesmal')));
  select * into first_issue from public.save_editorial_cover_defaults(first_issue.id,first_issue.version,settings,actor);
  if first_issue.cover_settings is distinct from settings then raise exception 'Current cover not saved'; end if;
  original:=(select d.settings from public.editorial_cover_defaults d);
  if original#>>'{articles,0,template_key}'<>'board' or jsonb_array_length(original->'articles')<>1 then raise exception 'Template contains issue-specific references'; end if;
  begin
    perform public.save_editorial_cover_defaults(first_issue.id,first_issue.version-1,jsonb_set(settings,'{namePart1}','"Stale"'),actor);
    raise exception using errcode='XX000',message='Stale save accepted';
  exception when raise_exception then null; end;
  if (select d.settings from public.editorial_cover_defaults d) is distinct from original then raise exception 'Stale save changed defaults'; end if;
  select * into next_issue from public.create_editorial_issue(jsonb_set(data,'{publishes_on}','"2026-10-04"'),seed,actor);
  if next_issue.cover_settings->>'namePart1'<>'VEREINS' or next_issue.publishes_on<>'2026-10-04' then raise exception 'Defaults or new date lost'; end if;
  if next_issue.cover_settings#>>'{articles,0,id}'=aid::text or not exists(select 1 from public.editorial_articles where issue_id=next_issue.id and id::text=next_issue.cover_settings#>>'{articles,0,id}') then raise exception 'Greeting did not resolve to new issue'; end if;
  if next_issue.cover_settings#>>'{articles,0,alias}'<>'Unser Vorstand' or next_issue.cover_settings->'teamSlugs'<>'["herren-1"]'::jsonb then raise exception 'Selections not copied or stale team included'; end if;
  select * into newsletter from public.create_editorial_issue(jsonb_set(data,'{kind}','"newsletter"'),'[]',actor);
  if newsletter.cover_settings is not null then raise exception 'Newsletter inherited cover'; end if;
  perform public.save_editorial_cover_defaults(first_issue.id,first_issue.version,jsonb_set(settings,'{namePart1}','"NEU"'),actor);
  if (select cover_settings from public.editorial_issues where id=next_issue.id) is distinct from next_issue.cover_settings then raise exception 'Existing issue changed with defaults'; end if;
  select * into latest from public.create_editorial_issue(data,seed,actor);
  if latest.cover_settings->>'namePart1'<>'NEU' then raise exception 'New issue missed latest defaults'; end if;
end $$;
rollback;
