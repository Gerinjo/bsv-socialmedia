#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
const exec = promisify(execFile);
const name = `bsv-sponsor-test-${process.pid}`;
const root = new URL('../', import.meta.url);
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
function sql(text) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'],
      { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout.trim()));
    child.stdin.end(text);
  });
}
try {
  await exec('docker', ['run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=isolated-test-only', 'postgres:17-alpine']);
  for (let n = 0;; n++) {
    try { await exec('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); break; }
    catch { if (n >= 30) throw new Error('Test database did not start'); await delay(300); }
  }
  await sql(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema private;grant usage on schema private to service_role;
    create function private.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
    create table public.social_post_audiences(id uuid primary key default gen_random_uuid(),slug text unique,label text,audience_group text,active boolean default true);
    grant select on public.social_post_audiences to service_role;
    insert into public.social_post_audiences(slug,label,audience_group) values ('gesamtverein','Gesamtverein','club'),('herren-1','Herren 1','mens_team');`);
  for (const file of ['20260815110449_add_sponsor_administration.sql', '20260901222257_add_sponsor_website_assignments.sql', '20260904083028_add_sponsor_types_and_assignment_details.sql', '20260909102233_add_stadionheft_sponsor_page_size.sql']) {
    await sql(await readFile(new URL(`supabase/migrations/${file}`, root), 'utf8'));
  }
  await sql(`insert into public.social_sponsors(slug,name) values ('graf','Garten Graf'),('rival','Other partner');
    insert into public.social_sponsor_website_assignments(sponsor_id,audience_id,sponsor_type_id,page_size,description)
    select s.id,a.id,t.id,'1/3','Existing advertisement' from public.social_sponsors s,public.social_post_audiences a,public.social_sponsor_types t
    where s.slug='graf' and a.slug='gesamtverein' and t.slug='stadionheft';`);
  const before = await sql(`select row_to_json(w) from public.social_sponsor_website_assignments w join public.social_sponsors s on s.id=w.sponsor_id where s.slug='graf'`);
  await sql(await readFile(new URL('supabase/migrations/20261101115827_multiple_sponsor_services.sql', root), 'utf8'));
  const after = JSON.parse(await sql(`select row_to_json(w) from public.social_sponsor_website_assignments w join public.social_sponsors s on s.id=w.sponsor_id where s.slug='graf'`));
  delete after.id;assert.deepEqual(after, JSON.parse(before));
  const ids = JSON.parse(await sql(`select jsonb_build_object('graf',(select id from public.social_sponsors where slug='graf'),'rival',(select id from public.social_sponsors where slug='rival'),'club',(select id from public.social_post_audiences where slug='gesamtverein'),'team',(select id from public.social_post_audiences where slug='herren-1'),'stadium',(select id from public.social_sponsor_types where slug='stadionheft'),'boards',(select id from public.social_sponsor_types where slug='bandensponsor'));`));
  const services = [{ audience_id: ids.club, sponsor_type_id: ids.stadium, page_size: '1/3', description: 'Existing advertisement' }, { audience_id: ids.club, sponsor_type_id: ids.boards, description: 'Bande am Sportplatz' }];
  const social = [{ audience_id: ids.club, context: 'post', slot: 1 }];
  const save = (website, placements = social, version = 2) => sql(`set role service_role;select public.save_social_sponsor_assignments(${quote(ids.graf)},${quote(JSON.stringify(placements))},${quote(JSON.stringify(website))},${version});`);
  await save(services);
  assert.equal(await sql(`select count(*) from public.social_sponsor_website_assignments where sponsor_id=${quote(ids.graf)} and audience_id=${quote(ids.club)}`), '2');
  const snapshot = () => sql(`select jsonb_build_object('website',(select jsonb_agg(w order by w.id) from public.social_sponsor_website_assignments w where sponsor_id=${quote(ids.graf)}),'social',(select jsonb_agg(a) from public.social_sponsor_assignments a where sponsor_id=${quote(ids.graf)}));`);
  const expected = await snapshot();
  await assert.rejects(save([services[0]], social, 1), /neu laden/);
  await assert.rejects(save([services[1], services[1]], [{ ...social[0], slot: 2 }]), /unique constraint/);
  assert.equal(await snapshot(), expected);
  await sql(`set role service_role;insert into public.social_sponsor_assignments(sponsor_id,audience_id,context,slot) values (${quote(ids.rival)},${quote(ids.team)},'post',1);`);
  await assert.rejects(save(services, [{ audience_id: ids.team, context: 'post', slot: 1 }]), /unique constraint/);
  assert.equal(await snapshot(), expected);
  await assert.rejects(save([{ ...services[0], page_size: null }]), /Seitengröße/);
  await assert.rejects(save([{ ...services[1], page_size: '1/3' }]), /Seitengröße/);
  await assert.rejects(save([{ audience_id: ids.club }, services[1]]), /Sponsorart/);
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(sql(`set role ${role};select public.save_social_sponsor_assignments(${quote(ids.graf)},'[]','[]',2)`), /permission denied/);
  }
  assert.equal(await snapshot(), expected);
  await save([{ audience_id: ids.club, description: 'Untyped legacy assignment' }]);
  await assert.rejects(sql(`set role service_role;insert into public.social_sponsor_website_assignments(sponsor_id,audience_id) values (${quote(ids.graf)},${quote(ids.club)})`), /unique constraint/);
  assert.equal(await sql(`select count(*) from public.social_sponsor_website_assignments where sponsor_id=${quote(ids.graf)}`), '1');
  console.log('PASS: migration preserves legacy data; two services share one audience; atomic rollback on duplicate services and occupied slots; stale UI guard; magazine format; untyped uniqueness; service-only access.');
} finally {
  await exec('docker', ['rm', '-f', name]).catch(() => {});
}
