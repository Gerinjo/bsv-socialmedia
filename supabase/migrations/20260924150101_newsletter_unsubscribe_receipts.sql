-- Tracks notification delivery only; Resend remains the subscription authority.
-- No addresses, personal unsubscribe links or complete webhook bodies are stored.
create table public.newsletter_unsubscribe_receipts (
  contact_id uuid primary key,
  event_at timestamptz not null,
  unsubscribed boolean not null,
  notification_id uuid,
  status text not null default 'none' check (status in ('none','pending','processing','sent','skipped','needs_review')),
  first_attempt_at timestamptz,
  lease_id uuid,
  leased_until timestamptz,
  provider_id text,
  updated_at timestamptz not null default now()
);
alter table public.newsletter_unsubscribe_receipts enable row level security;
revoke all on public.newsletter_unsubscribe_receipts from public, anon, authenticated;
grant select, insert, update on public.newsletter_unsubscribe_receipts to service_role;
create policy newsletter_unsubscribe_receipts_private on public.newsletter_unsubscribe_receipts
  for all to anon, authenticated using (false) with check (false);

create function public.claim_newsletter_unsubscribe_receipt(p_contact_id uuid, p_event_at timestamptz, p_unsubscribed boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item public.newsletter_unsubscribe_receipts;
begin
  insert into public.newsletter_unsubscribe_receipts(contact_id,event_at,unsubscribed)
    values(p_contact_id,p_event_at,p_unsubscribed) on conflict do nothing;
  select * into item from public.newsletter_unsubscribe_receipts where contact_id=p_contact_id for update;
  if p_event_at < item.event_at or (p_event_at=item.event_at and p_unsubscribed<>item.unsubscribed) then
    return jsonb_build_object('status','ignored');
  end if;
  if not p_unsubscribed then
    update public.newsletter_unsubscribe_receipts set event_at=p_event_at,unsubscribed=false,status='none',
      notification_id=null,first_attempt_at=null,lease_id=null,leased_until=null,provider_id=null,updated_at=now() where contact_id=p_contact_id;
    return jsonb_build_object('status','ignored');
  end if;
  if not item.unsubscribed or item.notification_id is null then
    update public.newsletter_unsubscribe_receipts set notification_id=gen_random_uuid(),status='pending',
      first_attempt_at=null,lease_id=null,leased_until=null,provider_id=null where contact_id=p_contact_id;
  end if;
  update public.newsletter_unsubscribe_receipts set event_at=p_event_at,unsubscribed=true,updated_at=now()
    where contact_id=p_contact_id returning * into item;
  if item.status in ('sent','skipped','needs_review') then return jsonb_build_object('status',item.status); end if;
  if item.leased_until > now() then return jsonb_build_object('status','busy'); end if;
  -- Resend keeps idempotency keys for 24 hours. An ambiguous old send needs review.
  if item.first_attempt_at < now()-interval '23 hours' then
    update public.newsletter_unsubscribe_receipts set status='needs_review',lease_id=null,leased_until=null where contact_id=p_contact_id;
    return jsonb_build_object('status','needs_review');
  end if;
  update public.newsletter_unsubscribe_receipts set status='processing',lease_id=gen_random_uuid(),leased_until=now()+interval '2 minutes',
    first_attempt_at=coalesce(first_attempt_at,now()) where contact_id=p_contact_id returning * into item;
  return jsonb_build_object('status','processing','notification_id',item.notification_id,'lease_id',item.lease_id);
end $$;

create function public.finish_newsletter_unsubscribe_receipt(p_contact_id uuid,p_lease_id uuid,p_status text,p_provider_id text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_status not in ('pending','sent','skipped') then raise exception 'Invalid notification status'; end if;
  update public.newsletter_unsubscribe_receipts set status=p_status,provider_id=p_provider_id,
    lease_id=null,leased_until=null,updated_at=now() where contact_id=p_contact_id and lease_id=p_lease_id;
  return found;
end $$;
revoke all on function public.claim_newsletter_unsubscribe_receipt(uuid,timestamptz,boolean), public.finish_newsletter_unsubscribe_receipt(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_newsletter_unsubscribe_receipt(uuid,timestamptz,boolean), public.finish_newsletter_unsubscribe_receipt(uuid,uuid,text,text) to service_role;
