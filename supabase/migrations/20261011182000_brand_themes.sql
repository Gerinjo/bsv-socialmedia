-- Only public design settings live here; account data stays in its existing tables.
alter table public.social_brand_settings add column theme_key text not null default 'football'
  check(theme_key in ('football','christmas','easter','summer'));

create or replace function public.suite_brand_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare colors jsonb:=payload->'colorScheme'; updated jsonb;
begin
 if not exists(select 1 from public.social_admins where user_id=actor and is_active and not is_blocked and (role='admin' or 'corporate_identity'=any(access_areas))) then return jsonb_build_object('error','Keine Berechtigung für Corporate Identity.','status',403);end if;
 if colors is null or jsonb_typeof(colors)<>'object' then return jsonb_build_object('error','Ungültige BSV-Standardfarben.','status',400);end if;
 if (select count(*) from jsonb_each_text(colors) e where e.key=any(array['background','panel','primary','accent','muted','surface','ink']) and e.value ~ '^#[0-9a-fA-F]{6}$')<>7 then return jsonb_build_object('error','Ungültige BSV-Standardfarben.','status',400);end if;
 if payload ? 'themeKey' and (jsonb_typeof(payload->'themeKey')<>'string' or payload->>'themeKey' not in ('football','christmas','easter','summer')) then return jsonb_build_object('error','Ungültiges BSV-Theme.','status',400);end if;
 select jsonb_object_agg(e.key,lower(e.value)) into colors from jsonb_each_text(colors) e where e.key=any(array['background','panel','primary','accent','muted','surface','ink']);
 update public.social_brand_settings set color_scheme=colors,theme_key=case when payload ? 'themeKey' then payload->>'themeKey' else theme_key end,updated_at=now() where id=true;
 with changes as (update public.social_teams set color_scheme=colors where color_source='global' returning id,active,content_enabled) select coalesce(jsonb_agg(to_jsonb(changes)),'[]') into updated from changes;
 return jsonb_build_object('teams',updated);
end $$;
revoke all on function public.suite_brand_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.suite_brand_request(uuid,jsonb) to service_role;

-- Previewed design becomes part of the existing immutable publication snapshot.
alter table public.editorial_issues add column brand_settings jsonb;
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
    'articles',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'body',a.body,'author',a.author,'kind',a.kind,'status',a.status,'automatic_sports',a.automatic_sports,'team_photo',case when a.kind='sports' and a.source_snapshot#>>'{teamPhoto,photo_path}' is not null then jsonb_build_object('photo_path',a.source_snapshot#>>'{teamPhoto,photo_path}','alt',a.source_snapshot#>>'{teamPhoto,alt}') else null end,'team_slug',(select t.slug from public.social_teams t where t.id=a.team_id),'galleries',a.gallery_groups,'people',coalesce((select jsonb_agg(jsonb_build_object('name',p->>'name','role',p->>'role','photo_path',p->>'photo_path')) from jsonb_array_elements(a.people_snapshot) p),'[]'::jsonb),'event',a.event_snapshot-array['description','source_id']) order by a.position,a.created_at) from public.editorial_articles a where a.issue_id=i.id and a.status<>'waived' and (a.kind<>'coach' or (a.status='ready' and btrim(a.body)<>''))),'[]'::jsonb))
  from public.editorial_issues i where i.id=target;
$$;

revoke all on function private.editorial_snapshot(uuid) from public,anon,authenticated;
grant execute on function private.editorial_snapshot(uuid) to service_role;
