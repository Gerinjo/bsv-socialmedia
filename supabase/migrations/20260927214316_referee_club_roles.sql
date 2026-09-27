-- Club-wide portal access is independent of coaching assignments and admin roles.
create table private.referee_club_roles (
 person_id uuid primary key references public.social_people(id) on delete restrict,
 role text not null check(role in ('youth_leadership','treasurer')),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table private.referee_club_roles enable row level security;
revoke all on private.referee_club_roles from public,anon,authenticated;
grant select,insert,update,delete on private.referee_club_roles to service_role;

insert into private.referee_club_roles(person_id,role)
select p.id,requested.role from public.social_people p
join (values ('jerome-ernsberger','youth_leadership'),('ole-schmal','youth_leadership'),('wiebke-baronner-dieterle','treasurer')) requested(slug,role) on requested.slug=p.slug
where p.active;

-- Service-only view is shared by selector and authorization. No birthday values.
create view public.referee_portal_people with (security_invoker=true) as
select distinct on (team_id,person_id) team_id,team_name,person_id,display_name,role,is_club_role,birthday_ready
from (
 select t.id as team_id,t.name as team_name,p.id as person_id,p.display_name,tp.role,false as is_club_role,p.birth_date is not null as birthday_ready
 from public.social_team_people tp join public.social_teams t on t.id=tp.team_id join public.social_people p on p.id=tp.person_id
 where t.referee_enabled and p.active and tp.role ilike '%trainer%'
 union all
 select t.id,t.name,p.id,p.display_name,case r.role when 'youth_leadership' then 'Jugendleitung' else 'Kassiererin' end,true,p.birth_date is not null
 from private.referee_club_roles r join public.social_people p on p.id=r.person_id cross join public.social_teams t
 where r.active and p.active and t.referee_enabled
) candidates order by team_id,person_id,is_club_role desc,role;
revoke all on public.referee_portal_people from public,anon,authenticated;
grant select on public.referee_portal_people to service_role;

create or replace function public.referee_coach_request(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  person uuid := (payload->>'personId')::uuid;
  team uuid := (payload->>'teamId')::uuid;
  attempts private.referee_login_attempts;
  record public.referee_assignments;
  game public.social_games;
  records jsonb;
begin
  -- Only known people allocate a rate-limit row. Lock per person to prevent parallel guesses.
  if not exists (select 1 from public.social_people where id=person and active) then
    return jsonb_build_object('error','Die Anmeldung konnte nicht bestätigt werden.','status',403);
  end if;
  insert into private.referee_login_attempts(person_id) values(person) on conflict do nothing;
  select * into attempts from private.referee_login_attempts where person_id=person for update;
  if attempts.window_started_at <= now() - interval '15 minutes' then
    update private.referee_login_attempts set failures=0,window_started_at=now() where person_id=person;
    attempts.failures := 0;
  end if;
  if attempts.failures >= 5 then
    return jsonb_build_object('error','Zu viele Fehlversuche. Bitte nach 15 Minuten erneut versuchen.','status',429);
  end if;
  if not exists (
    select 1 from public.social_people p join public.referee_portal_people access on access.person_id=p.id
    where p.id=person and access.team_id=team and p.birth_date::text=payload->>'birthDate'
  ) then
    update private.referee_login_attempts set failures=failures+1 where person_id=person;
    -- Return, do not raise: failed attempts must commit.
    return jsonb_build_object('error','Die Anmeldung konnte nicht bestätigt werden.','status',403);
  end if;
  if payload->>'action' = 'save' then
    select g.* into game from public.social_games g join public.referee_assignments a on a.game_id=g.id
      where a.id=(payload->>'id')::uuid and g.team_id=team for update of g;
    if not found then return jsonb_build_object('error','Dieses Spiel gehört nicht zu deiner Mannschaft.','status',403); end if;
    select * into record from public.referee_assignments where id=(payload->>'id')::uuid for update;
    if record.paid_at is not null then return jsonb_build_object('error','Dieses Spiel ist bereits ausgezahlt und gesperrt.','status',409); end if;
    if game.status not in ('scheduled','live','finished') then return jsonb_build_object('error','Dieses Spiel kann derzeit nicht bearbeitet werden.','status',409); end if;
    if (payload->>'version')::integer is distinct from record.version then return jsonb_build_object('error','Das Spiel wurde zwischenzeitlich geändert. Bitte neu laden.','status',409); end if;
    if coalesce(length(trim(payload->>'refereeName')),0) not between 1 and 160
      or coalesce(payload->>'fieldSize','') not in ('7','9') then
      return jsonb_build_object('error','Bitte Schirinamen und 7er- oder 9er-Feld angeben.','status',400);
    end if;
    update public.referee_assignments set referee_name=trim(payload->>'refereeName'),field_size=(payload->>'fieldSize')::smallint,assigned_by=person
      where id=record.id;
  elsif payload->>'action' is distinct from 'list' then
    return jsonb_build_object('error','Unbekannte Aktion.','status',400);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'referee_name',a.referee_name,'field_size',a.field_size,'paid_at',a.paid_at,'version',a.version,
    'game',jsonb_build_object('id',g.id,'home_team',g.home_team,'away_team',g.away_team,'kickoff_at',g.kickoff_at,'status',g.status,'venue',g.venue)
  ) order by g.kickoff_at desc),'[]'::jsonb) into records
  from public.referee_assignments a join public.social_games g on g.id=a.game_id where g.team_id=team;
  return jsonb_build_object('assignments',records);
end $$;

create or replace function public.referee_admin_request(actor uuid, payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  record public.referee_assignments;
  game public.social_games;
  birthdate date;
begin
  if not exists (select 1 from public.social_admins where user_id=actor and is_active
    and (role in ('admin','referee-admin') or (role='sm-team' and 'referees'=any(access_areas)))) then
    return jsonb_build_object('error','Nur Schiedsrichteradmins dürfen diese Aktion ausführen.');
  end if;
  if payload->>'action' = 'referee_register' then
    select * into game from public.social_games where id=(payload->>'gameId')::uuid for update;
    if not found or game.team_id is null or game.status not in ('scheduled','live','finished') then
      return jsonb_build_object('error','Bitte ein Spiel mit BSV-Mannschaft auswählen.');
    end if;
    insert into public.referee_assignments(game_id,created_by) values(game.id,actor) on conflict(game_id) do nothing;
  elsif payload->>'action' = 'referee_pay' then
    select g.* into game from public.social_games g join public.referee_assignments a on a.game_id=g.id
      where a.id=(payload->>'id')::uuid for update of g;
    if not found then return jsonb_build_object('error','Das Spiel wurde nicht gefunden.'); end if;
    select * into record from public.referee_assignments where id=(payload->>'id')::uuid for update;
    if record.paid_at is not null then return jsonb_build_object('error','Die Auszahlung wurde bereits erfasst.'); end if;
    if (payload->>'version')::integer is distinct from record.version then return jsonb_build_object('error','Das Spiel wurde zwischenzeitlich geändert. Bitte neu laden.'); end if;
    if game.status <> 'finished' or game.kickoff_at > now() or record.referee_name is null or record.field_size is null then
      return jsonb_build_object('error','Nur beendete Spiele mit eingetragenem Schiri können ausgezahlt werden.');
    end if;
    update public.referee_assignments set paid_at=clock_timestamp(),paid_by=actor,
      paid_game_snapshot=jsonb_build_object('home_team',game.home_team,'away_team',game.away_team,'kickoff_at',game.kickoff_at,'team_id',game.team_id,'referee_name',record.referee_name,'field_size',record.field_size)
      where id=record.id;
  elsif payload->>'action' = 'referee_birthdate' then
    if not exists (select 1 from public.referee_portal_people where person_id=(payload->>'personId')::uuid) then
      return jsonb_build_object('error','Person wurde nicht gefunden.');
    end if;
    begin birthdate := (payload->>'birthDate')::date;
    exception when others then return jsonb_build_object('error','Bitte ein gültiges Geburtsdatum angeben.'); end;
    if birthdate is null or birthdate > current_date or birthdate < date '1900-01-01' then return jsonb_build_object('error','Bitte ein gültiges Geburtsdatum angeben.'); end if;
    update public.social_people set birth_date=birthdate where id=(payload->>'personId')::uuid and active;
  else return jsonb_build_object('error','Unbekannte Aktion.');
  end if;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.referee_expense_admin_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare claim public.referee_expenses; fee public.referee_fee_cases; account private.referee_bank_accounts; records jsonb;
begin
 if not exists(select 1 from public.social_admins where user_id=actor and is_active and (role in ('admin','referee-admin') or (role='sm-team' and 'referees'=any(access_areas)))) then
   return jsonb_build_object('error','Keine Berechtigung für Erstattungen.');
 end if;
 if payload->>'action'='referee_import_account' then
   if not exists(select 1 from public.referee_portal_people where person_id=(payload->>'personId')::uuid) then return jsonb_build_object('error','Person nicht gefunden.'); end if;
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
