-- Reuse short-lived image capabilities across Edge Function cold starts.
-- Read fresh authorized directory data first; never cache people or permissions.
create table private.portrait_url_cache (
 bucket text not null check(bucket in ('trainer-portraits','employee-portraits')),
 path text not null check(length(path) between 1 and 1200),
 variant text not null check(variant in ('original','website-900-q95')),
 url text not null check(length(url) between 1 and 5000 and url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/(object/sign|render/image/sign)/'),
 expires_at timestamptz not null,
 primary key(bucket,path,variant)
);
alter table private.portrait_url_cache enable row level security;
revoke all on private.portrait_url_cache from public,anon,authenticated;
grant select,insert,update,delete on private.portrait_url_cache to service_role;

create function public.portrait_url_cache_request(payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare items jsonb:=payload->'items';variant_key text:=payload->>'variant';result jsonb;
begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>256 or variant_key is null or variant_key not in ('original','website-900-q95') then raise exception 'Ungültige Bildabfrage';end if;
 if exists(select 1 from jsonb_array_elements(items) item where coalesce(item->>'bucket','') not in ('trainer-portraits','employee-portraits') or coalesce(length(item->>'path'),0) not between 1 and 1200) then raise exception 'Ungültiger Bildbestand';end if;
 if payload->>'action'='get' then
  select coalesce(jsonb_agg(jsonb_build_object('bucket',c.bucket,'path',c.path,'variant',c.variant,'url',c.url,'expires_at',c.expires_at)),'[]') into result
  from private.portrait_url_cache c join (select distinct item->>'bucket' bucket,item->>'path' path from jsonb_array_elements(items) item) wanted using(bucket,path)
  where c.variant=variant_key and c.expires_at>now()+interval '5 minutes';
  return jsonb_build_object('entries',result);
 elsif payload->>'action'='put' then
  delete from private.portrait_url_cache where expires_at<now()-interval '1 day';
  insert into private.portrait_url_cache(bucket,path,variant,url,expires_at)
  select item->>'bucket',item->>'path',variant_key,item->>'url',least((item->>'expiresAt')::timestamptz,now()+interval '50 minutes')
  from jsonb_array_elements(items) item where (item->>'expiresAt')::timestamptz>now()+interval '5 minutes'
  on conflict(bucket,path,variant) do update set url=excluded.url,expires_at=excluded.expires_at
  where excluded.expires_at>portrait_url_cache.expires_at;
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'Ungültige Bildaktion';
end $$;
revoke all on function public.portrait_url_cache_request(jsonb) from public,anon,authenticated;
grant execute on function public.portrait_url_cache_request(jsonb) to service_role;
