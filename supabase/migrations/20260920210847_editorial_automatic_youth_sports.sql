alter table public.editorial_articles add column automatic_sports boolean not null default false;
alter table public.editorial_articles add constraint editorial_automatic_sports_kind check(not automatic_sports or kind='sports');

-- Runs after the regular version/reset trigger. Only a generated, unaltered
-- source body is automatically approved; an empty or changed body stays pending.
create function private.editorial_automatic_sports() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.automatic_sports then
    new.approved_by:=null;
    if btrim(new.body)<>'' and new.body=new.source_snapshot->>'generatedBody'
       and coalesce(new.source_snapshot->>'autoApprovalEligible','false')='true' then
      new.status:='ready';
      new.approved_at:=clock_timestamp();
    else
      new.status:='draft';
      new.approved_at:=null;
    end if;
  end if;
  return new;
end $$;
create trigger editorial_articles_zz_automatic_sports before insert or update on public.editorial_articles for each row execute function private.editorial_automatic_sports();
revoke all on function private.editorial_automatic_sports() from public,anon,authenticated;
grant execute on function private.editorial_automatic_sports() to service_role;

-- Existing youth sources are refreshed once to adopt the generated-body guard.
update public.editorial_articles a set automatic_sports=true
from public.social_teams t where a.team_id=t.id and a.kind='sports'
and lower(coalesce(to_jsonb(t)->>'slug','')||' '||coalesce(to_jsonb(t)->>'website_path','')||' '||coalesce(to_jsonb(t)->>'name',''))
~ '(^|[^a-z0-9])u(12|13|14|15|16|17|18|19)([^0-9]|$)|(^|[^a-z])([a-d])[1-9]?[- ](jugend|junior)';

create or replace function public.create_editorial_issue(issue jsonb,articles jsonb,actor uuid)
returns public.editorial_issues language plpgsql security invoker set search_path='' as $$
declare result public.editorial_issues;
begin
  insert into public.editorial_issues(title,kind,starts_on,closes_on,publishes_on,created_by)
  values(issue->>'title',issue->>'kind',(issue->>'starts_on')::date,(issue->>'closes_on')::date,(issue->>'publishes_on')::date,actor) returning * into result;
  insert into public.editorial_articles(issue_id,title,kind,template_key,team_id,position,updated_by,automatic_sports)
  select result.id,a->>'title',a->>'kind',a->>'template_key',(a->>'team_id')::uuid,(a->>'position')::integer,actor,coalesce((a->>'automatic_sports')::boolean,false) from jsonb_array_elements(articles) a;
  select * into result from public.editorial_issues where id=result.id;
  return result;
end $$;

create or replace function private.editorial_snapshot(target uuid) returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('schemaVersion',1,'id',i.id,'version',i.version,'title',i.title,'kind',i.kind,'publishes_on',i.publishes_on,
    'advertising',i.advertising,'cover_path',i.cover_path,'cover_alt',i.cover_alt,'cover_credit',i.cover_credit,
    'articles',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'body',a.body,'author',a.author,'kind',a.kind,'status',a.status,'automatic_sports',a.automatic_sports,'event',a.event_snapshot-array['description','source_id']) order by a.position,a.created_at) from public.editorial_articles a where a.issue_id=i.id),'[]'::jsonb))
  from public.editorial_issues i where i.id=target;
$$;


create or replace function public.publish_editorial_issue(target uuid,expected_version integer,actor uuid) returns public.editorial_issues language plpgsql security invoker set search_path='' as $$
declare i public.editorial_issues; frozen jsonb;
begin
  select * into strict i from public.editorial_issues where id=target for update;
  if i.kind<>'stadium' then raise exception 'Newsletterversand ist noch nicht eingerichtet.'; end if;
  if i.version<>expected_version then raise exception 'Die Ausgabe wurde geändert. Bitte erneut prüfen.'; end if;
  if i.published_version=i.version then return i; end if;
  if i.cover_path is null then raise exception 'Bitte zuerst ein Titelbild hochladen.'; end if;
  if exists(select 1 from public.editorial_articles where issue_id=target and automatic_sports and (status<>'ready' or btrim(body)='')) then raise exception 'Bitte die Jugend-Sportdaten aktualisieren. Eine manuelle Freigabe ist nicht erforderlich.'; end if;
  if not exists(select 1 from public.editorial_articles where issue_id=target)
    or exists(select 1 from public.editorial_articles where issue_id=target and (status<>'ready' or btrim(body)='')) then
    raise exception 'Bitte zuerst alle Beiträge freigeben.';
  end if;
  if i.previewed_version is distinct from i.version then raise exception 'Bitte zuerst die aktuelle Heftvorschau öffnen.'; end if;
  frozen:=private.editorial_snapshot(target)||jsonb_build_object('published_at',now());
  insert into public.editorial_publications(issue_id,issue_version,snapshot,published_by) values(target,i.version,frozen,actor);
  update public.editorial_issues set published_version=i.version,published_at=now() where id=target returning * into i;
  return i;
end $$;
