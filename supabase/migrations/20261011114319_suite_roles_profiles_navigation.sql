-- One role template plus additive personal rights; browser roles have no direct table access.
create table public.social_suite_roles (
 key text primary key check(key ~ '^[a-z][a-z0-9-]{1,39}$'),
 label text not null check(length(label) between 2 and 80),
 access_areas text[] not null default '{}',
 protected boolean not null default false,
 updated_at timestamptz not null default now(),
 constraint social_suite_roles_areas_check check(access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','user_management','cashbook']::text[])
);
alter table public.social_suite_roles enable row level security;
revoke all on public.social_suite_roles from public,anon,authenticated;
grant select,insert,update on public.social_suite_roles to service_role;
insert into public.social_suite_roles(key,label,access_areas,protected) values
 ('admin','Super-Admin',array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','user_management','cashbook'],true),
 ('user','Benutzer',array['social_media'],false),('trainer','Trainer',array['cashbook'],false),
 ('cashier','Kasse',array['cashbook'],false),('youth-leadership','Jugendleitung',array['cashbook'],false),
 ('referee-admin','Schiedsrichteradmin',array['referees'],false),('sponsoring','Sponsorenverwaltung',array['sponsoring'],false);

alter table public.social_admins
 add column first_name text not null default '' check(length(first_name)<=80),
 add column last_name text not null default '' check(length(last_name)<=100),
 add column username text,
 add column suite_role_key text references public.social_suite_roles(key) on delete restrict,
 add column extra_access_areas text[] not null default '{}',
 add column is_blocked boolean not null default false;
create unique index social_admins_username_unique on public.social_admins(lower(username));
create index social_admins_suite_role_idx on public.social_admins(suite_role_key);
alter table public.social_admins add constraint social_admins_username_check check(username is null or username ~ '^[a-z]{2,30}$');
alter table public.social_admins drop constraint if exists social_admins_access_areas_check;
alter table public.social_admins add constraint social_admins_extra_areas_check check(extra_access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','cashbook']::text[]);

create function private.suite_mapped_areas(areas text[]) returns text[] language sql immutable set search_path='' as $$
 select coalesce(array_agg(distinct a order by a),'{}'::text[]) from unnest(areas || case when 'administration'=any(areas) then array['corporate_identity','club_crests','social_media_admin']::text[] else '{}'::text[] end) a where a<>'administration'
$$;
-- Preserve names, logins and all existing grants. Shared accounts remain shared and active.
update public.social_admins s set first_name=split_part(p.display_name,' ',1),last_name=substr(p.display_name,length(split_part(p.display_name,' ',1))+2),username=a.username,
 suite_role_key=case when s.role='admin' then 'admin' when a.role='cashier' then 'cashier' when private.cashbook_is_youth_leader(a.person_id) then 'youth-leadership' else 'trainer' end
 from private.cashbook_accounts a join public.social_people p on p.id=a.person_id where a.suite_user_id=s.user_id;
update public.social_admins set suite_role_key=case role when 'admin' then 'admin' when 'referee-admin' then 'referee-admin' else 'user' end,
 username=case when split_part(email,'@',1) ~ '^[a-z]{2,30}$' then split_part(email,'@',1) else null end where suite_role_key is null;
update public.social_admins s set extra_access_areas=(select coalesce(array_agg(a),'{}'::text[]) from unnest(private.suite_mapped_areas(s.access_areas)) a where a<>all(r.access_areas) and a<>'user_management'),
 access_areas=private.suite_mapped_areas(s.access_areas) from public.social_suite_roles r where r.key=s.suite_role_key;
alter table public.social_admins add constraint social_admins_access_areas_check check(access_areas <@ array['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','user_management','cashbook']::text[]);
alter table public.social_admins alter column suite_role_key set not null;
alter table public.social_admins alter column suite_role_key set default 'user';

create function private.suite_member_access() returns trigger language plpgsql security invoker set search_path='' as $$
declare base text[]; account private.cashbook_accounts; person public.social_people;
begin
 if tg_op='INSERT' and new.first_name='' then
  select * into account from private.cashbook_accounts where suite_user_id=new.user_id;
  if found then
   select * into person from public.social_people where id=account.person_id;
   new.first_name:=split_part(person.display_name,' ',1);new.last_name:=substr(person.display_name,length(new.first_name)+2);new.username:=account.username;
   if new.role<>'admin' then new.suite_role_key:=case when account.role='cashier' then 'cashier' when private.cashbook_is_youth_leader(account.person_id) then 'youth-leadership' else 'trainer' end;end if;
  end if;
 end if;
 if tg_op='INSERT' and new.role='admin' then new.suite_role_key:='admin';end if;
 select access_areas into base from public.social_suite_roles where key=new.suite_role_key;
 if base is null then raise exception 'Unbekannte Suite-Rolle';end if;
 -- Compatibility with existing, service-only cashbook linking operations.
 if tg_op='INSERT' or (new.access_areas is distinct from old.access_areas and new.extra_access_areas=old.extra_access_areas and new.suite_role_key=old.suite_role_key) then
  new.extra_access_areas:=(select coalesce(array_agg(distinct a),'{}'::text[]) from unnest(new.extra_access_areas||private.suite_mapped_areas(new.access_areas)) a where a<>all(base) and a<>'user_management');
 end if;
 new.role:=case when new.suite_role_key='admin' then 'admin' else 'sm-team' end;
 new.access_areas:=(select coalesce(array_agg(distinct a order by a),'{}'::text[]) from unnest(base||new.extra_access_areas) a);
 new.username:=nullif(lower(trim(new.username)),'');
 return new;
end $$;
create trigger social_admins_suite_access before insert or update on public.social_admins for each row execute function private.suite_member_access();
update public.social_admins set suite_role_key=suite_role_key;

create table private.suite_login_attempts(username text primary key,failures int not null default 0,window_started_at timestamptz not null default now());
alter table private.suite_login_attempts enable row level security;
grant select,insert,update,delete on private.suite_login_attempts to service_role;
create or replace function public.suite_cashbook_login(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare login text:=lower(trim(payload->>'username')); member public.social_admins; attempt private.suite_login_attempts;
begin
 if login !~ '^[a-z]{2,30}$' or coalesce(payload->>'action','') not in ('attempt','success') then return jsonb_build_object('error','Anmeldung fehlgeschlagen.','status',403);end if;
 insert into private.suite_login_attempts(username) values(login) on conflict do nothing;
 select * into attempt from private.suite_login_attempts where username=login for update;
 select * into member from public.social_admins where username=login and is_active and not is_blocked and cardinality(access_areas)>0;
 if not found then return jsonb_build_object('error','Anmeldung fehlgeschlagen.','status',403);end if;
 if payload->>'action'='success' then update private.suite_login_attempts set failures=0 where username=login;return jsonb_build_object('ok',true);end if;
 if attempt.window_started_at<=now()-interval '15 minutes' then update private.suite_login_attempts set failures=0,window_started_at=now() where username=login;attempt.failures:=0;end if;
 if attempt.failures>=5 then return jsonb_build_object('error','Zu viele Versuche. Bitte nach 15 Minuten erneut versuchen.','status',429);end if;
 update private.suite_login_attempts set failures=failures+1 where username=login;
 return jsonb_build_object('email',member.email);
end $$;

create function public.suite_users_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare act text:=payload->>'action'; member public.social_admins; target public.social_admins; selected uuid[]; target_role text; extras text[]; areas text[]; role_row public.social_suite_roles; roles jsonb; operation text; ids jsonb;
begin
 if act='identity' then
  select * into member from public.social_admins where user_id=actor and is_active and not is_blocked;
  if not found then return jsonb_build_object('error','not_authorized','status',403);end if;
  return (select jsonb_build_object('userId',member.user_id,'email',case when member.email like '%@suite.bsvnordstern.invalid' then '' else member.email end,'firstName',member.first_name,'lastName',member.last_name,'name',trim(member.first_name||' '||member.last_name),'username',member.username,'role',member.role,'roleKey',member.suite_role_key,'roleLabel',r.label,'accessAreas',member.access_areas,'roleAreas',r.access_areas,'extraAreas',member.extra_access_areas,'birthDate',p.birth_date,'teams',case when a.id is null then '[]'::jsonb else private.cashbook_current_teams(a.person_id) end,'createdAt',member.created_at)
   from public.social_suite_roles r left join private.cashbook_accounts a on a.suite_user_id=member.user_id left join public.social_people p on p.id=a.person_id where r.key=member.suite_role_key);
 end if;
 -- Serialize admin changes, so concurrent demotions/deletions cannot remove the last admin.
 perform pg_advisory_xact_lock(1956,1101);
 select * into member from public.social_admins where user_id=actor and is_active and not is_blocked and role='admin' for update;
 if not found then return jsonb_build_object('error','Nur Super-Admins verwalten Benutzer und Rollen.','status',403);end if;
 if act='roles' then return jsonb_build_object('roles',(select jsonb_agg(to_jsonb(r) order by r.label) from public.social_suite_roles r));
 elsif act='save_role' then
  select * into role_row from public.social_suite_roles where key=payload->>'key' for update;
  if not found then return jsonb_build_object('error','Rolle wurde nicht gefunden.','status',404);end if;
  if role_row.protected then return jsonb_build_object('error','Die Super-Admin-Rolle bleibt unveränderlich.','status',403);end if;
  select coalesce(array_agg(distinct a),'{}'::text[]) into areas from jsonb_array_elements_text(payload->'accessAreas') a;
  if 'user_management'=any(areas) then return jsonb_build_object('error','Benutzerverwaltung bleibt Super-Admins vorbehalten.','status',403);end if;
  update public.social_suite_roles set access_areas=areas,updated_at=now() where key=role_row.key;
  update public.social_admins set suite_role_key=suite_role_key where suite_role_key=role_row.key;
 elsif act in ('save_member','create_member') then
  target_role:=payload->>'roleKey';
  select * into role_row from public.social_suite_roles where key=target_role;
  if not found then return jsonb_build_object('error','Rolle wurde nicht gefunden.','status',400);end if;
  if (payload->>'userId')::uuid=actor then return jsonb_build_object('error','Der eigene Super-Admin-Zugang kann hier nicht verändert werden.','status',403);end if;
  select coalesce(array_agg(distinct a),'{}'::text[]) into extras from jsonb_array_elements_text(payload->'extraAreas') a where a<>all(role_row.access_areas);
  if 'user_management'=any(extras) then return jsonb_build_object('error','Benutzerverwaltung bleibt Super-Admins vorbehalten.','status',403);end if;
  select * into target from public.social_admins where user_id=(payload->>'userId')::uuid;
  if coalesce(payload->>'username','') !~ '^[a-z]{2,30}$' or (not (act='save_member' and target.first_name='' and target.last_name='' and coalesce(payload->>'firstName','')='' and coalesce(payload->>'lastName','')='') and (coalesce(length(trim(payload->>'firstName')),0)<1 or coalesce(length(trim(payload->>'lastName')),0)<1)) then return jsonb_build_object('error','Vorname, Nachname und ein Login aus 2 bis 30 Buchstaben sind erforderlich.','status',400);end if;
  if act='create_member' then
   insert into public.social_admins(user_id,email,role,is_active,first_name,last_name,username,suite_role_key,extra_access_areas,access_areas)
    values((payload->>'userId')::uuid,payload->>'email',case when target_role='admin' then 'admin' else 'sm-team' end,coalesce((payload->>'isActive')::boolean,true),trim(payload->>'firstName'),trim(payload->>'lastName'),payload->>'username',target_role,extras,role_row.access_areas||extras);
  else
   update public.social_admins set first_name=trim(payload->>'firstName'),last_name=trim(payload->>'lastName'),username=payload->>'username',suite_role_key=target_role,extra_access_areas=extras where user_id=(payload->>'userId')::uuid;
   if not found then return jsonb_build_object('error','Benutzer wurde nicht gefunden.','status',404);end if;
  end if;
  -- Keep the cashbook alias in sync; immutable ledger names/timestamps stay untouched.
  update private.cashbook_accounts set username=payload->>'username' where suite_user_id=(payload->>'userId')::uuid;
  update public.social_people set display_name=trim(payload->>'firstName')||' '||trim(payload->>'lastName') where id=(select person_id from private.cashbook_accounts where suite_user_id=(payload->>'userId')::uuid);
 elsif act in ('bulk_state','prepare_delete') then
  select array_agg(distinct id::uuid) into selected from jsonb_array_elements_text(payload->'userIds') id;
  if coalesce(cardinality(selected),0)<1 or cardinality(selected)>100 then return jsonb_build_object('error','Bitte 1 bis 100 Benutzer auswählen.','status',400);end if;
  if actor=any(selected) then return jsonb_build_object('error','Der eigene Super-Admin-Zugang kann nicht ausgewählt werden.','status',403);end if;
  if (select count(*) from public.social_admins where user_id=any(selected))<>cardinality(selected) then return jsonb_build_object('error','Die Auswahl ist veraltet. Bitte neu laden.','status',409);end if;
  operation:=case when act='prepare_delete' then 'delete' else payload->>'operation' end;
  if operation not in ('activate','deactivate','block','unblock','delete') then return jsonb_build_object('error','Unbekannte Benutzeraktion.','status',400);end if;
  update public.social_admins set is_active=case when operation in ('deactivate','block','delete') then false when operation in ('activate','unblock') then true else is_active end,
   is_blocked=operation in ('block','delete') where user_id=any(selected);
  return jsonb_build_object('ok',true,'userIds',to_jsonb(selected));
 else return jsonb_build_object('error','Unbekannte Benutzeraktion.','status',400);end if;
 return jsonb_build_object('ok',true);
end $$;

create table public.social_brand_settings(id boolean primary key default true check(id),color_scheme jsonb not null,updated_at timestamptz not null default now());
insert into public.social_brand_settings(color_scheme) values('{"background":"#071f16","panel":"#164f32","primary":"#91c82f","accent":"#f4d638","muted":"#a8cbb4","surface":"#f4f1e8","ink":"#10251a"}');
alter table public.social_brand_settings enable row level security;
revoke all on public.social_brand_settings from public,anon,authenticated;
grant select on public.social_brand_settings to anon,authenticated;
create policy social_brand_public_read on public.social_brand_settings for select to anon,authenticated using (true);
grant select,update on public.social_brand_settings to service_role;

revoke all on function private.suite_mapped_areas(text[]),private.suite_member_access(),public.suite_users_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.suite_mapped_areas(text[]),private.suite_member_access(),public.suite_users_request(uuid,jsonb) to service_role;

create function public.suite_brand_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare colors jsonb:=payload->'colorScheme'; updated jsonb;
begin
 if not exists(select 1 from public.social_admins where user_id=actor and is_active and not is_blocked and (role='admin' or 'corporate_identity'=any(access_areas))) then return jsonb_build_object('error','Keine Berechtigung für Corporate Identity.','status',403);end if;
 if colors is null or (select count(*) from jsonb_each_text(colors) e where e.key=any(array['background','panel','primary','accent','muted','surface','ink']) and e.value ~ '^#[0-9a-fA-F]{6}$')<>7 then return jsonb_build_object('error','Ungültige BSV-Standardfarben.','status',400);end if;
 update public.social_brand_settings set color_scheme=colors,updated_at=now() where id=true;
 with changes as (update public.social_teams set color_scheme=colors where color_source='global' returning id,active,content_enabled) select coalesce(jsonb_agg(to_jsonb(changes)),'[]') into updated from changes;
 return jsonb_build_object('teams',updated);
end $$;
revoke all on function public.suite_brand_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.suite_brand_request(uuid,jsonb) to service_role;

-- Alias edits through the cashbook administration use the same Suite login.
create function private.suite_cashbook_alias_sync() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.suite_user_id is not null then
  update public.social_admins set username=new.username where user_id=new.suite_user_id and username is distinct from new.username;
 end if;
 return new;
end $$;
revoke all on function private.suite_cashbook_alias_sync() from public,anon,authenticated;
grant execute on function private.suite_cashbook_alias_sync() to service_role;
create trigger cashbook_suite_alias_sync after update of username,suite_user_id on private.cashbook_accounts for each row execute function private.suite_cashbook_alias_sync();
