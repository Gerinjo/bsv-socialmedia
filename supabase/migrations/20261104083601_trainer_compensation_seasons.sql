-- Expose the saved season catalog only after the existing live financial
-- authorization succeeds. Existing per-season plans, versions and audit stay
-- untouched; visiting an unsaved season does not create a financial record.
create or replace function public.trainer_compensation_request(actor uuid,payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(7041956);
 result:=private.trainer_compensation_request_before_finances(actor,payload);
 if result ? 'error' then return result;end if;
 if payload->>'action'='list' then
  result:=result||jsonb_build_object(
   'people',(select coalesce(jsonb_agg(p||jsonb_build_object('photoSource',private.employee_photo_source((p->>'id')::uuid,'trainer')) order by n),'[]') from jsonb_array_elements(result->'people') with ordinality rows(p,n)),
   'seasons',(select coalesce(jsonb_agg(s.season order by s.season desc),'[]') from private.trainer_compensation_plans s),
   'savedAt',(select s.updated_at from private.trainer_compensation_plans s where s.season=payload->>'season')
  );
 end if;
 return result;
end $$;
revoke all on function public.trainer_compensation_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.trainer_compensation_request(uuid,jsonb) to service_role;
