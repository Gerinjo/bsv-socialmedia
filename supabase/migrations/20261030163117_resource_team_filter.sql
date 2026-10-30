begin;
-- Personal team membership is independent from administrators' booking rights.
do $migration$
declare definition text; marker text:=$marker$'canBook',t.id=any(own_teams)$marker$;
begin
 definition:=pg_get_functiondef('public.resource_request(uuid,jsonb)'::regprocedure);
 if position(marker in definition)=0 or position($check$'isOwn'$check$ in definition)>0 then raise exception 'Ressourcen-Teamabfrage wurde geändert. Filtermigration prüfen.';end if;
 definition:=replace(definition,marker,marker||$new$,'isOwn',exists(select 1 from public.social_team_people own_tp join private.trainer_profiles own_p on own_p.person_id=own_tp.person_id where own_tp.team_id=t.id and own_tp.person_id=person and own_tp.staff_slot is not null and own_p.active)$new$);
 -- The six-week calendar can end thirteen days into the following month.
 definition:=replace(definition,'to_date:=to_date+7;','to_date:=to_date+14;');
 execute definition;
end $migration$;
commit;
