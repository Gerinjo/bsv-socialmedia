-- Keep previously attempted plaintext notifications byte-identical on rollout.
create function public.email_sponsor_snapshot_exists(snapshot_key text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from private.email_sponsor_snapshots where key_hash=snapshot_key and created_at>=now()-interval '48 hours')
$$;
revoke all on function public.email_sponsor_snapshot_exists(text) from public,anon,authenticated;
grant execute on function public.email_sponsor_snapshot_exists(text) to service_role;
