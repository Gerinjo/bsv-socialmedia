begin;
set local role service_role;
do $$
declare r jsonb; first_id uuid; first_lease uuid; next_id uuid; c uuid:='10000000-0000-4000-8000-000000000001';
begin
  r:=public.claim_newsletter_unsubscribe_receipt(c,'2026-09-24 10:00Z',true);
  if r->>'status'<>'processing' then raise exception 'First opt-out not claimed'; end if;
  first_id:=(r->>'notification_id')::uuid;first_lease:=(r->>'lease_id')::uuid;
  if public.claim_newsletter_unsubscribe_receipt(c,'2026-09-24 10:00Z',true)->>'status'<>'busy' then raise exception 'Concurrent delivery not blocked'; end if;
  if public.finish_newsletter_unsubscribe_receipt(c,gen_random_uuid(),'sent','bad') then raise exception 'Wrong lease accepted'; end if;
  perform public.finish_newsletter_unsubscribe_receipt(c,first_lease,'pending');
  r:=public.claim_newsletter_unsubscribe_receipt(c,'2026-09-24 10:00Z',true);
  if (r->>'notification_id')::uuid<>first_id or (r->>'lease_id')::uuid=first_lease then raise exception 'Retry has wrong identity'; end if;
  perform public.finish_newsletter_unsubscribe_receipt(c,(r->>'lease_id')::uuid,'sent','provider-one');
  if public.claim_newsletter_unsubscribe_receipt(c,'2026-09-24 10:01Z',true)->>'status'<>'sent' then raise exception 'Duplicate opt-out sends again'; end if;
  if public.claim_newsletter_unsubscribe_receipt(c,'2026-09-24 09:00Z',false)->>'status'<>'ignored' then raise exception 'Stale opt-in accepted'; end if;
  perform public.claim_newsletter_unsubscribe_receipt(c,'2026-09-24 11:00Z',false);
  if public.claim_newsletter_unsubscribe_receipt(c,'2026-09-24 10:59Z',true)->>'status'<>'ignored' then raise exception 'Stale opt-out accepted'; end if;
  r:=public.claim_newsletter_unsubscribe_receipt(c,'2026-09-24 12:00Z',true);
  next_id:=(r->>'notification_id')::uuid;
  if next_id=first_id or r->>'status'<>'processing' then raise exception 'New opt-out period not notified'; end if;
  perform public.finish_newsletter_unsubscribe_receipt(c,(r->>'lease_id')::uuid,'pending');
  update public.newsletter_unsubscribe_receipts set first_attempt_at=now()-interval '24 hours' where contact_id=c;
  if public.claim_newsletter_unsubscribe_receipt(c,'2026-09-24 12:00Z',true)->>'status'<>'needs_review' then raise exception 'Expired idempotency window reused'; end if;
end $$;
reset role;
do $$
begin
  if has_table_privilege('anon','public.newsletter_unsubscribe_receipts','SELECT') or has_table_privilege('authenticated','public.newsletter_unsubscribe_receipts','UPDATE') then raise exception 'Receipt data exposed'; end if;
  if has_function_privilege('anon','public.claim_newsletter_unsubscribe_receipt(uuid,timestamptz,boolean)','EXECUTE') then raise exception 'Claims exposed'; end if;
  if has_function_privilege('authenticated','public.finish_newsletter_unsubscribe_receipt(uuid,uuid,text,text)','EXECUTE') then raise exception 'Delivery changes exposed'; end if;
  if not (select relrowsecurity from pg_class where oid='public.newsletter_unsubscribe_receipts'::regclass) then raise exception 'RLS disabled'; end if;
end $$;
rollback;
