update public.social_people
set cutout_path = regexp_replace(
  source_photo_url,
  '(/personen/)([^/]+)\.(jpe?g)$',
  '\1transparent/\2-transparent.png',
  'i'
)
where source_photo_url ~* '/personen/[^/]+\.(jpe?g)$';

update public.social_birthdays as birthday
set photo_path = person.cutout_path
from public.social_people as person
where birthday.person_id = person.id
  and person.cutout_path is not null;
