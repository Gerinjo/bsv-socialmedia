-- A deliberate waiver completes a trainer contribution without publishing it.
alter table public.editorial_articles drop constraint editorial_articles_status_check;
alter table public.editorial_articles add constraint editorial_articles_status_check check(status in ('draft','review','ready','waived'));
alter table public.editorial_articles add constraint editorial_articles_waiver_kind_check check(status<>'waived' or kind='coach');

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
    'articles',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'body',a.body,'author',a.author,'kind',a.kind,'status',a.status,'automatic_sports',a.automatic_sports,'team_photo',case when a.kind='sports' and a.source_snapshot#>>'{teamPhoto,photo_path}' is not null then jsonb_build_object('photo_path',a.source_snapshot#>>'{teamPhoto,photo_path}','alt',a.source_snapshot#>>'{teamPhoto,alt}') else null end,'team_slug',(select t.slug from public.social_teams t where t.id=a.team_id),'galleries',a.gallery_groups,'people',coalesce((select jsonb_agg(jsonb_build_object('name',p->>'name','role',p->>'role','photo_path',p->>'photo_path')) from jsonb_array_elements(a.people_snapshot) p),'[]'::jsonb),'event',a.event_snapshot-array['description','source_id']) order by a.position,a.created_at) from public.editorial_articles a where a.issue_id=i.id and a.status<>'waived' and (a.kind<>'coach' or (a.status='ready' and btrim(a.body)<>''))),'[]'::jsonb))
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
    or exists(select 1 from public.editorial_articles where issue_id=target and not (kind='coach' and status='waived') and (status<>'ready' or btrim(body)='')) then
    raise exception 'Bitte zuerst alle Beiträge freigeben oder bei Trainergrußworten bewusst Verzicht auswählen.';
  end if;
  if i.previewed_version is distinct from i.version then raise exception 'Bitte zuerst die aktuelle Heftvorschau öffnen.'; end if;
  frozen:=private.editorial_snapshot(target)||jsonb_build_object('published_at',now());
  insert into public.editorial_publications(issue_id,issue_version,snapshot,published_by) values(target,i.version,frozen,actor);
  update public.editorial_issues set published_version=i.version,published_at=now() where id=target returning * into i;
  return i;
end $$;


-- Older issues only gained missing sports articles on refresh. Add the four
-- adult coach slots without replacing text, custom titles or existing history.
insert into public.editorial_articles(issue_id,title,kind,template_key,team_id,position,updated_by)
select i.id,'Grußwort Trainer · '||split_part(t.slug,'-',2)||'. '||case split_part(t.slug,'-',1) when 'herren' then 'Herrenmannschaft' else 'Frauenmannschaft' end,
  'coach','coach:'||t.id,t.id,
  coalesce((select a.position-1 from public.editorial_articles a where a.issue_id=i.id and a.team_id=t.id and a.kind='sports' order by a.position limit 1),t.sort_order),i.created_by
from public.editorial_issues i cross join public.social_teams t
where i.kind='stadium' and t.active and t.slug ~ '^(herren|frauen)-[12]$'
  and not exists(select 1 from public.editorial_articles a where a.issue_id=i.id and a.kind='coach' and a.team_id=t.id)
on conflict(issue_id,template_key) do nothing;
