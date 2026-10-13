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
    create schema extensions;create extension pgcrypto with schema extensions;grant usage on schema extensions to service_role;
    create schema private; grant usage on schema private to service_role; create schema storage; create schema cron; create schema auth;
    create table auth.users(id uuid primary key,email text unique);grant usage on schema auth to service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
    create table public.social_people(id uuid primary key default gen_random_uuid(),slug text unique,display_name text,birth_date date,roles text[] default '{}',source_photo_url text,updated_at timestamptz default now(),active boolean default true);
    create table public.social_teams(id uuid primary key default gen_random_uuid(),slug text unique,name text,website_path text,sort_order int default 0,active boolean default false,color_source text default 'global',color_scheme jsonb,content_enabled boolean default true);
    create table public.social_team_people(team_id uuid references public.social_teams(id),person_id uuid references public.social_people(id),role text,created_at timestamptz default now(),primary key(team_id,person_id,role));
    create table public.social_admins(user_id uuid primary key,email text,role text,is_active boolean,created_at timestamptz default now(),access_areas text[] not null default array['social_media']::text[]);
    create table private.referee_club_roles(person_id uuid primary key references public.social_people(id),role text,active boolean default true);
    alter table private.referee_club_roles enable row level security;
    grant select on private.referee_club_roles to service_role;
    grant select,insert,update,delete on public.social_people,public.social_teams,public.social_team_people,public.social_admins to service_role;
    alter table public.social_people enable row level security; alter table public.social_teams enable row level security;
    alter table public.social_team_people enable row level security; alter table public.social_admins enable row level security;`);
  const catalog=JSON.parse(await readFile(new URL('config/bsv-catalog.json',root),'utf8'));
  await sql(catalog.teams.map(t=>`insert into public.social_teams(slug,name,website_path,sort_order) values(${quote(t.slug)},${quote(t.name)},${quote(t.websitePath||'')},${t.sortOrder});`).join('\n')+catalog.people.map(p=>`insert into public.social_people(slug,display_name,birth_date) values(${quote(p.slug)},${quote(p.displayName)},'1980-01-01');`).join('\n')+catalog.memberships.map(m=>`insert into public.social_team_people(team_id,person_id,role) select t.id,p.id,${quote(m.role)} from public.social_teams t,public.social_people p where t.slug=${quote(m.teamSlug)} and p.slug=${quote(m.personSlug)};`).join('\n'));
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
  await sql(`insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000020','admin@example.test');insert into public.social_admins(user_id,email,role,is_active,access_areas) values ('00000000-0000-4000-8000-000000000020','admin@example.test','admin',true,array['social_media','administration','user_management']);`);
  await sql(await readFile(new URL('supabase/migrations/20261011114319_suite_roles_profiles_navigation.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/suite-roles.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/migrations/20261011191337_cashbook_youth_leadership_deposits.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/cashbook-youth-deposits.sql',root),'utf8'));
  console.log('Jugendleitung: Einzahlungen und Entnahmen, frische Rechte und unveränderliche Belege geprüft.');
  await sql(await readFile(new URL('supabase/migrations/20261011194958_cashbook_advances.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/cashbook-advances.sql',root),'utf8'));
  console.log('Vorstrecken: Bestand, Korrekturen, Erstattung, Eigentümerbestätigung, echte E-Mail, Wiederholungen und offene Alt-Einträge geprüft.');
  // Competing settlement clicks may produce exactly one immutable event and one mail.
  const advance=JSON.parse(await sql(`set role service_role;with p as (select gen_random_uuid() request_id,a.id account_id,a.suite_user_id actor,t.id team_id from private.cashbook_accounts a,public.social_teams t where a.username='jentm' and t.slug='u19-junioren') select public.cashbook_request(actor,jsonb_build_object('action','book','requestId',request_id,'direction','advance','amountCents',5000,'teamId',team_id,'confirmed',true,'notificationEmail','trainer@example.org','evidenceHash',md5(request_id::text)||md5(request_id::text),'signatureHash',repeat('1',64),'evidencePath',account_id::text||'/'||request_id::text||'/receipt','signaturePath',account_id::text||'/'||request_id::text||'/signature')) from p;`));
  const settle=(action,username)=>sql(`set role service_role;select public.cashbook_request(suite_user_id,jsonb_build_object('action','${action}','id',${quote(advance.entryId)},'requestId',gen_random_uuid(),'confirmed',true)) from private.cashbook_accounts where username='${username}';`).then(JSON.parse);
  for(const [action,username] of [['mark_transferred','barow'],['confirm_received','jentm']]){
    const results=await Promise.all([settle(action,username),settle(action,username)]);
    if(results.filter(r=>!r.error).length!==1||results.filter(r=>r.status===409).length!==1)throw new Error('Konkurrierende Erstattungsbestätigungen wurden mehrfach gespeichert.');
  }
  if(await sql(`select count(*) from private.cashbook_alerts where entry_id=${quote(advance.entryId)};`)!=='1')throw new Error('Überweisung erzeugte mehr als eine Benachrichtigung.');
  console.log('Parallele Überweisungs- und Eingangsbestätigungen: genau ein Statuswechsel und eine Benachrichtigung.');

  await sql(`create table public.editorial_issues(id uuid primary key default gen_random_uuid(),version integer default 1,title text,kind text,publishes_on date,newsletter_settings jsonb,newsletter_selection jsonb,cover_settings jsonb,advertising jsonb,cover_path text,cover_alt text,cover_credit text,previewed_version integer,published_version integer,published_at timestamptz,updated_at timestamptz default now());
    create table public.editorial_articles(id uuid primary key default gen_random_uuid(),issue_id uuid references public.editorial_issues(id),team_id uuid references public.social_teams(id),title text,body text,author text,kind text,status text,automatic_sports boolean default false,source_snapshot jsonb,gallery_groups jsonb,people_snapshot jsonb,event_snapshot jsonb,position integer,created_at timestamptz default now());
    create table public.editorial_publications(id uuid primary key default gen_random_uuid(),issue_id uuid references public.editorial_issues(id),issue_version integer,snapshot jsonb,published_by uuid,published_at timestamptz default now());
    alter table public.editorial_issues enable row level security;alter table public.editorial_articles enable row level security;alter table public.editorial_publications enable row level security;
    grant select,insert,update on public.editorial_issues,public.editorial_articles to service_role;grant select,insert on public.editorial_publications to service_role;`);
  const publicationWorkflow=await readFile(new URL('supabase/migrations/20260920193329_editorial_publication_workflow.sql',root),'utf8');
  await sql(publicationWorkflow.match(/create or replace function private\.editorial_version[\s\S]*?end \$\$;/)[0]);
  await sql(`create trigger editorial_issues_version before update on public.editorial_issues for each row execute function private.editorial_version();revoke all on function private.editorial_version() from public,anon,authenticated;grant execute on function private.editorial_version() to service_role;`);
  await sql(publicationWorkflow.match(/create function public\.preview_editorial_issue[\s\S]*?end \$\$;/)[0]);
  const publicationApproval=await readFile(new URL('supabase/migrations/20260922092911_editorial_all_sports_automatic.sql',root),'utf8');
  await sql(publicationApproval.slice(publicationApproval.indexOf('create or replace function public.publish_editorial_issue')));
  await sql(`revoke all on function public.preview_editorial_issue(uuid,integer),public.publish_editorial_issue(uuid,integer,uuid) from public,anon,authenticated;grant execute on function public.preview_editorial_issue(uuid,integer),public.publish_editorial_issue(uuid,integer,uuid) to service_role;`);
  await sql(await readFile(new URL('supabase/migrations/20261011182000_brand_themes.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/brand-themes.sql',root),'utf8'));
  console.log('Themes: Zugriffsschutz, Validierung, öffentliche Leserechte, Heftvorschau und eingefrorene Veröffentlichungen geprüft.');

  console.log('Rollen, Zusatzrechte, Sammelaktionen, Alias-Login und zentraler BSV-Standard geprüft.');
  await sql(await readFile(new URL('supabase/migrations/20261012065302_trainer_management.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/migrations/20261012070900_trainer_directory_names.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/trainer-management.sql',root),'utf8'));
  console.log('Trainerverwaltung: Rollen, private Kontaktdaten, vier Positionen, Homepage-Freigaben, Fotos und veraltete Änderungen geprüft.');
  await sql(await readFile(new URL('supabase/migrations/20261012072811_trainer_lifecycle.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/trainer-lifecycle.sql',root),'utf8'));
  console.log('Trainerdatenbank: passiv, reaktivieren, geschütztes Löschen, private Daten, Homepage und unveränderte Finanzdaten geprüft.');
  await sql(await readFile(new URL('supabase/migrations/20261012093943_suite_activity_log.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/cashbook-advances.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/suite-activity.sql',root),'utf8'));
  console.log('Aktivitätsprotokoll: Zugriffsschutz, Historie, Anmeldungen, Filter, Folgeseiten und unveränderliche Ereignisse geprüft.');
  await sql(await readFile(new URL('supabase/migrations/20261012074319_trainer_onboarding_import.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/migrations/20261012080109_trainer_onboarding_request_signatures.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/trainer-onboarding.sql',root),'utf8'));
  console.log('Onboarding: Serverauthentifizierung, Kontakte, Mannschaft/Rolle, Freigabe, freie Positionen, Wiederholungen und bestehende Personen geprüft.');
  await sql(await readFile(new URL('supabase/migrations/20261013080627_trainer_email_contact_form.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/trainer-email-contact-form.sql',root),'utf8'));
  console.log('Trainerkontakt: E-Mail bleibt bei alten und neuen Freigaben privat; Telefonfreigaben und öffentliche Trainerkarten erhalten.');
  await sql(await readFile(new URL('supabase/migrations/20261013081948_trainer_contact_directory.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/migrations/20261013082427_trainer_contact_email_import.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/migrations/20261013091811_trainer_recovered_website_emails.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/trainer-contact-directory.sql',root),'utf8'));
  console.log('Kontaktformular: private Signaturen, aktuelle Traineradressen, zusätzliche Mannschaftskontakte, Passivschaltung, Löschung und Versionsschutz geprüft.');
  await sql(await readFile(new URL('supabase/migrations/20261013162607_trainer_team_photos.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/trainer-team-photos.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/trainer-email-contact-form.sql',root),'utf8'));
  console.log('Mannschaftsbilder: Rechte, Versionsschutz, Homepage, Heftquelle, Entfernen und E-Mail-Datenschutz geprüft.');
  await sql(await readFile(new URL('supabase/migrations/20261013163658_employee_roles.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/employee-roles.sql',root),'utf8'));
  await sql(await readFile(new URL('supabase/tests/trainer-email-contact-form.sql',root),'utf8'));
  console.log('Mitarbeiter: Mehrfachrollen, aktuelle Personenkreise, Rollenbilder, automatische Übernahme, Versionsschutz und Rechte geprüft.');
  if(process.env.CASHBOOK_DB_ADVISORS==='1'){
    const {stdout:address}=await exec('docker',['inspect','-f','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',name]);
    const {stdout}=await exec('npx',['--yes','supabase','db','advisors','--db-url',`postgresql://postgres:isolated-test-only@${address.trim()}:5432/postgres?sslmode=disable`,'--type','all','--fail-on','error'],{maxBuffer:1024*1024});
    console.log(stdout.trim());
  }
} finally {await exec('docker',['rm','-f',name]).catch(()=>{});}
