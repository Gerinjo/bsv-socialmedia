-- Shared editorial defaults, accessible only through the authorized admin API.
create table public.editorial_cover_defaults (
  singleton boolean primary key default true check (singleton),
  settings jsonb not null check (jsonb_typeof(settings)='object' and octet_length(settings::text)<=65536),
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);
alter table public.editorial_cover_defaults enable row level security;
revoke all on public.editorial_cover_defaults from public,anon,authenticated;
grant select,insert,update on public.editorial_cover_defaults to service_role;

-- Save this cover and the reusable template together, with the usual version guard.
create function public.save_editorial_cover_defaults(target uuid,expected_version integer,settings jsonb,actor uuid)
returns public.editorial_issues language plpgsql security invoker set search_path='' as $$
declare result public.editorial_issues; template jsonb;
begin
  select * into strict result from public.editorial_issues where id=target for update;
  if result.kind<>'stadium' or result.version<>expected_version then
    raise exception 'Die Ausgabe wurde geändert. Bitte neu laden.';
  end if;
  -- Resolve under the issue lock: article changes acquire the same lock.
  if exists(select 1 from jsonb_array_elements(settings->'articles') item
    where not exists(select 1 from public.editorial_articles a where a.issue_id=target and a.id::text=item->>'id' and a.kind<>'sports')) then
    raise exception 'Die Auswahl enthält nicht verfügbare Beiträge. Bitte neu laden.';
  end if;
  template:=jsonb_set(settings,'{articles}',coalesce((
    select jsonb_agg(jsonb_build_object('template_key',a.template_key,'alias',item->>'alias') order by ord)
    from jsonb_array_elements(settings->'articles') with ordinality as selection(item,ord)
    join public.editorial_articles a on a.issue_id=target and a.id::text=item->>'id'
    where a.template_key is not null and a.kind in ('board','youth','coach')
  ),'[]'::jsonb));
  update public.editorial_issues set cover_settings=settings where id=target returning * into result;
  insert into public.editorial_cover_defaults(singleton,settings,updated_by) values(true,template,actor)
  on conflict(singleton) do update set settings=excluded.settings,updated_by=excluded.updated_by,updated_at=now();
  return result;
end $$;
revoke all on function public.save_editorial_cover_defaults(uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_editorial_cover_defaults(uuid,integer,jsonb,uuid) to service_role;

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
      where exists(select 1 from public.social_teams t where t.slug=selection.slug and t.active);
      template:=jsonb_set(template,'{teamSlugs}',mapped);
      update public.editorial_issues set cover_settings=template where id=result.id;
    end if;
  end if;
  select * into result from public.editorial_issues where id=result.id;
  return result;
end $$;
