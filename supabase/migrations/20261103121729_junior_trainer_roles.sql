-- G/F/E coaches all serve as Trainer. Keep stable assignment slot identifiers.
create function private.enforce_junior_trainer_role() returns trigger
language plpgsql security invoker set search_path='' as $$
declare team_slug text;
begin
 if new.staff_slot is null or not (new.staff_slot in ('trainer','co1','co2') or new.staff_slot ~ '^extra-[1-9][0-9]?$') then return new;end if;
 select slug into team_slug from public.social_teams where id=new.team_id;
 if team_slug ~ '^u([1-9]|10|11)(-|$)' then new.role:='Trainer';new.website_role:='Trainer';end if;
 return new;
end $$;
revoke all on function private.enforce_junior_trainer_role() from public,anon,authenticated;
grant execute on function private.enforce_junior_trainer_role() to service_role;
create trigger social_team_people_junior_trainer_role before insert or update on public.social_team_people for each row execute function private.enforce_junior_trainer_role();

-- Preserve every person and assignment. Record the normalized roles per team.
do $normalize$
declare t record;before_roles jsonb;after_roles jsonb;
begin
 for t in select distinct team.id from public.social_teams team join public.social_team_people a on a.team_id=team.id where team.slug ~ '^u([1-9]|10|11)(-|$)' and (a.staff_slot in ('trainer','co1','co2') or a.staff_slot ~ '^extra-[1-9][0-9]?$') and (a.role<>'Trainer' or a.website_role<>'Trainer') loop
  select jsonb_agg(to_jsonb(a) order by a.staff_slot) into before_roles from public.social_team_people a where a.team_id=t.id and a.staff_slot is not null;
  update public.social_team_people set role='Trainer',website_role='Trainer' where team_id=t.id and (staff_slot in ('trainer','co1','co2') or staff_slot ~ '^extra-[1-9][0-9]?$') and (role<>'Trainer' or website_role<>'Trainer');
  update public.social_teams set trainer_version=trainer_version+1,updated_at=now() where id=t.id;
  select jsonb_agg(to_jsonb(a) order by a.staff_slot) into after_roles from public.social_team_people a where a.team_id=t.id and a.staff_slot is not null;
  insert into private.trainer_audit(action,team_id,before_data,after_data) values('normalize_junior_trainer_roles',t.id,before_roles,after_roles);
 end loop;
end $normalize$;
