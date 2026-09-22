-- Team photographs use immutable files in the existing private image bucket.
create or replace function private.editorial_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='editorial_issues' then
    if (to_jsonb(new)-array['version','updated_at','previewed_version','published_at','published_version']) is distinct from (to_jsonb(old)-array['version','updated_at','previewed_version','published_at','published_version']) then
      new.version:=old.version+1;
    elsif new.version<>old.version then
      new.version:=old.version+1;
    end if;
  else
    new.version:=old.version+1;
    if (new.title,new.body,new.author,new.department_id,new.event_snapshot,new.people_snapshot,new.gallery_groups,new.source_snapshot->'teamPhoto') is distinct from (old.title,old.body,old.author,old.department_id,old.event_snapshot,old.people_snapshot,old.gallery_groups,old.source_snapshot->'teamPhoto') then
      new.status:=case when btrim(new.body)='' then 'draft' else 'review' end;
      new.approved_by:=null;new.approved_at:=null;
    end if;
    if new.status<>'ready' then new.approved_by:=null;new.approved_at:=null;end if;
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;

create or replace function private.editorial_snapshot(target uuid) returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('schemaVersion',1,'id',i.id,'version',i.version,'title',i.title,'kind',i.kind,'publishes_on',i.publishes_on,
    'advertising',i.advertising,'cover_path',i.cover_path,'cover_alt',i.cover_alt,'cover_credit',i.cover_credit,
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
      where t.active and t.slug ~ '^(herren|frauen)-[1-9][0-9]*$'), '[]'::jsonb),
    'articles',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'body',a.body,'author',a.author,'kind',a.kind,'status',a.status,'automatic_sports',a.automatic_sports,'team_photo',case when a.kind='sports' and a.source_snapshot#>>'{teamPhoto,photo_path}' is not null then jsonb_build_object('photo_path',a.source_snapshot#>>'{teamPhoto,photo_path}','alt',a.source_snapshot#>>'{teamPhoto,alt}') else null end,'team_slug',(select t.slug from public.social_teams t where t.id=a.team_id),'galleries',a.gallery_groups,'people',coalesce((select jsonb_agg(jsonb_build_object('name',p->>'name','role',p->>'role','photo_path',p->>'photo_path')) from jsonb_array_elements(a.people_snapshot) p),'[]'::jsonb),'event',a.event_snapshot-array['description','source_id']) order by a.position,a.created_at) from public.editorial_articles a where a.issue_id=i.id),'[]'::jsonb))
  from public.editorial_issues i where i.id=target;
$$;


