-- One-time import from the existing website contacts. Existing person emails win.
create table private.trainer_contact_imports (
 person_id uuid not null references public.social_people(id),email text not null,source text not null,
 imported_at timestamptz not null default now(),primary key(person_id,email)
);
alter table private.trainer_contact_imports enable row level security;
revoke all on private.trainer_contact_imports from public,anon,authenticated;
grant select on private.trainer_contact_imports to service_role;

do $import$
declare item jsonb; profile private.trainer_profiles; updated_profile private.trainer_profiles; note text; contacts text[];
begin
 for item in select value from jsonb_array_elements('[{"slug": "mathias-becht", "email": "mathias.becht@bsvnordstern.de", "source": "team--fussball--frauen--bezirksliga"}, {"slug": "emel-bayram", "email": "emel.bayram@bsvnordstern.de", "source": "team--fussball--frauen--kreisliga"}, {"slug": "torsten-parzich", "email": "torsten.parzich@bsvnordstern.de", "source": "team--fussball--herren--bezirksliga"}, {"slug": "alexander-kaiser", "email": "alexander.kaiser@bsvnordstern.de", "source": "team--fussball--herren--kreisliga-2"}, {"slug": "dana-bulander", "email": "dana.bulander@bsvnordstern.de", "source": "team--jugend--juniorinnen--u13"}, {"slug": "alexander-kramer", "email": "alexander.kramer@bsvnordstern.de", "source": "team--jugend--juniorinnen--u15"}, {"slug": "sven-goldhagen", "email": "sven.goldhagen@bsvnordstern.de", "source": "team--jugend--juniorinnen--u17"}, {"slug": "sonja-thomen", "email": "sonja.thomen@bsvnordstern.de", "source": "team--jugend--juniorinnen--u17"}, {"slug": "niku-pourheidari", "email": "niku.pourheidari@bsvnordstern.de", "source": "team--jugend--u11-e1"}, {"slug": "marcelino-ruth", "email": "marcelino.rueth@bsvnordstern.de", "source": "team--jugend--u9-f"}, {"slug": "mohamad-mahmoudi", "email": "mohamad.mahmoudi@bsvnordstern.de", "source": "team--jugend--u11-e2"}, {"slug": "stefan-sulger", "email": "stefan.sulger@bsvnordstern.de", "source": "team--jugend--u11-e3"}, {"slug": "michael-sick", "email": "michael.sick@bsvnordstern.de", "source": "team--jugend--u11-e3"}, {"slug": "stephan-hellmann", "email": "stephan.hellmann@bsvnordstern.de", "source": "team--jugend--u13-d1"}, {"slug": "hieu-ho", "email": "hieu.ho@bsvnordstern.de", "source": "team--jugend--u13-d1"}, {"slug": "jorg-boreatti", "email": "joerg.boreatti@bsvnordstern.de", "source": "team--jugend--u13-d2"}, {"slug": "marko-eisner", "email": "marco.eisner@bsvnordstern.de", "source": "team--jugend--u13-d2"}, {"slug": "jerome-ernsberger", "email": "jerome.ernsberger@bsvnordstern.de", "source": "person-jerome-ernsberger"}, {"slug": "axel-schauble", "email": "axel.schaeuble@bsvnordstern.de", "source": "team--jugend--u15-c1"}, {"slug": "simon-buhler", "email": "simon.buehler@bsvnordstern.de", "source": "team--jugend--u15-c1"}, {"slug": "thomas-parthenschlager", "email": "thomas.parthenschlager@bsvnordstern.de", "source": "team--jugend--u15-c1"}, {"slug": "sebastian-bauerle", "email": "sebastian.baeuerle@bsvnordstern.de", "source": "team--jugend--u15-c2"}, {"slug": "maximilian-geismann", "email": "maxgeissmann@gmail.com", "source": "team--jugend--u17"}, {"slug": "andrea-basile", "email": "andrea.basile@bsvnordstern.de", "source": "team--jugend--u17"}, {"slug": "ole-schmal", "email": "schmal.ole@gmail.com", "source": "team--jugend--u19"}, {"slug": "elias-arfa", "email": "elias.arfa@bsvnordstern.de", "source": "team--jugend--u6-g"}, {"slug": "noemi-sophie-friedrich", "email": "noemi.friedrich@bsvnordstern.de", "source": "team--jugend--u6-g"}, {"slug": "mila-ernsberger", "email": "mila.ernsberger@bsvnordstern.de", "source": "team--jugend--u6-g"}, {"slug": "michael-meiss", "email": "michael.meiss@bsvnordstern.de", "source": "team--jugend--u7-g"}, {"slug": "marco-tassone", "email": "marco.tassone@bsvnordstern.de", "source": "team--jugend--u7-g"}, {"slug": "luca-gastaudo", "email": "luca.gastaudo@bsvnordstern.de", "source": "team--jugend--u7-g"}, {"slug": "pascal-dieterle", "email": "pascal.dieterle@bsvnordstern.de", "source": "team--jugend--u8-f"}, {"slug": "fabian-keller", "email": "fabian.keller@bsvnordstern.de", "source": "team--jugend--u8-f"}, {"slug": "andreas-wolfmuller", "email": "andy.wolfmueller@bsvnordstern.de", "source": "team--jugend--u9-f"}, {"slug": "eberhard-klinkenberg", "email": "eberhard.klinkenberg@bsvnordstern.de", "source": "person-eberhard-klinkenberg"}, {"slug": "ole-schmal", "email": "ole.schmal@bsvnordstern.de", "source": "person-ole-schmal"}, {"slug": "myriam-lipp", "email": "myriam.lipp@bsvnordstern.de", "source": "team--fussball--frauen--kreisliga"}]'::jsonb) loop
  select tp.* into profile from private.trainer_profiles tp join public.social_people p on p.id=tp.person_id where p.slug=item->>'slug' for update of tp;
  if not found then continue;end if;
  insert into private.trainer_contact_imports(person_id,email,source) values(profile.person_id,item->>'email',item->>'source') on conflict do nothing;
  note:='Weitere bisherige Kontaktadresse: '||(item->>'email')||' (Quelle: Homepage-Kontaktformular).';
  update private.trainer_profiles set
   email=case when trim(profile.email)='' then item->>'email' else profile.email end,
   notes=case when trim(profile.email)<>'' and lower(trim(profile.email))<>item->>'email' and strpos(profile.notes,note)=0 and length(profile.notes)+length(note)+1<=3000 then concat_ws(E'\n',nullif(profile.notes,''),note) else profile.notes end,
   version=version+1,updated_at=now(),updated_by=null
  where person_id=profile.person_id and (trim(profile.email)='' or (lower(trim(profile.email))<>item->>'email' and strpos(profile.notes,note)=0 and length(profile.notes)+length(note)+1<=3000)) returning * into updated_profile;
  if found then
   insert into private.trainer_audit(action,person_id,before_data,after_data)
    values('import_contact_email',profile.person_id,to_jsonb(profile),to_jsonb(updated_profile));
  end if;
 end loop;
 for item in select jsonb_build_object('route',route,'emails',jsonb_agg(email order by email)) from jsonb_to_recordset('[{"route": "team--fussball--alte-herren", "email": "alteherren@bsvnordstern.de"}, {"route": "team--jugend--u19", "email": "1.vorstand@sv-markelfingen.de"}, {"route": "team--jugend--u19", "email": "u13trainer@sv-markelfingen.de"}]'::jsonb) as e(route text,email text) group by route loop
  select array_agg(value) into contacts from jsonb_array_elements_text(item->'emails');
  insert into private.trainer_team_contact_emails(team_id,emails)
   select id,contacts from public.social_teams where 'team--'||replace(website_path,'/','--')=item->>'route'
   on conflict(team_id) do nothing;
 end loop;
end $import$;
