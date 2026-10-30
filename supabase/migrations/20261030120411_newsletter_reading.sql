-- Freeze complete newsletter reading editions using the existing service-only publication table.
create or replace function private.editorial_snapshot(target uuid) returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('schemaVersion',1,'brand',i.brand_settings,'id',i.id,'version',i.version,'title',i.title,'kind',i.kind,'publishes_on',i.publishes_on,'newsletter_settings',i.newsletter_settings,'newsletter_selection',i.newsletter_selection,
    'cover_settings',case when i.cover_settings is null then null else jsonb_set(i.cover_settings,'{articles}',coalesce((
      select jsonb_agg(c.value) from jsonb_array_elements(coalesce(i.cover_settings->'articles','[]'::jsonb)) c
      where exists(select 1 from public.editorial_articles ca where ca.issue_id=i.id and ca.id::text=c.value->>'id'
        and ca.kind<>'sports' and ca.status<>'waived' and btrim(ca.body)<>'' and (ca.kind<>'coach' or ca.status='ready'))
    ),'[]'::jsonb)) end,'advertising',i.advertising,'cover_path',i.cover_path,'cover_alt',i.cover_alt,'cover_credit',i.cover_credit,
    'coverMatches',coalesce((select jsonb_agg(jsonb_build_object(
      'team',case split_part(t.slug,'-',1) when 'herren' then 'Herren' else 'Frauen' end || ' ' ||
        case split_part(t.slug,'-',2) when '1' then 'I' when '2' then 'II' else split_part(t.slug,'-',2) end,
      'articleId',a.id,'date',m.value->>'date','time',nullif(m.value->>'time',''),
      'home',m.value->>'home','away',m.value->>'away',
      'state',case when m.value is not null then 'scheduled' when a.source_snapshot->>'fetchedAt' is not null then 'unavailable' else 'pending' end
    ) order by t.sort_order,t.slug)
      from public.social_teams t
      left join lateral (select sa.id,sa.source_snapshot from public.editorial_articles sa
        where sa.issue_id=i.id and sa.team_id=t.id and sa.kind='sports' order by sa.position,sa.created_at limit 1) a on true
      left join lateral (select value from jsonb_array_elements(coalesce(a.source_snapshot->'upcoming','[]'::jsonb))
        where value->>'scheduled'='true' and coalesce(value->>'finished','false')<>'true'
          and value->>'date'>=i.publishes_on::text
        order by value->>'date',coalesce(value->>'time','') limit 1) m on true
      where (t.active or t.slug ~ '^(herren|frauen)-[12]$') and t.slug ~ '^(herren|frauen)-[1-9][0-9]*$'), '[]'::jsonb),
    'articles',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'body',a.body,'author',a.author,'kind',a.kind,'status',a.status,'automatic_sports',a.automatic_sports,'team_photo',case when a.kind='sports' and a.source_snapshot#>>'{teamPhoto,photo_path}' is not null then jsonb_build_object('photo_path',a.source_snapshot#>>'{teamPhoto,photo_path}','alt',a.source_snapshot#>>'{teamPhoto,alt}') else null end,'department_group',(select d.audience_group from public.social_post_audiences d where d.id=a.department_id),'team_slug',(select t.slug from public.social_teams t where t.id=a.team_id),'galleries',a.gallery_groups,'people',coalesce((select jsonb_agg(jsonb_build_object('name',p->>'name','role',p->>'role','photo_path',p->>'photo_path')) from jsonb_array_elements(a.people_snapshot) p),'[]'::jsonb),'event',a.event_snapshot-array['description','source_id']) order by a.position,a.created_at) from public.editorial_articles a where a.issue_id=i.id and a.status<>'waived' and (a.kind<>'coach' or (a.status='ready' and btrim(a.body)<>''))),'[]'::jsonb))
  from public.editorial_issues i where i.id=target;
$$;

revoke all on function private.editorial_snapshot(uuid) from public,anon,authenticated;
grant execute on function private.editorial_snapshot(uuid) to service_role;

-- Only the authenticated editorial API calls this service-only transaction.
-- Stadium publications keep their existing deletion protection.
grant delete on public.editorial_publications to service_role;
create or replace function public.manage_editorial_newsletter(target uuid, expected_version integer, operation text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare i public.editorial_issues; frozen jsonb; imported jsonb;
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
    if i.published_version=i.version and exists(select 1 from public.editorial_publications where issue_id=target and issue_version=i.version) then
      return jsonb_build_object('issue',to_jsonb(i));
    end if;
    frozen:=private.editorial_snapshot(target)||jsonb_build_object('published_at',now());
    if jsonb_array_length(coalesce(i.newsletter_selection->'articles','[]'::jsonb))>0 then
      select jsonb_agg(a.value || jsonb_build_object('body',coalesce(full_article.value->>'body',a.value->>'excerpt')) order by a.ordinality) into imported
      from jsonb_array_elements(i.newsletter_selection->'articles') with ordinality a(value,ordinality)
      left join public.editorial_publications p on p.issue_id=(i.newsletter_selection->>'issue_id')::uuid
        and p.issue_version=(i.newsletter_selection->>'issue_version')::integer
      left join lateral (select value from jsonb_array_elements(p.snapshot->'articles') where value->>'id'=a.value->>'id') full_article on true;
      frozen:=jsonb_set(frozen,'{newsletter_selection,articles}',imported);
    end if;
    insert into public.editorial_publications(issue_id,issue_version,snapshot,published_by)
      values(target,i.version,frozen,i.created_by);
    -- This records the editorial completion; it never sends mail through Resend.
    update public.editorial_issues set published_version=i.version,published_at=now() where id=target returning * into i;
    return jsonb_build_object('issue',to_jsonb(i));
  end if;
  raise exception 'Unbekannte Newsletter-Aktion.';
end $$;
revoke all on function public.manage_editorial_newsletter(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.manage_editorial_newsletter(uuid,integer,text) to service_role;
