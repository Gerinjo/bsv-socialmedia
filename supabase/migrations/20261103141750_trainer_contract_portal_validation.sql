-- Preserve honest annual declarations, flag tax review and tighten portal input validation.
create function private.trainer_contract_tax_review(c private.trainer_contracts) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from private.trainer_contract_signatures s cross join lateral jsonb_each_text(s.values) e where s.contract_id=c.id and s.part='allowance' and e.key ~ '^20[0-9]{2}$' and e.value::bigint+coalesce((select sum((d.snapshot->>'monthlyCents')::bigint) from private.trainer_contracts d cross join lateral jsonb_array_elements_text(d.snapshot->'paidMonths') m where d.person_id=c.person_id and d.status in ('issued','signed') and (case when m.value::int between 7 and 11 then substring(d.season,1,4) else substring(d.season,6,4) end)=e.key),0)>(case when e.key::int>=2026 then 330000 else 300000 end))
 or exists(select 1 from private.trainer_contract_signatures s where s.contract_id=c.id and s.values->>'lateReviewRequired'='true');
$$;
revoke all on function private.trainer_contract_tax_review(private.trainer_contracts) from public,anon,authenticated;
grant execute on function private.trainer_contract_tax_review(private.trainer_contracts) to service_role;
create or replace function private.trainer_contract_portal_record(contract private.trainer_contracts) returns jsonb language sql stable security invoker set search_path='' as $$
 select (to_jsonb(contract)-array['document_path','signed_path','guardian_path','document_hash','signed_hash','guardian_hash'])||jsonb_build_object('taxReviewRequired',private.trainer_contract_tax_review(contract),'documentHash',contract.document_hash,'hasDocument',contract.document_path is not null,'hasSignedDocument',contract.signed_path is not null,'guardianConfirmed',contract.guardian_path is not null,'portalVersion',contract.portal_version,'reference','TV-'||replace(contract.season,'/','-')||'-'||lpad(contract.number::text,5,'0'),'signatures',(select coalesce(jsonb_agg(to_jsonb(s)-array['pdf_path','pdf_hash'] order by s.signed_at,s.part),'[]') from private.trainer_contract_signatures s where s.contract_id=contract.id));
$$;
create or replace function public.trainer_contract_portal_request(actor uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
  select * into s from private.trainer_contract_signatures where contract_id=c.id and trainer_contract_signatures.part=payload->>'kind';return jsonb_build_object('path',s.pdf_path,'hash',s.pdf_hash);
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
  v:=coalesce(payload->'values','{}');if jsonb_typeof(v)<>'object' then return jsonb_build_object('error','Ungültige Erklärung.','status',400);end if;
  if part='allowance' then
   if jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>2 then return jsonb_build_object('error','Freibetrag für beide Kalenderjahre ausdrücklich angeben.','status',400);end if;
   foreach year_key in array array[substring(c.season,1,4),substring(c.season,6,4)] loop if coalesce(v->>year_key,'') !~ '^[0-9]{1,9}$' then return jsonb_build_object('error','Bitte auch null Euro ausdrücklich angeben.','status',400);end if;end loop;
  elsif part='club' then
   select count(*) into signature_count from private.trainer_contract_signatures where contract_id=c.id and trainer_contract_signatures.part in ('agreement','allowance','conduct');
   if private.trainer_contract_tax_review(c) then return jsonb_build_object('error','Freibetragserklärung und bekannte Vergütung erfordern zunächst eine steuerliche Prüfung.','status',409);end if;
   if signature_count<>3 or exists(select 1 from private.trainer_contract_signatures where contract_id=c.id and trainer_contract_signatures.part='agreement' and trainer_contract_signatures.actor=actor) then return jsonb_build_object('error','Erst drei persönliche Trainer-Unterschriften; die Gegenzeichnung muss durch eine andere vertretungsberechtigte Person erfolgen.','status',409);end if;
  elsif part like 'waiver_%' then
   if c.status<>'signed' then return jsonb_build_object('error','Der Trainervertrag muss zunächst vollständig unterzeichnet vorliegen.','status',409);end if;
   if part='waiver_november' then batch_year:=substring(c.season,1,4)::int;batch_month:=11;months:=array[7,8,9,10,11];elsif part='waiver_maerz' then batch_year:=substring(c.season,6,4)::int;batch_month:=3;months:=array[12,1,2,3];elsif part='waiver_juni' then batch_year:=substring(c.season,6,4)::int;batch_month:=6;months:=array[4,5,6];else return jsonb_build_object('error','Unbekannte Abfrage.','status',400);end if;
   select (c.snapshot->>'monthlyCents')::bigint*count(*) into amount from jsonb_array_elements_text(c.snapshot->'paidMonths') m where m.value::int=any(months) and make_date(case when m.value::int>=7 then substring(c.season,1,4)::int else substring(c.season,6,4)::int end,m.value::int,1)<=(c.snapshot->>'end')::date and (make_date(case when m.value::int>=7 then substring(c.season,1,4)::int else substring(c.season,6,4)::int end,m.value::int,1)+interval '1 month -1 day')::date>=(c.snapshot->>'start')::date;
   due:=private.trainer_contract_due(batch_year,batch_month);paid:=(v->>'payoutCents')::bigint;
   if coalesce(amount,0)<=0 or (stamp at time zone 'Europe/Berlin')::date<greatest(due,(c.snapshot->>'start')::date) or v->>'amount' is distinct from amount::text or v->>'due' is distinct from due::text or coalesce(v->>'choice','') not in ('payout','donate','partial') or paid is null or paid<0 or paid>amount or (v->>'choice'='payout' and paid<>amount) or (v->>'choice'='donate' and paid<>0) or (v->>'choice'='partial' and paid not between 1 and amount-1) or v->>'waivedCents' is distinct from (amount-paid)::text then return jsonb_build_object('error','Betrag, Fälligkeit und Auszahlungswahl bitte erneut prüfen.','status',400);end if;
   v:=v||jsonb_build_object('lateReviewRequired',(stamp at time zone 'Europe/Berlin')::date>(due+interval '1 year')::date);
  elsif part not in ('agreement','conduct') then return jsonb_build_object('error','Unbekanntes Dokument.','status',400);end if;
  select evidence_hash into previous_hash from private.trainer_contract_signatures where contract_id=c.id order by signed_at desc,trainer_contract_signatures.part desc limit 1;
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
