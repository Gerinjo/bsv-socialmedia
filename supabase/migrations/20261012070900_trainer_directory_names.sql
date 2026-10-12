-- Ordinary public names follow the person; only real nicknames remain overrides.
update private.trainer_profiles tp set website_name='' from public.social_people p where p.id=tp.person_id and tp.website_name=p.display_name;
-- These full names are already corrected in the public website's layout.
update private.trainer_profiles tp set first_name='Dana-Sophie',last_name='Bulander',website_name='',version=version+1,updated_at=now() from public.social_people p where p.id=tp.person_id and p.slug='dana-bulander' and tp.first_name='Dana';
update public.social_people set display_name='Dana-Sophie Bulander',updated_at=now() where slug='dana-bulander' and display_name='Dana Bulander';
update private.trainer_profiles tp set first_name='Marlia-Lena',last_name='Bulander',website_name='',version=version+1,updated_at=now() from public.social_people p where p.id=tp.person_id and p.slug='marlia-burlander' and tp.first_name='Marlia';
update public.social_people set display_name='Marlia-Lena Bulander',updated_at=now() where slug='marlia-burlander' and display_name='Marlia Burlander';
update private.trainer_profiles tp set first_name='Noemi Sophie',last_name='Friedrich',version=version+1,updated_at=now() from public.social_people p where p.id=tp.person_id and p.slug='noemi-sophie-friedrich' and tp.first_name='Noemi' and tp.last_name='Sophie Friedrich';
create index trainer_profiles_updated_by_idx on private.trainer_profiles(updated_by);
create index trainer_audit_actor_idx on private.trainer_audit(actor);
create index trainer_audit_person_idx on private.trainer_audit(person_id,created_at);
create index trainer_audit_team_idx on private.trainer_audit(team_id,created_at);
