-- Only the authenticated editorial API calls this service-only transaction.
-- Stadium publications keep their existing deletion protection.
grant delete on public.editorial_publications to service_role;
create function public.manage_editorial_newsletter(target uuid, expected_version integer, operation text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare i public.editorial_issues;
begin
  select * into strict i from public.editorial_issues where id=target for update;
  if i.kind <> 'newsletter' then raise exception 'Diese Aktion ist nur für Newsletter verfügbar.'; end if;
  if expected_version is null or i.version <> expected_version then
    raise exception 'Die Ausgabe wurde zwischenzeitlich geändert. Bitte neu laden.';
  end if;
  if operation='delete' then
    delete from public.editorial_publications where issue_id=target;
    delete from public.editorial_issues where id=target;
    return jsonb_build_object('removed',true);
  elsif operation='complete' then
    if not exists(select 1 from public.editorial_articles where issue_id=target)
      and jsonb_array_length(coalesce(i.newsletter_selection->'articles','[]'::jsonb))=0 then
      raise exception 'Bitte zuerst Newsletter-Beiträge hinzufügen.';
    end if;
    if exists(select 1 from public.editorial_articles where issue_id=target and (status<>'ready' or btrim(body)='')) then
      raise exception 'Bitte alle Newsletter-Beiträge ausfüllen und freigeben.';
    end if;
    if i.previewed_version is distinct from i.version then
      raise exception 'Bitte zuerst die aktuelle E-Mail-Vorschau prüfen.';
    end if;
    -- This records the editorial completion; it never sends mail through Resend.
    update public.editorial_issues set published_version=i.version,published_at=now() where id=target returning * into i;
    return jsonb_build_object('issue',to_jsonb(i));
  end if;
  raise exception 'Unbekannte Newsletter-Aktion.';
end $$;
revoke all on function public.manage_editorial_newsletter(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.manage_editorial_newsletter(uuid,integer,text) to service_role;
