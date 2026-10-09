#!/usr/bin/env node
// Isolated PostgreSQL integration tests; no connection to the online safe.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
const exec=promisify(execFile);
const name=`bsv-cashbook-test-${process.pid}`;
const root=new URL('../',import.meta.url);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
async function sql(text){return new Promise((resolve,reject)=>{const child=execFile('docker',['exec','-i',name,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres'],{maxBuffer:1024*1024},(error,stdout,stderr)=>error?reject(new Error(stderr||error.message)):resolve(stdout.trim()));child.stdin.end(text);});}
try {
  await exec('docker',['run','--rm','-d','--name',name,'-e','POSTGRES_PASSWORD=isolated-test-only','postgres:17-alpine']);
  // Initialization briefly starts a socket-only server before restarting PostgreSQL.
  for(let count=0;;count++){try{await exec('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch{if(count>=30)throw new Error('Testdatenbank startet nicht.');await delay(300);}}
  await sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema private; grant usage on schema private to service_role; create schema storage; create schema cron; create schema auth;
    create table auth.users(id uuid primary key,email text unique);grant usage on schema auth to service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
    create table public.social_people(id uuid primary key default gen_random_uuid(),slug text unique,display_name text,birth_date date,active boolean default true);
    create table public.social_teams(id uuid primary key default gen_random_uuid(),slug text unique,name text,sort_order int default 0,active boolean default false);
    create table public.social_team_people(team_id uuid references public.social_teams(id),person_id uuid references public.social_people(id),role text,primary key(team_id,person_id,role));
    create table public.social_admins(user_id uuid primary key,email text,role text,is_active boolean,access_areas text[] not null default array['social_media']::text[]);
    create table private.referee_club_roles(person_id uuid primary key references public.social_people(id),role text,active boolean default true);
    alter table private.referee_club_roles enable row level security;
    grant select on private.referee_club_roles to service_role;
    grant select,insert,update,delete on public.social_people,public.social_teams,public.social_team_people,public.social_admins to service_role;
    alter table public.social_people enable row level security; alter table public.social_teams enable row level security;
    alter table public.social_team_people enable row level security; alter table public.social_admins enable row level security;`);
  const catalog=JSON.parse(await readFile(new URL('config/bsv-catalog.json',root),'utf8'));
  await sql(catalog.teams.map(t=>`insert into public.social_teams(slug,name,sort_order) values(${quote(t.slug)},${quote(t.name)},${t.sortOrder});`).join('\n')+catalog.people.map(p=>`insert into public.social_people(slug,display_name,birth_date) values(${quote(p.slug)},${quote(p.displayName)},'1980-01-01');`).join('\n')+catalog.memberships.map(m=>`insert into public.social_team_people(team_id,person_id,role) select t.id,p.id,${quote(m.role)} from public.social_teams t,public.social_people p where t.slug=${quote(m.teamSlug)} and p.slug=${quote(m.personSlug)};`).join('\n'));
  await sql("insert into private.referee_club_roles(person_id,role) select id,'youth_leadership' from public.social_people where slug in ('jerome-ernsberger','ole-schmal');");
  await sql(await readFile(new URL('supabase/migrations/20261009110737_cashbook.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/migrations/20261009141432_cashbook_suite_identity_lookup.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/migrations/20261009182055_cashbook_own_entry_changes.sql',root),'utf8'));
  await sql(`insert into auth.users(id,email) select person_id,username||'@example.test' from private.cashbook_accounts;
    update private.cashbook_accounts set suite_user_id=person_id;
    insert into public.social_admins(user_id,email,role,is_active,access_areas) select suite_user_id,username||'@example.test','sm-team',true,array['cashbook']::text[] from private.cashbook_accounts;`);
  console.log('Migration auf PostgreSQL 17 angewendet; Vereinsverzeichnis importiert.');
  await sql(await readFile(new URL('supabase/tests/cashbook.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/cashbook-changes.sql',root),'utf8'));
  console.log('D–A-Trainer, Jugendleitung, Zugriffe, gemeinsamer Suite-Login, Buchungen, Belege, Schwelle, Wiederholungen und unveränderliches Logbuch geprüft.');
  const {cashbookUsername}=await import('../src/cashbook.mjs');
  for(const person of catalog.people){const actual=await sql(`select private.cashbook_username(${quote(person.displayName)})`);if(actual!==cashbookUsername(person.displayName))throw new Error(`Login-Normalisierung weicht ab: ${person.displayName}`);}
  console.log('Login-Normalisierung für das gesamte Vereinsverzeichnis in Browser und Datenbank identisch.');
  // Both transactions can individually afford 40 EUR, together they cannot.
  await sql(`insert into private.cashbook_entries(account_id,request_id,direction,amount_cents,balance_after_cents,person_name,team_name,evidence_path,evidence_hash)
    select id,gen_random_uuid(),'deposit',5000,5000,'Test Kasse','Test','concurrency/deposit',repeat('d',64) from private.cashbook_accounts where username='barow';
`);
  // Paths and request IDs must agree; derive all server-generated values in one CTE.
  const concurrent=hash=>sql(`with params as (select gen_random_uuid() request_id,a.id account_id,a.suite_user_id actor,t.id team_id from private.cashbook_accounts a,public.social_teams t where a.username='${hash==='1'?'jentm':'schmo'}' and t.slug='u19-junioren')
    select public.cashbook_request(actor,jsonb_build_object('action','book','requestId',request_id,'direction','withdrawal','amountCents',4000,'confirmed',true,'teamId',team_id,'evidenceHash',repeat('${hash}',64),'signatureHash',repeat('${hash}',64),'evidencePath',account_id::text||'/'||request_id::text||'/evidence','signaturePath',account_id::text||'/'||request_id::text||'/signature')) from params;`).then(JSON.parse);
  const results=await Promise.all([concurrent('1'),concurrent('2')]);
  if(results.filter(r=>!r.error).length!==1||results.filter(r=>r.status===409).length!==1||await sql('select private.cashbook_balance()')!=='1000')throw new Error('Parallele Auszahlungen haben den Bestand verletzt.');
  console.log('Zwei gleichzeitige Auszahlungen: eine bestätigt, eine abgelehnt; Bestand korrekt 10,00 EUR.');
  const winningEntry=results.find(r=>!r.error).entryId;
  const concurrentEdit=amount=>sql(`set role service_role; with params as (select gen_random_uuid() request_id,e.id entry_id,e.account_id,a.suite_user_id actor,e.team_id,e.evidence_path,e.evidence_hash from private.cashbook_entries e join private.cashbook_accounts a on a.id=e.account_id where e.id=${quote(winningEntry)})
    select public.cashbook_request(actor,jsonb_build_object('action','edit','id',entry_id,'requestId',request_id,'amountCents',${amount},'confirmed',true,'teamId',team_id,'note','Parallel test','reason','Betrag korrigiert','evidencePath',evidence_path,'evidenceHash',evidence_hash,'signatureHash',repeat('7',64),'signaturePath',account_id::text||'/'||request_id::text||'/signature')) from params;`).then(JSON.parse);
  const edits=await Promise.all([concurrentEdit(3000),concurrentEdit(2000)]);
  if(edits.filter(r=>!r.error).length!==1||edits.filter(r=>r.status===409).length!==1||!['2000','3000'].includes(await sql('select private.cashbook_balance()')))throw new Error('Parallele Änderungen haben dieselbe Buchung mehrfach korrigiert.');
  console.log('Zwei gleichzeitige Änderungen: genau eine neue Fassung; andere Änderung als veraltet abgelehnt.');
  // The delivery lease prevents two workers from sending the same item.
  const claims=await Promise.all([sql("select public.cashbook_alert_request('{\"action\":\"claim\"}')"),sql("select public.cashbook_alert_request('{\"action\":\"claim\"}')")]);
  if(claims.filter(Boolean).length!==1)throw new Error('Eine Erinnerung wurde mehrfach reserviert.');
  console.log('Gleichzeitige E-Mail-Worker reservieren die Erinnerung genau einmal.');
  if(process.env.CASHBOOK_DB_ADVISORS==='1'){
    const {stdout:address}=await exec('docker',['inspect','-f','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',name]);
    const {stdout}=await exec('npx',['--yes','supabase','db','advisors','--db-url',`postgresql://postgres:isolated-test-only@${address.trim()}:5432/postgres?sslmode=disable`,'--type','all','--fail-on','error'],{maxBuffer:1024*1024});
    console.log(stdout.trim());
  }
} finally {await exec('docker',['rm','-f',name]).catch(()=>{});}
