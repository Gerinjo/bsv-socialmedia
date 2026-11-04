begin;
do $$
declare p text:='cache-test/portrait.jpg';u text:='https://example.supabase.co/storage/v1/object/sign/trainer-portraits/cache-test/portrait.jpg?token=test';r jsonb;
begin
 if has_function_privilege('anon','public.portrait_url_cache_request(jsonb)','execute') or has_function_privilege('authenticated','public.portrait_url_cache_request(jsonb)','execute') then raise exception 'Image capabilities must remain service-only';end if;
 if has_table_privilege('anon','private.portrait_url_cache','select') or has_table_privilege('authenticated','private.portrait_url_cache','select') then raise exception 'Cache is exposed';end if;
 if not (select relrowsecurity from pg_class where oid='private.portrait_url_cache'::regclass) then raise exception 'Cache requires RLS';end if;
 perform public.portrait_url_cache_request(jsonb_build_object('action','put','variant','original','items',jsonb_build_array(jsonb_build_object('bucket','trainer-portraits','path',p,'url',u,'expiresAt',now()+interval '1 hour'))));
 if (select expires_at>now()+interval '50 minutes' from private.portrait_url_cache where path=p) then raise exception 'Excessive cache lifetime';end if;
 r:=public.portrait_url_cache_request(jsonb_build_object('action','get','variant','original','items',jsonb_build_array(jsonb_build_object('bucket','trainer-portraits','path',p))));
 if jsonb_array_length(r->'entries')<>1 then raise exception 'Persisted URL missing';end if;
 r:=public.portrait_url_cache_request(jsonb_build_object('action','get','variant','website-900-q95','items',jsonb_build_array(jsonb_build_object('bucket','trainer-portraits','path',p))));
 if jsonb_array_length(r->'entries')<>0 then raise exception 'Image variants are mixed';end if;
 update private.portrait_url_cache set expires_at=now()+interval '4 minutes' where path=p;
 r:=public.portrait_url_cache_request(jsonb_build_object('action','get','variant','original','items',jsonb_build_array(jsonb_build_object('bucket','trainer-portraits','path',p))));
 if jsonb_array_length(r->'entries')<>0 then raise exception 'Expiring URL was reused';end if;
 begin
  perform public.portrait_url_cache_request('{"action":"get","variant":"original","items":[{"bucket":"cashbook-evidence","path":"private"}]}');
  raise exception 'Private non-portrait bucket accepted';
 exception when raise_exception then if sqlerrm<>'Ungültiger Bildbestand' then raise;end if;end;
end $$;
set local role service_role;
select public.portrait_url_cache_request('{"action":"get","variant":"original","items":[]}')='{"entries":[]}'::jsonb as service_role_can_read;
reset role;
rollback;
