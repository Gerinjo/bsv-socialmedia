-- The four adult teams belong to the magazine regardless of social-media activation.
-- Keep any existing youth coach text/history as an optional contribution.
update public.editorial_articles a set kind='free',template_key=null,position=1000,
  status=case when a.status='waived' then 'draft' else a.status end
where a.kind='coach' and not exists(select 1 from public.social_teams t where t.id=a.team_id and t.slug ~ '^(herren|frauen)-[12]$')
  and (btrim(a.body)<>'' or btrim(a.original_body)<>'' or exists(
    select 1 from public.editorial_article_revisions r where r.article_id=a.id and
    (btrim(coalesce(r.snapshot->>'body',''))<>'' or btrim(coalesce(r.snapshot->>'original_body',''))<>'')));
delete from public.editorial_articles a where a.kind='coach'
  and not exists(select 1 from public.social_teams t where t.id=a.team_id and t.slug ~ '^(herren|frauen)-[12]$');

-- Repair existing issues without replacing their saved content or publication snapshots.
insert into public.editorial_articles(issue_id,title,kind,template_key,team_id,position,updated_by,automatic_sports)
select i.id,case when slot.kind='coach' then
  'Grußwort Trainer · '||split_part(t.slug,'-',2)||'. '||case split_part(t.slug,'-',1) when 'herren' then 'Herrenmannschaft' else 'Frauenmannschaft' end
  else 'Sport · '||t.name end,
  slot.kind,slot.kind||':'||t.id,t.id,coalesce(t.sort_order,100)*2+case when slot.kind='sports' then 1 else 0 end,i.created_by,slot.kind='sports'
from public.editorial_issues i cross join public.social_teams t cross join (values('coach'),('sports')) slot(kind)
where i.kind='stadium' and t.slug ~ '^(herren|frauen)-[12]$'
  and not exists(select 1 from public.editorial_articles a where a.issue_id=i.id and a.kind=slot.kind and a.team_id=t.id)
on conflict(issue_id,template_key) do nothing;

create or replace function private.editorial_snapshot(target uuid) returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('schemaVersion',1,'id',i.id,'version',i.version,'title',i.title,'kind',i.kind,'publishes_on',i.publishes_on,
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

create or replace function public.create_editorial_issue(issue jsonb,articles jsonb,actor uuid)
returns public.editorial_issues language plpgsql security invoker set search_path='' as $$
declare result public.editorial_issues; template jsonb; mapped jsonb;
begin
  insert into public.editorial_issues(title,kind,starts_on,closes_on,publishes_on,created_by)
  values(issue->>'title',issue->>'kind',(issue->>'starts_on')::date,(issue->>'closes_on')::date,(issue->>'publishes_on')::date,actor) returning * into result;
  insert into public.editorial_articles(issue_id,title,kind,template_key,team_id,position,updated_by,automatic_sports)
  select result.id,a->>'title',a->>'kind',a->>'template_key',(a->>'team_id')::uuid,(a->>'position')::integer,actor,coalesce((a->>'automatic_sports')::boolean,false) from jsonb_array_elements(articles) a;
  if result.kind='stadium' then
    select settings into template from public.editorial_cover_defaults where singleton;
    if template is not null then
      select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'alias',item->>'alias') order by ord),'[]'::jsonb) into mapped
      from jsonb_array_elements(template->'articles') with ordinality as selection(item,ord)
      join public.editorial_articles a on a.issue_id=result.id and a.template_key=item->>'template_key' and a.kind in ('board','youth','coach');
      template:=jsonb_set(template,'{articles}',mapped);
      select coalesce(jsonb_agg(slug order by ord),'[]'::jsonb) into mapped
      from jsonb_array_elements_text(template->'teamSlugs') with ordinality as selection(slug,ord)
      where exists(select 1 from public.social_teams t where t.slug=selection.slug and (t.active or t.slug ~ '^(herren|frauen)-[12]$'));
      template:=jsonb_set(template,'{teamSlugs}',mapped);
      update public.editorial_issues set cover_settings=template where id=result.id;
    end if;
  end if;
  select * into result from public.editorial_issues where id=result.id;
  return result;
end $$;
