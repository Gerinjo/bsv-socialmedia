begin;
-- A successful cashbook grant also creates/binds the financial identity. Keep
-- immutable ledger IDs and intentional account blocks when reusing a profile.
create function private.suite_cashbook_access_sync() returns trigger
language plpgsql security invoker set search_path='' as $$
declare account private.cashbook_accounts; person uuid; matches uuid[]; desired_role text; full_name text;
begin
 if new.role='admin' or not new.is_active or new.is_blocked or not ('cashbook'=any(new.access_areas)) then return new;end if;
 select * into account from private.cashbook_accounts where suite_user_id=new.user_id for update;
 if account.id is not null then
  if new.person_id is not null and new.person_id<>account.person_id then
   raise exception 'Der Kassenbuchzugang gehört bereits zu einer anderen Person. Bitte die Personenzuordnung prüfen.';
  end if;
  if new.person_id is null then update public.social_admins set person_id=account.person_id where user_id=new.user_id;end if;
  -- The selected financial Suite role remains authoritative even when access
  -- was revoked between role changes. Custom roles retain a manual assignment.
  if new.suite_role_key in ('trainer','youth-leadership','cashier') then
   desired_role:=case when new.suite_role_key='cashier' then 'cashier' else 'trainer' end;
   if account.role<>desired_role and desired_role='trainer' and new.suite_role_key<>'youth-leadership' and not private.cashbook_is_youth_leader(account.person_id)
     and jsonb_array_length(private.cashbook_current_teams(account.person_id))=0 then
    raise exception 'Für diesen Trainer ist keine im Kassenbuch freigeschaltete Mannschaft zugeordnet. Bitte zuerst die Trainerzuordnung ergänzen.';
   end if;
   if account.role<>desired_role then update private.cashbook_accounts set role=desired_role where id=account.id;end if;
  end if;
  return new;
 end if;

 person:=new.person_id;
 full_name:=trim(new.first_name||' '||new.last_name);
 if person is null then
  select array_agg(p.id) into matches from public.social_people p where lower(trim(p.display_name))=lower(full_name) and p.active;
  if cardinality(matches)>1 then raise exception 'Mehrere Personen heißen %. Bitte den Suite-Zugang eindeutig einer Person zuordnen.',full_name;end if;
  person:=matches[1];
 end if;
 desired_role:=case when new.suite_role_key='cashier' then 'cashier' else 'trainer' end;
 if person is null and desired_role='cashier' and new.first_name<>'' and new.last_name<>'' then
  insert into public.social_people(slug,display_name,roles,active)
   values('suite-'||new.user_id::text,full_name,'{}',true) returning id into person;
 end if;
 if person is null then raise exception 'Für das Kassenbuch muss der Benutzer einer Person mit Trainerzuordnung entsprechen. Bitte Vor- und Nachname prüfen oder für Kassenmitarbeitende die Rolle Kasse wählen.';end if;
 perform 1 from public.social_people where id=person and active for share;
 if not found then raise exception 'Die zugeordnete Person ist nicht aktiv. Bitte zuerst in der Mitarbeiterverwaltung aktivieren.';end if;
 if desired_role='trainer' and new.suite_role_key<>'youth-leadership' and not private.cashbook_is_youth_leader(person)
   and jsonb_array_length(private.cashbook_current_teams(person))=0 then
  raise exception 'Für % ist keine im Kassenbuch freigeschaltete Mannschaft zugeordnet. Bitte die Trainerzuordnung ergänzen oder für Kassenmitarbeitende die Rolle Kasse wählen.',full_name;
 end if;
 if new.username is null then raise exception 'Bitte zuerst ein Login für den Kassenbuchbenutzer vergeben.';end if;
 select * into account from private.cashbook_accounts where person_id=person for update;
 if account.id is not null and account.suite_user_id is not null and account.suite_user_id<>new.user_id then
  raise exception 'Diese Person hat bereits einen anderen Suite-Zugang für das Kassenbuch.';
 end if;
 if exists(select 1 from private.cashbook_accounts a where a.username=new.username and a.person_id<>person) then
  raise exception 'Dieses Login ist bereits einem anderen Kassenbuchprofil zugeordnet. Bitte ein anderes Login wählen.';
 end if;
 if account.id is null then
  insert into private.cashbook_accounts(person_id,suite_user_id,username,role,active)
   values(person,new.user_id,new.username,desired_role,true);
 else
  update private.cashbook_accounts set suite_user_id=new.user_id,username=new.username where id=account.id;
 end if;
 if new.person_id is null then update public.social_admins set person_id=person where user_id=new.user_id;end if;
 return new;
end $$;
revoke all on function private.suite_cashbook_access_sync() from public,anon,authenticated;
grant execute on function private.suite_cashbook_access_sync() to service_role;
-- AFTER runs with the effective, normalized role/additional rights and permits
-- safely attaching the canonical person without changing the row mid-update.
create trigger social_admins_cashbook_access after insert or update of access_areas,extra_access_areas,suite_role_key,person_id,is_active,is_blocked,username
 on public.social_admins for each row execute function private.suite_cashbook_access_sync();

-- Reconcile already granted rights without touching admins or existing profiles.
update public.social_admins m set suite_role_key=m.suite_role_key
 where m.role<>'admin' and m.is_active and not m.is_blocked and 'cashbook'=any(m.access_areas)
 and not exists(select 1 from private.cashbook_accounts a where a.suite_user_id=m.user_id);
commit;
