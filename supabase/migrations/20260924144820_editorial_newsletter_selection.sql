-- Frozen excerpts from one explicitly selected published stadium edition.
alter table public.editorial_issues add column newsletter_selection jsonb;
alter table public.editorial_issues add constraint editorial_newsletter_selection_object check (
  newsletter_selection is null or (kind='newsletter' and jsonb_typeof(newsletter_selection)='object' and octet_length(newsletter_selection::text)<=131072)
);

create or replace function private.editorial_snapshot(target uuid) returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('schemaVersion',1,'id',i.id,'version',i.version,'title',i.title,'kind',i.kind,'publishes_on',i.publishes_on,'newsletter_settings',i.newsletter_settings,'newsletter_selection',i.newsletter_selection,
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
    'articles',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'body',a.body,'author',a.author,'kind',a.kind,'status',a.status,'automatic_sports',a.automatic_sports,'team_photo',case when a.kind='sports' and a.source_snapshot#>>'{teamPhoto,photo_path}' is not null then jsonb_build_object('photo_path',a.source_snapshot#>>'{teamPhoto,photo_path}','alt',a.source_snapshot#>>'{teamPhoto,alt}') else null end,'team_slug',(select t.slug from public.social_teams t where t.id=a.team_id),'galleries',a.gallery_groups,'people',coalesce((select jsonb_agg(jsonb_build_object('name',p->>'name','role',p->>'role','photo_path',p->>'photo_path')) from jsonb_array_elements(a.people_snapshot) p),'[]'::jsonb),'event',a.event_snapshot-array['description','source_id']) order by a.position,a.created_at) from public.editorial_articles a where a.issue_id=i.id and a.status<>'waived' and (a.kind<>'coach' or (a.status='ready' and btrim(a.body)<>''))),'[]'::jsonb))
  from public.editorial_issues i where i.id=target;
$$;
