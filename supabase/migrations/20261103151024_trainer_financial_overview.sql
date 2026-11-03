-- Financial decision data is returned only with current contract-administration access.
create function public.trainer_finances_request(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
#variable_conflict use_variable
declare member public.social_admins;season_key text:=payload->>'season';current_plan private.trainer_compensation_plans;decisions boolean;
begin
 perform pg_advisory_xact_lock(7041956);
 select * into member from public.social_admins where user_id=actor for share;
 if not found or not member.is_active or member.is_blocked or (member.role<>'admin' and not member.access_areas&&array['trainer_compensation','trainer_contracts']::text[]) then return jsonb_build_object('error','Berechtigung für Gehaltskonzept oder Trainerverträge erforderlich.','status',403);end if;
 if payload->>'action' is distinct from 'list' or season_key is null or season_key !~ '^20[0-9]{2}/20[0-9]{2}$' or substring(season_key,6,4)::int<>substring(season_key,1,4)::int+1 then return jsonb_build_object('error','Ungültige Auswertung oder Saison.','status',400);end if;
 decisions:=member.role='admin' or 'trainer_contracts'=any(member.access_areas);
 select * into current_plan from private.trainer_compensation_plans where season=season_key;
 return jsonb_build_object('season',season_key,'asOf',(now() at time zone 'Europe/Berlin')::date,'version',coalesce(current_plan.version,0),'plan',current_plan.plan,'canViewDecisions',decisions,
  'teams',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'slug',t.slug,'name',t.name,'active',t.active) order by t.sort_order,t.slug),'[]') from public.social_teams t where t.slug in ('herren-1','herren-2','frauen-1','frauen-2') or t.slug ~ '^u[0-9]' or (decisions and exists(select 1 from private.trainer_contracts c where c.team_id=t.id and c.season=season_key and c.status<>'cancelled'))),
  'people',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(trim(tp.first_name||' '||tp.last_name),''),p.display_name),'active',p.active and coalesce(tp.active,true),'qualification',coalesce(tp.qualification,''),'photoSource',private.employee_photo_source(p.id,'trainer')) order by p.display_name),'[]') from public.social_people p left join private.trainer_profiles tp on tp.person_id=p.id where exists(select 1 from public.social_team_people a join public.social_teams t on t.id=a.team_id where a.person_id=p.id and a.staff_slot is not null and (t.slug in ('herren-1','herren-2','frauen-1','frauen-2') or t.slug ~ '^u[0-9]')) or (decisions and exists(select 1 from private.trainer_contracts c where c.person_id=p.id and c.season=season_key and c.status<>'cancelled'))),
  'assignments',(select coalesce(jsonb_agg(jsonb_build_object('teamId',a.team_id,'personId',a.person_id,'slot',a.staff_slot,'websiteRole',coalesce(nullif(a.website_role,''),a.role)) order by a.team_id,a.staff_slot),'[]') from public.social_team_people a join public.social_teams t on t.id=a.team_id where a.staff_slot is not null and (t.slug in ('herren-1','herren-2','frauen-1','frauen-2') or t.slug ~ '^u[0-9]')),
  'contracts',case when not decisions then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'season',c.season,'personId',c.person_id,'teamId',c.team_id,'slot',c.slot,'status',c.status,'name',c.snapshot->>'name','teamName',c.snapshot->>'teamName','teamSlug',c.snapshot->>'teamSlug','taxReviewRequired',private.trainer_contract_tax_review(c),'snapshot',(select coalesce(jsonb_object_agg(e.key,e.value),'{}') from jsonb_each(c.snapshot) e where e.key=any(array['start','end','monthlyCents','grossMonthlyCents','share','paidMonths','license','role','teamName','teamSlug','financialConfirmed','financialCategory'])),'declarations',(select coalesce(jsonb_agg(jsonb_build_object('part',s.part,'choice',s.values->>'choice','amount',s.values->'amount','payoutCents',s.values->'payoutCents','waivedCents',s.values->'waivedCents','due',s.values->>'due','signedAt',s.signed_at,'lateReviewRequired',s.values->'lateReviewRequired') order by s.part),'[]') from private.trainer_contract_signatures s where s.contract_id=c.id and s.part in ('waiver_november','waiver_maerz','waiver_juni'))) order by c.updated_at desc),'[]') from private.trainer_contracts c where c.season=season_key and c.status<>'cancelled') end);
end $$;
revoke all on function public.trainer_finances_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.trainer_finances_request(uuid,jsonb) to service_role;

alter function public.trainer_compensation_request(uuid,jsonb) rename to trainer_compensation_request_before_finances;
alter function public.trainer_compensation_request_before_finances(uuid,jsonb) set schema private;
revoke all on function private.trainer_compensation_request_before_finances(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.trainer_compensation_request_before_finances(uuid,jsonb) to service_role;
create function public.trainer_compensation_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(7041956);result:=private.trainer_compensation_request_before_finances(actor,payload);if result ? 'error' then return result;end if;
 if payload->>'action'='list' then result:=result||jsonb_build_object('people',(select coalesce(jsonb_agg(p||jsonb_build_object('photoSource',private.employee_photo_source((p->>'id')::uuid,'trainer')) order by n),'[]') from jsonb_array_elements(result->'people') with ordinality rows(p,n)));end if;return result;
end $$;
revoke all on function public.trainer_compensation_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.trainer_compensation_request(uuid,jsonb) to service_role;

alter function public.trainer_contract_request(uuid,jsonb) rename to trainer_contract_request_before_finances;
alter function public.trainer_contract_request_before_finances(uuid,jsonb) set schema private;
revoke all on function private.trainer_contract_request_before_finances(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.trainer_contract_request_before_finances(uuid,jsonb) to service_role;
create function public.trainer_contract_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(7041956);result:=private.trainer_contract_request_before_finances(actor,payload);if result ? 'error' then return result;end if;
 if payload->>'action' in ('list','source') then result:=result||jsonb_build_object('people',(select coalesce(jsonb_agg(p||jsonb_build_object('photoSource',private.employee_photo_source((p->>'id')::uuid,'trainer')) order by n),'[]') from jsonb_array_elements(result->'people') with ordinality rows(p,n)),'contracts',(select coalesce(jsonb_agg(c||jsonb_build_object('photoSource',private.employee_photo_source((c->>'personId')::uuid,'trainer')) order by n),'[]') from jsonb_array_elements(result->'contracts') with ordinality rows(c,n)));
 elsif payload->>'action'='get' then result:=result||jsonb_build_object('photoSource',private.employee_photo_source((result->>'person_id')::uuid,'trainer'));end if;return result;
end $$;
revoke all on function public.trainer_contract_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.trainer_contract_request(uuid,jsonb) to service_role;
