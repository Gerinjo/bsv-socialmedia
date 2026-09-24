begin;
do $$
declare i public.editorial_issues; other public.editorial_issues; previous integer; snapshot jsonb;
begin
  select * into i from public.create_editorial_issue('{"title":"Newsletter selection test","kind":"newsletter","starts_on":"2026-09-24","closes_on":"2026-09-25","publishes_on":"2026-10-01"}','[]','00000000-0000-0000-0000-000000000001');
  select * into other from public.create_editorial_issue('{"title":"Other issue","kind":"stadium","starts_on":"2026-09-24","closes_on":"2026-09-25","publishes_on":"2026-10-01"}','[]','00000000-0000-0000-0000-000000000001');
  perform public.preview_editorial_issue(i.id,i.version);
  previous:=i.version;
  update public.editorial_issues set newsletter_selection='{"issue_id":"10000000-0000-4000-8000-000000000001","issue_version":7,"title":"Heft","articles":[{"id":"article","title":"Artikel","excerpt":"Gekürzter Text…"}]}' where id=i.id and version=previous returning * into i;
  if i.version<>previous+1 or i.previewed_version=i.version then raise exception 'Changing selection did not invalidate preview'; end if;
  snapshot:=public.preview_editorial_issue(i.id,i.version);
  if snapshot#>>'{newsletter_selection,articles,0,excerpt}'<>'Gekürzter Text…' or snapshot#>>'{newsletter_selection,issue_version}'<>'7' then raise exception 'Selection absent from preview snapshot'; end if;
  update public.editorial_issues set newsletter_selection=null where id=i.id and version=previous;
  if found then raise exception 'Stale write accepted'; end if;
  begin
    update public.editorial_issues set newsletter_selection='[]' where id=i.id;
    raise exception 'Array accepted';
  exception when check_violation then null; end;
  begin
    update public.editorial_issues set newsletter_selection='{}' where id=other.id;
    raise exception 'Newsletter selection accepted on stadium issue';
  exception when check_violation then null; end;
  update public.editorial_issues set newsletter_selection=null where id=i.id and version=i.version returning * into i;
  if private.editorial_snapshot(i.id)->'newsletter_selection'<>'null'::jsonb then raise exception 'Selection not cleared'; end if;
  if (select newsletter_selection from public.editorial_issues where id=other.id) is not null then raise exception 'Other issue changed'; end if;
end $$;
rollback;
