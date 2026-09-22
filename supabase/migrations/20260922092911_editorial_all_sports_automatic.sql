-- Extend the existing generated-body guard to every saved sports contribution.
-- Untouched successful sources can be approved now; edited or missing data
-- remain pending until a successful refresh. Published snapshots stay frozen.
update public.editorial_articles
set automatic_sports=true,
    source_snapshot=case when body=source_snapshot->>'generatedBody'
      and btrim(body)<>'' and coalesce(source_snapshot->>'matchesUrl','')<>''
      and (jsonb_typeof(source_snapshot->'table')='object'
        or coalesce(source_snapshot->>'warning','') like '%keine Verbandstabelle hinterlegt%')
      then jsonb_set(source_snapshot,'{autoApprovalEligible}','true'::jsonb)
      else source_snapshot end
where kind='sports' and not automatic_sports;

create or replace function public.publish_editorial_issue(target uuid,expected_version integer,actor uuid) returns public.editorial_issues language plpgsql security invoker set search_path='' as $$
declare i public.editorial_issues; frozen jsonb;
begin
  select * into strict i from public.editorial_issues where id=target for update;
  if i.kind<>'stadium' then raise exception 'Newsletterversand ist noch nicht eingerichtet.'; end if;
  if i.version<>expected_version then raise exception 'Die Ausgabe wurde geändert. Bitte erneut prüfen.'; end if;
  if i.published_version=i.version then return i; end if;
  if i.cover_path is null then raise exception 'Bitte zuerst ein Titelbild hochladen.'; end if;
  if exists(select 1 from public.editorial_articles where issue_id=target and automatic_sports and (status<>'ready' or btrim(body)='')) then raise exception 'Bitte die Sportdaten aktualisieren. Eine manuelle Freigabe ist nicht erforderlich.'; end if;
  if not exists(select 1 from public.editorial_articles where issue_id=target)
    or exists(select 1 from public.editorial_articles where issue_id=target and not (kind='coach' and status='waived') and (status<>'ready' or btrim(body)='')) then
    raise exception 'Bitte zuerst alle Beiträge freigeben oder bei Trainergrußworten bewusst Verzicht auswählen.';
  end if;
  if i.previewed_version is distinct from i.version then raise exception 'Bitte zuerst die aktuelle Heftvorschau öffnen.'; end if;
  frozen:=private.editorial_snapshot(target)||jsonb_build_object('published_at',now());
  insert into public.editorial_publications(issue_id,issue_version,snapshot,published_by) values(target,i.version,frozen,actor);
  update public.editorial_issues set published_version=i.version,published_at=now() where id=target returning * into i;
  return i;
end $$;


