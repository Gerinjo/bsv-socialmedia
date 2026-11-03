-- Resolve RPC actor/part variables explicitly; qualified references remain columns.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.trainer_contract_portal_request(uuid,jsonb)'::regprocedure) into definition;
 if position('AS $function$' in definition)=0 then raise exception 'Unexpected portal function definition';end if;
 definition:=replace(definition,'AS $function$','AS $function$
#variable_conflict use_variable');
 execute definition;
end $migration$;
