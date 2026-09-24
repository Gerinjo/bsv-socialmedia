begin;
do $$
declare i public.editorial_issues; other public.editorial_issues; previous integer; snapshot jsonb;
begin
  if not (select relrowsecurity from pg_class where oid='public.editorial_issues'::regclass) then raise exception 'Editorial RLS disabled'; end if;
  if has_table_privilege('anon','public.editorial_issues','SELECT') or has_table_privilege('authenticated','public.editorial_issues','UPDATE') then raise exception 'Editorial access widened'; end if;
  if has_function_privilege('anon','private.editorial_snapshot(uuid)','EXECUTE') then raise exception 'Snapshot exposed'; end if;
  select * into i from public.create_editorial_issue('{"title":"Newsletter settings test","kind":"newsletter","starts_on":"2026-09-24","closes_on":"2026-09-25","publishes_on":"2026-10-01"}','[]','00000000-0000-0000-0000-000000000001');
  select * into other from public.create_editorial_issue('{"title":"Other issue","kind":"stadium","starts_on":"2026-09-24","closes_on":"2026-09-25","publishes_on":"2026-10-01"}','[]','00000000-0000-0000-0000-000000000001');
  perform public.preview_editorial_issue(i.id,i.version);
  previous:=i.version;
  update public.editorial_issues set newsletter_settings='{"name":"Meine Sternenpost","number":"02","showNumber":true}' where id=i.id and version=previous returning * into i;
  if i.version<>previous+1 or i.previewed_version=i.version then raise exception 'Changing settings did not invalidate the preview'; end if;
  snapshot:=public.preview_editorial_issue(i.id,i.version);
  if snapshot#>>'{newsletter_settings,name}'<>'Meine Sternenpost' or snapshot#>>'{newsletter_settings,number}'<>'02' then raise exception 'Settings absent from preview snapshot'; end if;
  update public.editorial_issues set newsletter_settings='{"name":"Stale"}' where id=i.id and version=previous;
  if found then raise exception 'Stale write accepted'; end if;
  begin
    update public.editorial_issues set newsletter_settings='[]' where id=i.id;
    raise exception 'Array accepted';
  exception when check_violation then null; end;
  begin
    update public.editorial_issues set newsletter_settings='{}' where id=other.id;
    raise exception 'Newsletter settings accepted on stadium issue';
  exception when check_violation then null; end;
  if (select newsletter_settings from public.editorial_issues where id=other.id) is not null then raise exception 'Other issue changed'; end if;
end $$;
rollback;
