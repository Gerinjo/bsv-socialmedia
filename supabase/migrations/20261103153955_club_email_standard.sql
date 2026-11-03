create schema if not exists private;
grant usage on schema private to service_role;
-- Public sponsor snapshots only. Never store recipients, subjects, bodies or keys.
create table private.email_sponsor_snapshots (
 key_hash text primary key check(key_hash ~ '^[0-9a-f]{64}$'),
 sponsors jsonb not null check(jsonb_typeof(sponsors)='array' and jsonb_array_length(sponsors)<=4 and octet_length(sponsors::text)<=12000),
 created_at timestamptz not null default now()
);
alter table private.email_sponsor_snapshots enable row level security;
revoke all on private.email_sponsor_snapshots from public,anon,authenticated;
grant select,insert,update,delete on private.email_sponsor_snapshots to service_role;
create index email_sponsor_snapshots_created_at_idx on private.email_sponsor_snapshots(created_at);
create function public.email_sponsor_snapshot(snapshot_key text,candidates jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare saved jsonb;
begin
 if snapshot_key is null or snapshot_key !~ '^[0-9a-f]{64}$' or candidates is null or jsonb_typeof(candidates)<>'array' or jsonb_array_length(candidates)>4 or octet_length(candidates::text)>12000 then raise exception 'Invalid sponsor snapshot';end if;
 if exists(select 1 from jsonb_array_elements(candidates) s where jsonb_typeof(s)<>'object' or not s ?& array['id','name','website','logo','width','height'] or exists(select 1 from jsonb_object_keys(s) keys(k) where k<>all(array['id','name','website','logo','width','height'])) or coalesce(s->>'id','')='' or coalesce(s->>'name','')='' or s->>'website' !~ '^https?://' or s->>'logo' !~ '^https://bsvnordstern[.]de/images/sponsors/' or (s->>'width')::int not between 1 and 112 or (s->>'height')::int not between 1 and 64) then raise exception 'Invalid public sponsor information';end if;
 delete from private.email_sponsor_snapshots where created_at<now()-interval '48 hours';
 insert into private.email_sponsor_snapshots as current(key_hash,sponsors) values(snapshot_key,candidates)
 on conflict(key_hash) do update set sponsors=current.sponsors returning sponsors into saved;
 return saved;
end $$;
revoke all on function public.email_sponsor_snapshot(text,jsonb) from public,anon,authenticated;
grant execute on function public.email_sponsor_snapshot(text,jsonb) to service_role;
