-- Verified against the pre-contact-form website archive, commit
-- 36cf3ce1bdceecc166baff725eb5fb80c7f47d13 (src/data/legacyContent.ts).
-- Michael and Frieder's mailboxes also still exist in the website recipient table.
do $recovery$
declare item record; profile private.trainer_profiles; updated_profile private.trainer_profiles; note text; old_contacts record; new_contacts text[];
begin
 perform pg_advisory_xact_lock(7041956);
 for item in select * from (values
  ('michael-jentsch','1.vorstand@sv-markelfingen.de','jugend/u19'),
  ('frieder-demmer','u13trainer@sv-markelfingen.de','jugend/u19'),
  ('humberto-vicente-agudo-torres','humberto.torres@bsvnordstern.de','jugend/u8-f')
 ) as recovered(slug,email,path) loop
  select tp.* into profile from private.trainer_profiles tp
   join public.social_people p on p.id=tp.person_id where p.slug=item.slug for update of tp;
  if not found then raise exception 'Recovered trainer profile missing: %',item.slug;end if;
  insert into private.trainer_contact_imports(person_id,email,source)
   values(profile.person_id,item.email,'Website-Archiv 36cf3ce1 · '||item.path) on conflict do nothing;
  note:='Weitere bisherige Kontaktadresse: '||item.email||' (Quelle: Website-Archiv).';
  update private.trainer_profiles set
   email=case when trim(profile.email)='' then item.email else profile.email end,
   notes=case when trim(profile.email)<>'' and lower(trim(profile.email))<>item.email and strpos(profile.notes,note)=0 and length(profile.notes)+length(note)+1<=3000 then concat_ws(E'\n',nullif(profile.notes,''),note) else profile.notes end,
   version=version+1,updated_at=now(),updated_by=null
   where person_id=profile.person_id and (trim(profile.email)='' or (lower(trim(profile.email))<>item.email and strpos(profile.notes,note)=0 and length(profile.notes)+length(note)+1<=3000)) returning * into updated_profile;
  if found then
   insert into private.trainer_audit(action,person_id,before_data,after_data)
    values('import_contact_email',profile.person_id,to_jsonb(profile),to_jsonb(updated_profile));
  end if;
 end loop;
 -- These are personal trainer contacts, not permanent SG copies. Keeping them
 -- as extras would keep mailing the old address after edits or passivating.
 for old_contacts in select c.team_id,c.emails from private.trainer_team_contact_emails c
  join public.social_teams t on t.id=c.team_id where t.website_path='jugend/u19'
   and exists(select 1 from unnest(c.emails) email where lower(trim(email)) in ('1.vorstand@sv-markelfingen.de','u13trainer@sv-markelfingen.de')) for update of c,t loop
  new_contacts:=array(select email from unnest(old_contacts.emails) email where lower(trim(email)) not in ('1.vorstand@sv-markelfingen.de','u13trainer@sv-markelfingen.de'));
  update private.trainer_team_contact_emails set emails=new_contacts where team_id=old_contacts.team_id;
  update public.social_teams set trainer_version=trainer_version+1 where id=old_contacts.team_id;
  insert into private.trainer_audit(action,team_id,before_data,after_data)
   values('save_team_contacts',old_contacts.team_id,jsonb_build_object('contactEmails',old_contacts.emails),jsonb_build_object('contactEmails',new_contacts));
 end loop;
end $recovery$;
