-- Authenticated person ownership is independent of contract-administration grants.
alter table private.trainer_contracts add column portal_version bigint not null default 0;
alter table private.trainer_contracts add column guardian_path text;
alter table private.trainer_contracts add column guardian_hash text;
alter table private.trainer_contracts add constraint trainer_contract_guardian_file check((guardian_path is null and guardian_hash is null) or (guardian_path like id::text||'/guardian/%' and guardian_hash ~ '^[a-f0-9]{64}$'));
create table private.trainer_contract_signatures(
 contract_id uuid not null references private.trainer_contracts(id) on delete cascade,
 part text not null check(part in ('agreement','allowance','conduct','club','waiver_november','waiver_maerz','waiver_juni')),
 actor uuid references auth.users(id) on delete set null,request_id uuid not null unique,
 signer_name text not null,place text not null check(length(place) between 1 and 100),
 signed_at timestamptz not null default now(),document_hash text not null check(document_hash ~ '^[a-f0-9]{64}$'),
 "values" jsonb not null,strokes jsonb not null check(jsonb_typeof(strokes)='array' and octet_length(strokes::text)<180000),
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),previous_hash text,
 pdf_path text,pdf_hash text,primary key(contract_id,part),
 check((pdf_path is null and pdf_hash is null) or (pdf_path like contract_id::text||'/signatures/%' and pdf_hash ~ '^[a-f0-9]{64}$'))
);
create index trainer_contract_signatures_actor on private.trainer_contract_signatures(actor);
alter table private.trainer_contract_signatures enable row level security;
revoke all on private.trainer_contract_signatures from public,anon,authenticated;
grant select,insert,update on private.trainer_contract_signatures to service_role;

create function private.trainer_contract_due(y int,m int) returns date language plpgsql immutable security invoker set search_path='' as $$
declare a int:=y%19;b int:=y/100;c int:=y%100;d int:=b/4;e int:=b%4;f int:=(b+8)/25;g int:=(b-f+1)/3;h int:=(19*a+b-d-g+15)%30;i int:=c/4;k int:=c%4;l int:=(32+2*e+2*i-h-k)%7;n int:=(a+11*h+22*l)/451;easter date;day date;counted int:=0;
begin easter:=make_date(y,(h+l-7*n+114)/31,(h+l-7*n+114)%31+1);day:=(make_date(y,m,1)+interval '1 month -1 day')::date;
 loop if extract(isodow from day)<6 and day not in (make_date(y,1,1),make_date(y,5,1),make_date(y,12,25),make_date(y,12,26),easter-2,easter+1) then counted:=counted+1;if counted=3 then return day;end if;end if;day:=day-1;end loop;
end $$;
create function private.trainer_contract_ink_valid(ink jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare stroke jsonb;point jsonb;previous jsonb;points int:=0;distance numeric:=0;
begin
 if ink is null or jsonb_typeof(ink)<>'array' or jsonb_array_length(ink) not between 1 and 80 or octet_length(ink::text)>=180000 then return false;end if;
 for stroke in select value from jsonb_array_elements(ink) loop
  if jsonb_typeof(stroke)<>'array' or jsonb_array_length(stroke) not between 2 and 1200 then return false;end if;previous:=null;
  for point in select value from jsonb_array_elements(stroke) loop
   if jsonb_typeof(point)<>'array' or jsonb_array_length(point)<>2 or jsonb_typeof(point->0)<>'number' or jsonb_typeof(point->1)<>'number' then return false;end if;
   if (point->>0)::numeric not between 0 and 1 or (point->>1)::numeric not between 0 and 1 then return false;end if;
   points:=points+1;if previous is not null then distance:=distance+sqrt(power((point->>0)::numeric-(previous->>0)::numeric,2)+power((point->>1)::numeric-(previous->>1)::numeric,2));end if;previous:=point;
  end loop;
 end loop;return points between 5 and 8000 and distance>=.08;
end $$;
create function private.trainer_contract_portal_record(contract private.trainer_contracts) returns jsonb language sql stable security invoker set search_path='' as $$
 select (to_jsonb(contract)-array['document_path','signed_path','guardian_path','document_hash','signed_hash','guardian_hash'])||jsonb_build_object('documentHash',contract.document_hash,'hasDocument',contract.document_path is not null,'hasSignedDocument',contract.signed_path is not null,'guardianConfirmed',contract.guardian_path is not null,'portalVersion',contract.portal_version,'reference','TV-'||replace(contract.season,'/','-')||'-'||lpad(contract.number::text,5,'0'),'signatures',(select coalesce(jsonb_agg(to_jsonb(s)-array['pdf_path','pdf_hash'] order by s.signed_at,s.part),'[]') from private.trainer_contract_signatures s where s.contract_id=contract.id));
$$;
create function public.trainer_contract_portal_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare member public.social_admins;c private.trainer_contracts;s private.trainer_contract_signatures;act text:=payload->>'action';part text:=payload->>'part';administrator boolean;canonical jsonb;stamp timestamptz:=clock_timestamp();v jsonb;year_key text;batch_year int;batch_month int;months int[];amount bigint;paid bigint;due date;previous_hash text;signature_count int;
begin
 perform pg_advisory_xact_lock(7041956);
 select * into member from public.social_admins where user_id=actor for share;
 if not found or not member.is_active or member.is_blocked then return jsonb_build_object('error','Aktiver persönlicher Suite-Zugang erforderlich.','status',403);end if;
 administrator:=member.role='admin' or 'trainer_contracts'=any(member.access_areas);
 if act='list' then return jsonb_build_object('contracts',(select coalesce(jsonb_agg(private.trainer_contract_portal_record(d) order by d.updated_at desc),'[]') from private.trainer_contracts d where d.person_id=member.person_id),'linked',member.person_id is not null);end if;
 select * into c from private.trainer_contracts where id=(payload->>'id')::uuid for update;
 if not found then return jsonb_build_object('error','Vertrag nicht gefunden.','status',404);end if;
 if not administrator and c.person_id is distinct from member.person_id then return jsonb_build_object('error','Kein Zugriff auf diesen Vertrag.','status',403);end if;
 if act='get' then return private.trainer_contract_portal_record(c)||jsonb_build_object('canCountersign',administrator);end if;
 if act in ('authorize_guardian','authorize_seal') then if not administrator or c.status<>'issued' or c.portal_version::text is distinct from payload->>'version' then return jsonb_build_object('error','Aktuelle Vertragsberechtigung erforderlich.','status',403);end if;return jsonb_build_object('ok',true);end if;
 if act='file' then
  if payload->>'kind'='guardian' then return jsonb_build_object('path',c.guardian_path,'hash',c.guardian_hash);end if;
  if payload->>'kind'='base' then return jsonb_build_object('path',c.document_path,'hash',c.document_hash);end if;
  if payload->>'kind'='signed' then return jsonb_build_object('path',c.signed_path,'hash',c.signed_hash);end if;
  select * into s from private.trainer_contract_signatures where contract_id=c.id and part=payload->>'kind';return jsonb_build_object('path',s.pdf_path,'hash',s.pdf_hash);
 end if;
 if c.status='cancelled' then return jsonb_build_object('error','Stornierte Unterlagen können nur gelesen werden.','status',409);end if;
 if act='sign' then
  if part='club' then
   if not administrator then return jsonb_build_object('error','Vertragsberechtigung für Gegenzeichnung erforderlich.','status',403);end if;
  elsif c.person_id is null or member.person_id is distinct from c.person_id then return jsonb_build_object('error','Nur der zugeordnete Trainer kann diese Erklärung persönlich unterzeichnen.','status',403);end if;
  select * into s from private.trainer_contract_signatures where contract_id=c.id and trainer_contract_signatures.part=payload->>'part';
  if found then if s.actor=actor and s.request_id=(payload->>'requestId')::uuid then return private.trainer_contract_portal_record(c);end if;return jsonb_build_object('error','Dieses Dokument ist bereits unterzeichnet.','status',409);end if;
  if c.portal_version::text is distinct from payload->>'version' or c.document_hash is distinct from payload->>'documentHash' then return jsonb_build_object('error','Die Unterlagen wurden inzwischen geändert. Bitte neu laden und erneut prüfen.','status',409);end if;
  if c.status not in ('issued','signed') or c.document_hash is null or payload->>'confirmed' is distinct from 'true' or not private.trainer_contract_ink_valid(payload->'strokes') or length(trim(coalesce(payload->>'place',''))) not between 1 and 100 or (payload->>'place') ~ '[[:cntrl:]]' then return jsonb_build_object('error','Bitte das freigegebene Dokument prüfen und persönlich unterschreiben.','status',400);end if;
  if part in ('agreement','allowance','conduct','club') and c.status<>'issued' then return jsonb_build_object('error','Diese Vertragsfassung ist bereits abgeschlossen.','status',409);end if;
  v:=coalesce(payload->'values','{}');
  if part='allowance' then
   if jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>2 then return jsonb_build_object('error','Freibetrag für beide Kalenderjahre ausdrücklich angeben.','status',400);end if;
   foreach year_key in array array[substring(c.season,1,4),substring(c.season,6,4)] loop if coalesce(v->>year_key,'') !~ '^[0-9]{1,9}$' then return jsonb_build_object('error','Bitte auch null Euro ausdrücklich angeben.','status',400);end if;end loop;
  elsif part='club' then
   select count(*) into signature_count from private.trainer_contract_signatures where contract_id=c.id and trainer_contract_signatures.part in ('agreement','allowance','conduct');
   if signature_count<>3 or exists(select 1 from private.trainer_contract_signatures where contract_id=c.id and trainer_contract_signatures.part='agreement' and trainer_contract_signatures.actor=actor) then return jsonb_build_object('error','Erst drei persönliche Trainer-Unterschriften; die Gegenzeichnung muss durch eine andere vertretungsberechtigte Person erfolgen.','status',409);end if;
  elsif part like 'waiver_%' then
   if c.status<>'signed' then return jsonb_build_object('error','Der Trainervertrag muss zunächst vollständig unterzeichnet vorliegen.','status',409);end if;
   if part='waiver_november' then batch_year:=substring(c.season,1,4)::int;batch_month:=11;months:=array[7,8,9,10,11];elsif part='waiver_maerz' then batch_year:=substring(c.season,6,4)::int;batch_month:=3;months:=array[12,1,2,3];elsif part='waiver_juni' then batch_year:=substring(c.season,6,4)::int;batch_month:=6;months:=array[4,5,6];else return jsonb_build_object('error','Unbekannte Abfrage.','status',400);end if;
   select (c.snapshot->>'monthlyCents')::bigint*count(*) into amount from jsonb_array_elements_text(c.snapshot->'paidMonths') m where m.value::int=any(months) and make_date(case when m.value::int>=7 then substring(c.season,1,4)::int else substring(c.season,6,4)::int end,m.value::int,1)<=(c.snapshot->>'end')::date and (make_date(case when m.value::int>=7 then substring(c.season,1,4)::int else substring(c.season,6,4)::int end,m.value::int,1)+interval '1 month -1 day')::date>=(c.snapshot->>'start')::date;
   due:=private.trainer_contract_due(batch_year,batch_month);paid:=(v->>'payoutCents')::bigint;
   if coalesce(amount,0)<=0 or (stamp at time zone 'Europe/Berlin')::date<greatest(due,(c.snapshot->>'start')::date) or v->>'amount' is distinct from amount::text or v->>'due' is distinct from due::text or v->>'choice' not in ('payout','donate','partial') or paid is null or paid<0 or paid>amount or (v->>'choice'='payout' and paid<>amount) or (v->>'choice'='donate' and paid<>0) or (v->>'choice'='partial' and paid not between 1 and amount-1) or v->>'waivedCents' is distinct from (amount-paid)::text then return jsonb_build_object('error','Betrag, Fälligkeit und Auszahlungswahl bitte erneut prüfen.','status',400);end if;
  elsif part not in ('agreement','conduct') then return jsonb_build_object('error','Unbekanntes Dokument.','status',400);end if;
  select evidence_hash into previous_hash from private.trainer_contract_signatures where contract_id=c.id order by signed_at desc,part desc limit 1;
  canonical:=jsonb_build_object('contractId',c.id,'part',part,'actor',actor,'requestId',payload->>'requestId','signer',case when part='club' then trim(member.first_name||' '||member.last_name) else c.snapshot->>'name' end,'place',trim(payload->>'place'),'signedAt',stamp,'documentHash',c.document_hash,'values',v,'strokes',payload->'strokes','previousHash',previous_hash);
  insert into private.trainer_contract_signatures(contract_id,part,actor,request_id,signer_name,place,signed_at,document_hash,"values",strokes,evidence_hash,previous_hash) values(c.id,part,actor,(payload->>'requestId')::uuid,canonical->>'signer',canonical->>'place',stamp,c.document_hash,v,payload->'strokes',encode(extensions.digest(convert_to(canonical::text,'UTF8'),'sha256'),'hex'),previous_hash);
  update private.trainer_contracts set portal_version=portal_version+1,version=version+1,updated_at=stamp,updated_by=actor where id=c.id returning * into c;
  insert into private.trainer_contract_audit(contract_id,actor,action,version) values(c.id,actor,'digital_sign_'||part,c.version);return private.trainer_contract_portal_record(c);
 end if;
 if act='artifact' then
  select * into s from private.trainer_contract_signatures where contract_id=c.id and trainer_contract_signatures.part=payload->>'part' for update;
  if not found or (not administrator and c.person_id is distinct from member.person_id) or s.evidence_hash is distinct from payload->>'evidenceHash' then return jsonb_build_object('error','Kein Zugriff auf diesen Nachweis.','status',403);end if;
  if s.pdf_path is not null then return jsonb_build_object('ok',true);end if;
  if payload->>'path' not like c.id::text||'/signatures/%' or coalesce(payload->>'hash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','Ungültige Dokumentdatei.','status',400);end if;
  update private.trainer_contract_signatures set pdf_path=payload->>'path',pdf_hash=payload->>'hash' where contract_id=c.id and trainer_contract_signatures.part=payload->>'part';return jsonb_build_object('ok',true);
 end if;
 if act in ('guardian','seal') then
  if not administrator then return jsonb_build_object('error','Vertragsberechtigung erforderlich.','status',403);end if;
  if c.portal_version::text is distinct from payload->>'version' then return jsonb_build_object('error','Daten inzwischen geändert. Bitte neu laden.','status',409);end if;
  if act='guardian' then
   if c.status<>'issued' or payload->>'confirmed' is distinct from 'true' or nullif(c.snapshot->>'guardianName','') is null or payload->>'path' not like c.id::text||'/guardian/%' or coalesce(payload->>'hash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','Bitte die echte Zustimmung der sorgeberechtigten Person als PDF bestätigen.','status',400);end if;
   if c.guardian_path is not null then return jsonb_build_object('error','Die Zustimmung liegt bereits vor.','status',409);end if;
   update private.trainer_contracts set guardian_path=payload->>'path',guardian_hash=payload->>'hash',portal_version=portal_version+1,version=version+1,updated_at=stamp,updated_by=actor where id=c.id returning * into c;
  else
   if c.status='signed' then return private.trainer_contract_portal_record(c);end if;
   select count(*) into signature_count from private.trainer_contract_signatures where contract_id=c.id and trainer_contract_signatures.part in ('agreement','allowance','conduct','club');
   if c.status<>'issued' or signature_count<>4 or ((c.snapshot->>'birthDate')::date+interval '18 years')::date>(c.snapshot->>'start')::date and c.guardian_path is null or payload->>'path' not like c.id::text||'/signed/%' or coalesce(payload->>'hash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','Erforderliche Unterschriften oder Zustimmung fehlen.','status',409);end if;
   update private.trainer_contracts set status='signed',signed_path=payload->>'path',signed_hash=payload->>'hash',signed_at=stamp,version=version+1,updated_at=stamp,updated_by=actor where id=c.id returning * into c;
  end if;
  insert into private.trainer_contract_audit(contract_id,actor,action,version) values(c.id,actor,act,c.version);return private.trainer_contract_portal_record(c);
 end if;
 return jsonb_build_object('error','Unbekannte Vertragsaktion.','status',400);
end $$;
revoke all on function private.trainer_contract_due(int,int),private.trainer_contract_ink_valid(jsonb),private.trainer_contract_portal_record(private.trainer_contracts),public.trainer_contract_portal_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.trainer_contract_due(int,int),private.trainer_contract_ink_valid(jsonb),private.trainer_contract_portal_record(private.trainer_contracts),public.trainer_contract_portal_request(uuid,jsonb) to service_role;

alter function public.trainer_contract_request(uuid,jsonb) rename to trainer_contract_request_before_portal;
alter function public.trainer_contract_request_before_portal(uuid,jsonb) set schema private;
revoke all on function private.trainer_contract_request_before_portal(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.trainer_contract_request_before_portal(uuid,jsonb) to service_role;
create function public.trainer_contract_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb;
begin
 r:=private.trainer_contract_request_before_portal(actor,payload);if r ? 'error' then return r;end if;
 if payload->>'action' in ('list','source') then r:=r||jsonb_build_object('contracts',(select coalesce(jsonb_agg(x||jsonb_build_object('digitalComplete',c.status='signed','guardianConfirmed',c.guardian_path is not null,'signatureCount',(select count(*) from private.trainer_contract_signatures s where s.contract_id=c.id and s.part in ('agreement','allowance','conduct')),'declarations',(select coalesce(jsonb_agg(jsonb_build_object('part',s.part,'choice',s.values->>'choice','signedAt',s.signed_at)),'[]') from private.trainer_contract_signatures s where s.contract_id=c.id and s.part like 'waiver_%'))),'[]') from jsonb_array_elements(r->'contracts') x join private.trainer_contracts c on c.id=(x->>'id')::uuid));end if;return r;
end $$;
revoke all on function public.trainer_contract_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.trainer_contract_request(uuid,jsonb) to service_role;
