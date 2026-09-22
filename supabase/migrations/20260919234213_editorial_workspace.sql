-- Editorial writes go through the authenticated admin API, like the other suite modules.
alter table public.social_admins drop constraint social_admins_access_areas_check;
alter table public.social_admins add constraint social_admins_access_areas_check check (
  access_areas <@ array['social_media','sponsoring','editorial','administration','user_management']::text[] and cardinality(access_areas) > 0
);
create table public.editorial_issues (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('stadium','newsletter')),
  title text not null check (length(trim(title)) between 1 and 180),
  starts_on date not null, closes_on date not null, publishes_on date not null,
  version integer not null default 1,
  created_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (starts_on <= closes_on and closes_on <= publishes_on)
);
create index editorial_issues_publish_idx on public.editorial_issues(publishes_on);
create table public.editorial_articles (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.editorial_issues(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 180),
  kind text not null default 'free' check (kind in ('free','board','youth','coach','sports')),
  template_key text,
  team_id uuid references public.social_teams(id) on delete restrict,
  department_id uuid references public.social_post_audiences(id) on delete restrict,
  author text not null default '' check (length(author) <= 180),
  body text not null default '' check (length(body) <= 30000),
  original_body text not null default '' check (length(original_body) <= 30000),
  status text not null default 'draft' check (status in ('draft','review','ready')),
  position integer not null default 0,
  source_snapshot jsonb,
  version integer not null default 1,
  updated_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(issue_id, template_key)
);
create index editorial_articles_issue_idx on public.editorial_articles(issue_id, position);
create index editorial_articles_team_idx on public.editorial_articles(team_id);
create index editorial_articles_department_idx on public.editorial_articles(department_id);
create table public.editorial_article_revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.editorial_articles(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(article_id, version)
);
create function private.editorial_version() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end $$;
create function private.editorial_revision() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.editorial_article_revisions(article_id,version,snapshot) values(new.id,new.version,to_jsonb(new));
  return new;
end $$;
create trigger editorial_issues_version before update on public.editorial_issues for each row execute function private.editorial_version();
create trigger editorial_articles_version before update on public.editorial_articles for each row execute function private.editorial_version();
create trigger editorial_articles_revision after insert or update on public.editorial_articles for each row execute function private.editorial_revision();
-- A single transaction creates the issue and all mandatory contributions.
create function public.create_editorial_issue(issue jsonb, articles jsonb, actor uuid)
returns public.editorial_issues language plpgsql security invoker set search_path = '' as $$
declare result public.editorial_issues;
begin
  insert into public.editorial_issues(title,kind,starts_on,closes_on,publishes_on,created_by)
  values(issue->>'title',issue->>'kind',(issue->>'starts_on')::date,(issue->>'closes_on')::date,(issue->>'publishes_on')::date,actor) returning * into result;
  insert into public.editorial_articles(issue_id,title,kind,template_key,team_id,position,updated_by)
  select result.id,a->>'title',a->>'kind',a->>'template_key',(a->>'team_id')::uuid,(a->>'position')::integer,actor from jsonb_array_elements(articles) a;
  return result;
end $$;
alter table public.editorial_issues enable row level security;
alter table public.editorial_articles enable row level security;
alter table public.editorial_article_revisions enable row level security;
revoke all on public.editorial_issues, public.editorial_articles, public.editorial_article_revisions from public, anon, authenticated;
grant select, insert, update, delete on public.editorial_issues, public.editorial_articles, public.editorial_article_revisions to service_role;
revoke all on function public.create_editorial_issue(jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.create_editorial_issue(jsonb,jsonb,uuid) to service_role;
revoke all on function private.editorial_version(), private.editorial_revision() from public, anon, authenticated;
grant execute on function private.editorial_version(), private.editorial_revision() to service_role;
