alter table public.editorial_issues add column advertising jsonb check(advertising is null or (jsonb_typeof(advertising)='object' and advertising ? 'issueDate' and advertising ? 'ads' and jsonb_typeof(advertising->'ads')='array'));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('editorial-advertisements','editorial-advertisements',false,26214400,array['image/png'])
on conflict(id) do nothing;
-- Previous previews omitted the advertising inventory and must be reviewed again.
update public.editorial_issues set version=version+1 where kind='stadium';

create or replace function private.editorial_snapshot(target uuid) returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('schemaVersion',1,'id',i.id,'version',i.version,'title',i.title,'kind',i.kind,'publishes_on',i.publishes_on,
    'advertising',i.advertising,'cover_path',i.cover_path,'cover_alt',i.cover_alt,'cover_credit',i.cover_credit,
    'articles',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'body',a.body,'author',a.author,'kind',a.kind,'status',a.status,'event',a.event_snapshot-array['description','source_id']) order by a.position,a.created_at) from public.editorial_articles a where a.issue_id=i.id),'[]'::jsonb))
  from public.editorial_issues i where i.id=target;
$$;

create or replace function public.preview_editorial_issue(target uuid,expected_version integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare i public.editorial_issues;
begin
  select * into strict i from public.editorial_issues where id=target for update;
  if i.version<>expected_version then raise exception 'Die Ausgabe wurde geändert. Bitte neu laden und die aktuelle Fassung ansehen.'; end if;
  if i.kind='stadium' and (i.advertising is null or i.advertising->>'issueDate' is distinct from i.publishes_on::text) then raise exception 'Bitte zuerst den Anzeigenstand für das Heftdatum laden.'; end if;
  update public.editorial_issues set previewed_version=i.version where id=target;
  return private.editorial_snapshot(target);
end $$;
