-- Official youth appointments and trainer reimbursements are separate from club-referee payouts.
create table public.referee_fee_cases (
 id uuid primary key default gen_random_uuid(),
 source_match_id text not null unique check(source_match_id ~ '^[A-Z0-9]{32}$'),
 source_url text not null,
 team_id uuid not null references public.social_teams(id) on delete restrict,
 home_team text not null, away_team text not null, kickoff_at timestamptz not null,
 game_status text not null check(game_status in ('scheduled','live','finished','postponed','cancelled','aborted')),
 appointment_state text not null check(appointment_state in ('assigned','missing','unknown')),
 checked_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index referee_fee_cases_team_idx on public.referee_fee_cases(team_id,kickoff_at desc);
create table private.referee_bank_accounts (
 person_id uuid primary key references public.social_people(id) on delete restrict,
 encrypted_details text not null,
 iban_last4 text not null check(iban_last4 ~ '^[A-Z0-9]{4}$'),
 source_message_id text not null check(length(source_message_id) between 1 and 200),
 verified_by uuid not null, verified_at timestamptz not null default now(),
 version integer not null default 1
);
create table public.referee_receipts (
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references public.referee_fee_cases(id) on delete restrict,
 person_id uuid not null references public.social_people(id) on delete restrict,
 storage_path text not null unique,
 sha256 text not null unique check(sha256 ~ '^[a-f0-9]{64}$'),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
 created_at timestamptz not null default now()
);
create index referee_receipts_case_idx on public.referee_receipts(case_id);
create index referee_receipts_person_idx on public.referee_receipts(person_id);
create table public.referee_expenses (
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null unique references public.referee_fee_cases(id) on delete restrict,
 person_id uuid not null references public.social_people(id) on delete restrict,
 receipt_id uuid not null references public.referee_receipts(id) on delete restrict,
 amount_cents integer not null check(amount_cents between 1 and 100000),
 ocr_amount_cents integer check(ocr_amount_cents between 1 and 100000),
 status text not null default 'submitted' check(status in ('submitted','rejected','approved','paid')),
 review_note text not null default '' check(length(review_note)<=1000),
 reviewed_by uuid, reviewed_at timestamptz,
 version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index referee_expenses_person_idx on public.referee_expenses(person_id);
create index referee_expenses_receipt_idx on public.referee_expenses(receipt_id);
create index referee_expenses_status_idx on public.referee_expenses(status,created_at);
create table private.referee_expense_events (
 id uuid primary key default gen_random_uuid(), expense_id uuid not null references public.referee_expenses(id),
 snapshot jsonb not null, created_at timestamptz not null default now()
);
create index referee_expense_events_expense_idx on private.referee_expense_events(expense_id);
create table private.referee_payment_orders (
 id uuid primary key default gen_random_uuid(),
 expense_id uuid not null unique references public.referee_expenses(id) on delete restrict,
 person_id uuid not null references public.social_people(id),
 amount_cents integer not null check(amount_cents between 1 and 100000),
 encrypted_destination text not null, iban_last4 text not null,
 account_version integer not null,
 status text not null default 'ready' check(status in ('ready','processing','paid','failed','needs_review')),
 provider_reference text unique,
 approved_by uuid not null, created_at timestamptz not null default now(), paid_at timestamptz,
 check((status='paid') = (paid_at is not null))
);
create index referee_payment_orders_person_idx on private.referee_payment_orders(person_id);
create index referee_payment_orders_status_idx on private.referee_payment_orders(status,created_at);

alter table public.referee_fee_cases enable row level security;
alter table public.referee_receipts enable row level security;
alter table public.referee_expenses enable row level security;
alter table private.referee_bank_accounts enable row level security;
alter table private.referee_expense_events enable row level security;
alter table private.referee_payment_orders enable row level security;
revoke all on public.referee_fee_cases,public.referee_receipts,public.referee_expenses,private.referee_bank_accounts,private.referee_expense_events,private.referee_payment_orders from public,anon,authenticated;
grant select,insert,update on public.referee_fee_cases,public.referee_receipts,public.referee_expenses,private.referee_bank_accounts,private.referee_expense_events,private.referee_payment_orders to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('referee-receipts','referee-receipts',false,8388608,array['image/jpeg','image/png','image/webp','application/pdf']);
-- No storage policies for browser roles: uploads and short-lived URLs use the authorized Edge API.

-- An AFTER trigger is needed for the event foreign key; versioning happens before updates.
create function private.referee_expense_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.status in ('approved','paid') then raise exception 'Freigegebene Erstattungen sind gesperrt.'; end if;
 if new.person_id<>old.person_id or new.case_id<>old.case_id then raise exception 'Erstattungsempfänger und Spiel sind unveränderlich.'; end if;
 new.version:=old.version+1; new.updated_at:=clock_timestamp(); return new;
end $$;
create or replace function private.referee_expense_audit() returns trigger language plpgsql security invoker set search_path='' as $$
begin insert into private.referee_expense_events(expense_id,snapshot) values(new.id,to_jsonb(new)); return new; end $$;
create trigger referee_expense_version before update on public.referee_expenses for each row execute function private.referee_expense_version();
create trigger referee_expense_audit after insert or update on public.referee_expenses for each row execute function private.referee_expense_audit();

create function public.referee_expense_coach_request(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 verified jsonb;
 person uuid:=(payload->>'personId')::uuid; team uuid:=(payload->>'teamId')::uuid;
 fee public.referee_fee_cases; claim public.referee_expenses; receipt public.referee_receipts;
 records jsonb; bank_mask text;
begin
 verified:=public.referee_coach_request(payload || '{"action":"list"}'::jsonb);
 if verified ? 'error' then return verified; end if;
 select iban_last4 into bank_mask from private.referee_bank_accounts where person_id=person;
 if payload->>'action' in ('expense_prepare','expense_submit') then
   select * into fee from public.referee_fee_cases where id=(payload->>'caseId')::uuid and team_id=team for update;
   if not found then return jsonb_build_object('error','Dieses Spiel gehört nicht zu deiner Mannschaft.','status',403); end if;
   if fee.appointment_state<>'assigned' or fee.game_status<>'finished' or fee.kickoff_at>now() or fee.checked_at<now()-interval '48 hours' then
     return jsonb_build_object('error','Das beendete Spiel und die Schiriansetzung müssen aktuell bestätigt sein. Bitte den Admin um einen Abgleich bitten.','status',409);
   end if;
   select * into claim from public.referee_expenses where case_id=fee.id for update;
   if claim.id is not null and (claim.person_id<>person or claim.status<>'rejected') then return jsonb_build_object('error','Für dieses Spiel wurde bereits eine Erstattung eingereicht.','status',409); end if;
   if claim.id is not null and (payload->>'version')::integer is distinct from claim.version then return jsonb_build_object('error','Die Erstattung wurde geändert. Bitte neu laden.','status',409); end if;
   select * into receipt from public.referee_receipts where sha256=payload->>'receiptSha256';
   if receipt.id is not null and (receipt.case_id<>fee.id or receipt.person_id<>person) then return jsonb_build_object('error','Diese Quittung wurde bereits für eine Erstattung verwendet.','status',409); end if;
   if payload->>'action'='expense_prepare' then return jsonb_build_object('ok',true,'receiptExists',receipt.id is not null); end if;
   if coalesce((payload->>'amountCents')::integer,0) not between 1 and 100000 or coalesce((payload->>'confirmed')::boolean,false) is not true then
     return jsonb_build_object('error','Bitte Betrag und vorgestreckte Gebühr bestätigen.','status',400);
   end if;
   if receipt.id is null then
     insert into public.referee_receipts(case_id,person_id,storage_path,sha256,mime_type)
     values(fee.id,person,payload->>'receiptPath',payload->>'receiptSha256',payload->>'receiptMime') returning * into receipt;
   end if;
   if claim.id is null then
     insert into public.referee_expenses(case_id,person_id,receipt_id,amount_cents,ocr_amount_cents)
     values(fee.id,person,receipt.id,(payload->>'amountCents')::integer,(payload->>'ocrAmountCents')::integer);
   else
     update public.referee_expenses set receipt_id=receipt.id,amount_cents=(payload->>'amountCents')::integer,ocr_amount_cents=(payload->>'ocrAmountCents')::integer,status='submitted',review_note='',reviewed_at=null,reviewed_by=null where id=claim.id;
   end if;
 elsif payload->>'action' is distinct from 'expense_list' then return jsonb_build_object('error','Unbekannte Aktion.','status',400);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'home_team',c.home_team,'away_team',c.away_team,'kickoff_at',c.kickoff_at,
   'game_status',c.game_status,'appointment_state',c.appointment_state,'checked_at',c.checked_at,'source_url',c.source_url,
   'reserved',e.id is not null and e.person_id<>person,
   'claim',case when e.person_id=person then jsonb_build_object('id',e.id,'amount_cents',e.amount_cents,'ocr_amount_cents',e.ocr_amount_cents,'status',e.status,'review_note',e.review_note,'version',e.version) else null end
 ) order by c.kickoff_at desc),'[]'::jsonb) into records
 from public.referee_fee_cases c left join public.referee_expenses e on e.case_id=c.id
 where c.team_id=team and (c.appointment_state='assigned' or e.person_id=person);
 return jsonb_build_object('cases',records,'bankLast4',bank_mask,'paymentServiceConfigured',false);
end $$;

create function public.referee_expense_admin_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare claim public.referee_expenses; fee public.referee_fee_cases; account private.referee_bank_accounts; records jsonb;
begin
 if not exists(select 1 from public.social_admins where user_id=actor and is_active and (role in ('admin','referee-admin') or (role='sm-team' and 'referees'=any(access_areas)))) then
   return jsonb_build_object('error','Keine Berechtigung für Erstattungen.');
 end if;
 if payload->>'action'='referee_import_account' then
   if not exists(select 1 from public.social_team_people tp join public.social_people p on p.id=tp.person_id where p.id=(payload->>'personId')::uuid and p.active and tp.role ilike '%trainer%') then return jsonb_build_object('error','Trainer nicht gefunden.'); end if;
   insert into private.referee_bank_accounts(person_id,encrypted_details,iban_last4,source_message_id,verified_by)
   values((payload->>'personId')::uuid,payload->>'encryptedDetails',payload->>'ibanLast4',payload->>'sourceMessageId',actor)
   on conflict(person_id) do update set encrypted_details=excluded.encrypted_details,iban_last4=excluded.iban_last4,source_message_id=excluded.source_message_id,verified_by=actor,verified_at=now(),version=private.referee_bank_accounts.version+1;
   return jsonb_build_object('ok',true);
 elsif payload->>'action' in ('referee_approve_expense','referee_reject_expense') then
   select c.* into fee from public.referee_fee_cases c join public.referee_expenses e on e.case_id=c.id where e.id=(payload->>'id')::uuid for update of c;
   select * into claim from public.referee_expenses where id=(payload->>'id')::uuid for update;
   if not found or claim.status<>'submitted' or (payload->>'version')::integer is distinct from claim.version then return jsonb_build_object('error','Die Erstattung wurde bereits bearbeitet. Bitte neu laden.'); end if;
   if payload->>'action'='referee_reject_expense' then
     if coalesce(length(trim(payload->>'note')),0) not between 1 and 1000 then return jsonb_build_object('error','Bitte einen Hinweis für den Trainer angeben.'); end if;
     update public.referee_expenses set status='rejected',review_note=trim(payload->>'note'),reviewed_by=actor,reviewed_at=now() where id=claim.id;
   else
     if fee.appointment_state<>'assigned' or fee.game_status<>'finished' or fee.kickoff_at>now() or fee.checked_at<now()-interval '48 hours' then return jsonb_build_object('error','Bitte zuerst die Ansetzung und den Spielstatus aktualisieren.'); end if;
     select * into account from private.referee_bank_accounts where person_id=claim.person_id for share;
     if not found then return jsonb_build_object('error','Für diesen Trainer fehlen geprüfte Kontodaten.'); end if;
     insert into private.referee_payment_orders(expense_id,person_id,amount_cents,encrypted_destination,iban_last4,account_version,approved_by)
       values(claim.id,claim.person_id,claim.amount_cents,account.encrypted_details,account.iban_last4,account.version,actor);
     update public.referee_expenses set status='approved',reviewed_by=actor,reviewed_at=now() where id=claim.id;
   end if;
   return jsonb_build_object('ok',true);
 elsif payload->>'action'='referee_expense_load' then
   select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'home_team',c.home_team,'away_team',c.away_team,'kickoff_at',c.kickoff_at,
     'game_status',c.game_status,'appointment_state',c.appointment_state,'checked_at',c.checked_at,'source_url',c.source_url,'team',t.name,
     'claim',case when e.id is null then null else jsonb_build_object('id',e.id,'amount_cents',e.amount_cents,'ocr_amount_cents',e.ocr_amount_cents,'status',e.status,'review_note',e.review_note,'version',e.version,'person_name',p.display_name,'person_id',p.id,'receipt_id',e.receipt_id,'bankLast4',coalesce(pay.iban_last4,a.iban_last4),'payment_id',pay.id,'payment_status',pay.status) end
   ) order by c.kickoff_at desc),'[]'::jsonb) into records
   from public.referee_fee_cases c join public.social_teams t on t.id=c.team_id
   left join public.referee_expenses e on e.case_id=c.id left join public.social_people p on p.id=e.person_id
   left join private.referee_bank_accounts a on a.person_id=p.id left join private.referee_payment_orders pay on pay.expense_id=e.id;
   return jsonb_build_object('cases',records,'paymentServiceConfigured',false);
 else return jsonb_build_object('error','Unbekannte Erstattungsaktion.'); end if;
end $$;
revoke all on function private.referee_expense_audit(),private.referee_expense_version(),public.referee_expense_coach_request(jsonb),public.referee_expense_admin_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.referee_expense_audit(),private.referee_expense_version(),public.referee_expense_coach_request(jsonb),public.referee_expense_admin_request(uuid,jsonb) to service_role;
