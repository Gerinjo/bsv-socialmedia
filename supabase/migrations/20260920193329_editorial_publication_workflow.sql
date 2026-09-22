alter table public.editorial_issues
  add column cover_path text,
  add column cover_alt text not null default '' check(length(cover_alt)<=300),
  add column cover_credit text not null default '' check(length(cover_credit)<=300),
  add column previewed_version integer,
  add column published_version integer,
  add column published_at timestamptz;
alter table public.editorial_articles drop constraint editorial_articles_kind_check;
alter table public.editorial_articles add constraint editorial_articles_kind_check check(kind in ('free','board','youth','coach','sports','event'));
alter table public.editorial_articles
  add column event_snapshot jsonb,
  add column approved_by uuid,
  add column approved_at timestamptz;
create table public.editorial_publications (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.editorial_issues(id) on delete restrict,
  issue_version integer not null,
  snapshot jsonb not null,
  published_by uuid not null,
  published_at timestamptz not null default now(),
  unique(issue_id,issue_version)
);
alter table public.editorial_publications enable row level security;
revoke all on public.editorial_publications from public,anon,authenticated;
grant select,insert on public.editorial_publications to service_role;
-- Read-back is needed for previews; the bucket itself is never public.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('editorial-covers','editorial-covers',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

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
    if (new.title,new.body,new.author,new.department_id,new.event_snapshot) is distinct from (old.title,old.body,old.author,old.department_id,old.event_snapshot) then
      new.status:=case when btrim(new.body)='' then 'draft' else 'review' end;
      new.approved_by:=null;new.approved_at:=null;
    end if;
    if new.status<>'ready' then new.approved_by:=null;new.approved_at:=null;end if;
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;
create function private.editorial_touch_issue() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  -- Serializes edits, approval, preview and publication on the same parent row.
  update public.editorial_issues set version=version+1 where id=case when tg_op='DELETE' then old.issue_id else new.issue_id end;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger editorial_articles_touch_issue before insert or update or delete on public.editorial_articles for each row execute function private.editorial_touch_issue();
revoke all on function private.editorial_touch_issue() from public,anon,authenticated;
grant execute on function private.editorial_touch_issue() to service_role;

create function private.editorial_snapshot(target uuid) returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('schemaVersion',1,'id',i.id,'version',i.version,'title',i.title,'kind',i.kind,'publishes_on',i.publishes_on,
    'cover_path',i.cover_path,'cover_alt',i.cover_alt,'cover_credit',i.cover_credit,
    'articles',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'body',a.body,'author',a.author,'kind',a.kind,'status',a.status,'event',a.event_snapshot-array['description','source_id']) order by a.position,a.created_at) from public.editorial_articles a where a.issue_id=i.id),'[]'::jsonb))
  from public.editorial_issues i where i.id=target;
$$;
revoke all on function private.editorial_snapshot(uuid) from public,anon,authenticated;
grant execute on function private.editorial_snapshot(uuid) to service_role;

create function public.preview_editorial_issue(target uuid,expected_version integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare i public.editorial_issues;
begin
  select * into strict i from public.editorial_issues where id=target for update;
  if i.version<>expected_version then raise exception 'Die Ausgabe wurde geändert. Bitte neu laden und die aktuelle Fassung ansehen.'; end if;
  update public.editorial_issues set previewed_version=i.version where id=target;
  return private.editorial_snapshot(target);
end $$;
create function public.publish_editorial_issue(target uuid,expected_version integer,actor uuid) returns public.editorial_issues language plpgsql security invoker set search_path='' as $$
declare i public.editorial_issues; frozen jsonb;
begin
  select * into strict i from public.editorial_issues where id=target for update;
  if i.kind<>'stadium' then raise exception 'Newsletterversand ist noch nicht eingerichtet.'; end if;
  if i.version<>expected_version then raise exception 'Die Ausgabe wurde geändert. Bitte erneut prüfen.'; end if;
  if i.published_version=i.version then return i; end if;
  if i.cover_path is null then raise exception 'Bitte zuerst ein Titelbild hochladen.'; end if;
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
revoke all on function public.preview_editorial_issue(uuid,integer),public.publish_editorial_issue(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.preview_editorial_issue(uuid,integer),public.publish_editorial_issue(uuid,integer,uuid) to service_role;

create or replace function public.create_editorial_issue(issue jsonb,articles jsonb,actor uuid)
returns public.editorial_issues language plpgsql security invoker set search_path='' as $$
declare result public.editorial_issues;
begin
  insert into public.editorial_issues(title,kind,starts_on,closes_on,publishes_on,created_by)
  values(issue->>'title',issue->>'kind',(issue->>'starts_on')::date,(issue->>'closes_on')::date,(issue->>'publishes_on')::date,actor) returning * into result;
  insert into public.editorial_articles(issue_id,title,kind,template_key,team_id,position,updated_by)
  select result.id,a->>'title',a->>'kind',a->>'template_key',(a->>'team_id')::uuid,(a->>'position')::integer,actor from jsonb_array_elements(articles) a;
  select * into result from public.editorial_issues where id=result.id;
  return result;
end $$;
