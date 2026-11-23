import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrations = new URL('../../supabase/migrations/', import.meta.url);
const migration = readFileSync(new URL('20261123185724_authorize_active_scheduled_writers.sql', migrations), 'utf8');
const origin = 'https://yeoxroijaptomomshdii.supabase.co';
const identities = [
  'trigger_closing_snapshot()', 'trigger_league_snapshot(text,text,integer)',
  'trigger_market_snapshot(text)', 'trigger_model_grading()',
  'trigger_pitchmix_feature_capture()', 'trigger_sharp_disagreement_shadow()',
];
const calls = [
  "select public.trigger_closing_snapshot()", "select public.trigger_league_snapshot('NFL','closing',6)",
  "select public.trigger_market_snapshot('midday')", 'select public.trigger_model_grading()',
  'select public.trigger_pitchmix_feature_capture()', 'select public.trigger_sharp_disagreement_shadow()',
];
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(patch = {}, header = { alg: 'HS256', typ: 'JWT' }) {
  const payload = { role: 'service_role', ref: 'yeoxroijaptomomshdii', iss: 'supabase', exp: 4102444800, ...patch };
  const content = `${encode(header)}.${encode(payload)}`;
  return `${content}.${createHmac('sha256','only-a-local-test-fixture').update(content).digest('base64url')}`;
}
const serviceJwt = jwt();
const publicKey = ['sb','publishable','only-a-local-fixture'].join('_');
const fixture = `
create role anon; create role authenticated; create role service_role;
create schema vault; create schema net; create schema extensions; create schema cron;
create table vault.decrypted_secrets(name text, decrypted_secret text);
create table net.requests(id bigint generated always as identity, url text, headers jsonb, body jsonb, timeout_milliseconds integer);
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint language plpgsql as $$
declare result bigint;
begin insert into net.requests(url,headers,body,timeout_milliseconds) values(url,headers,body,timeout_milliseconds) returning id into result; return result; end; $$;
create table cron.job(jobid bigint, jobname text, schedule text, active boolean);
insert into cron.job values(38,'mlb-pitchmix-features-10min','*/10 * * * *',true),(4,'disabled-fixture','20 * * * *',false);
create table public.pipeline_component_registry(component_key text, enabled boolean);
insert into public.pipeline_component_registry values('nba_player_prop_capture',false),('nfl_player_prop_capture',false);
`;

function baselineDefinition(identity) {
  const name = identity.split('(')[0];
  const file = name === 'trigger_pitchmix_feature_capture'
    ? '20260924092126_schedule_pitchmix_feature_capture.sql'
    : '20260923213739_recover_posthistory_security_and_cron.sql';
  const source = readFileSync(new URL(file, migrations),'utf8');
  const match = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$[\\s\\S]*?\\$function\\$;`, 'i'));
  assert.ok(match, `${name}: exact historical definition is available`);
  return match[0];
}

async function database() {
  const db = new PGlite();
  await db.exec(fixture);
  for (const identity of identities) {
    await db.exec(baselineDefinition(identity));
    await db.exec(`revoke execute on function public.${identity} from public,anon,authenticated; grant execute on function public.${identity} to service_role;`);
  }
  await db.query('insert into vault.decrypted_secrets values ($1,$2),($3,$4),($5,$6)', [
    'snapshot_project_url',origin,'snapshot_publishable_key',publicKey,'performance_service_role_key',serviceJwt,
  ]);
  return db;
}
async function snapshot(db) {
  return {
    wrappers: (await db.query(`select proname,pg_get_functiondef(oid) as definition,proacl::text as acl,pg_get_userbyid(proowner) as owner,prosecdef,proconfig from pg_proc where proname = any($1::text[]) order by proname`, [identities.map(id=>id.split('(')[0])])).rows,
    cron: (await db.query('select * from cron.job order by jobid')).rows,
    registry: (await db.query('select * from public.pipeline_component_registry order by component_key')).rows,
  };
}
async function failedMigrationLeavesState(db, pattern = /scheduler|credential|origin|wrapper|preflight/i) {
  const before = await snapshot(db);
  await assert.rejects(db.exec(migration), pattern);
  assert.deepEqual(await snapshot(db), before, 'all original wrapper definitions, ACLs and scheduling state survive refusal');
  assert.equal((await db.query("select to_regprocedure('public.edge_lab_scheduler_origin_v1()') is null as absent")).rows[0].absent,true);
  assert.equal((await db.query('select count(*)::int as n from net.requests')).rows[0].n,0);
}

test('six current wrappers use the existing service JWT without changing bodies, ACLs or schedules',async()=>{
  const db=await database();
  try {
    const before=await snapshot(db);
    await db.exec(migration);
    assert.equal((await db.query('select count(*)::int as n from net.requests')).rows[0].n,0,'migration never sends requests');
    const after=await snapshot(db);
    assert.deepEqual(after.cron,before.cron);assert.deepEqual(after.registry,before.registry);
    for(let i=0;i<before.wrappers.length;i++) {
      const {definition:oldDefinition,...oldMeta}=before.wrappers[i],{definition:newDefinition,...newMeta}=after.wrappers[i];
      assert.deepEqual(newMeta,oldMeta,'all owner/ACL/SECURITY DEFINER/search_path attributes survive');
      assert.equal(newDefinition.replaceAll('performance_service_role_key','snapshot_publishable_key').replace('url := public.edge_lab_scheduler_origin_v1()',oldDefinition.match(/url := \([\s\S]*?limit 1\s*\)/)[0]),oldDefinition);
    }
    for(const call of calls)await db.exec(call);
    const rows=(await db.query('select * from net.requests order by id')).rows;
    assert.equal(rows.length,6);
    for(const row of rows){assert.ok(row.url.startsWith(origin+'/functions/v1/'));assert.equal(row.headers.apikey,serviceJwt);assert.equal(row.headers.Authorization,'Bearer '+serviceJwt);}
    assert.deepEqual(rows[4].body,{limit:4});assert.equal(rows[4].timeout_milliseconds,60000);
    assert.deepEqual(rows[5].body,{hours:48});assert.deepEqual(rows[3].body,{});
    assert.equal(rows[1].body.label,'closing');assert.deepEqual(rows[1].body.leagues,['NFL']);
    assert.equal(rows[2].body.label,'midday');assert.deepEqual(rows[2].body.leagues,['MLB']);
    assert.deepEqual((await db.query("select has_function_privilege('anon','public.edge_lab_scheduler_origin_v1()','EXECUTE') as anon,has_function_privilege('authenticated','public.edge_lab_scheduler_origin_v1()','EXECUTE') as authenticated,has_function_privilege('service_role','public.edge_lab_scheduler_origin_v1()','EXECUTE') as service")).rows[0],{anon:false,authenticated:false,service:true});
  } finally {await db.close();}
});

test('preflight rejects missing, duplicate, untrusted and non-origin URL values atomically',async()=>{
  const values=[undefined,null,'http://yeoxroijaptomomshdii.supabase.co','https://example.test',origin+'.example.test',origin+':443',origin+'/path',origin+'?x=1',origin+'#fragment','https://user@yeoxroijaptomomshdii.supabase.co',' '+origin,origin+'//'];
  for(const value of values){const db=await database();try{
    await db.exec("delete from vault.decrypted_secrets where name='snapshot_project_url'");
    if(value!==undefined)await db.query('insert into vault.decrypted_secrets values ($1,$2)',['snapshot_project_url',value]);
    await failedMigrationLeavesState(db);
  }finally{await db.close();}}
  const db=await database();try{await db.query('insert into vault.decrypted_secrets values ($1,$2)',['snapshot_project_url',origin]);await failedMigrationLeavesState(db);}finally{await db.close();}
});

test('credential preflight rejects absent, duplicate, malformed, wrong-role/project/issuer and expired JWTs',async()=>{
  const values=[undefined,null,publicKey,'not-a-jwt',jwt({role:'anon'}),jwt({role:'authenticated'}),jwt({role:null}),jwt({role:undefined}),jwt({ref:'other-project'}),jwt({ref:undefined}),jwt({iss:'other'}),jwt({iss:undefined}),jwt({exp:1}),jwt({exp:undefined}),jwt({exp:null}),jwt({exp:'4102444800'}),jwt({}, {alg:'none'}),jwt({}, {alg:undefined})];
  for(const value of values){const db=await database();try{
    await db.exec("delete from vault.decrypted_secrets where name='performance_service_role_key'");
    if(value!==undefined)await db.query('insert into vault.decrypted_secrets values ($1,$2)',['performance_service_role_key',value]);
    await failedMigrationLeavesState(db);
  }finally{await db.close();}}
  const db=await database();try{await db.query('insert into vault.decrypted_secrets values ($1,$2)',['performance_service_role_key',serviceJwt]);await failedMigrationLeavesState(db);}finally{await db.close();}
});

test('all six baseline hashes and ACLs are checked before any replacement',async()=>{
  for(const change of [
    "alter function public.trigger_model_grading() set work_mem='8MB'",
    'grant execute on function public.trigger_pitchmix_feature_capture() to anon',
    'alter function public.trigger_market_snapshot(text) owner to service_role',
  ]){const db=await database();try{await db.exec(change);await failedMigrationLeavesState(db);}finally{await db.close();}}
});

test('runtime origin guard rejects URL tampering, absence and duplicates before any mocked HTTP work',async()=>{
  const db=await database();try{
    await db.exec(migration);
    for(const value of ['https://example.test',origin+'/other',origin+'?token=1','https://user@yeoxroijaptomomshdii.supabase.co',origin+':443',origin+'#x']){
      await db.query("update vault.decrypted_secrets set decrypted_secret=$1 where name='snapshot_project_url'",[value]);
      for(const call of calls)await assert.rejects(db.exec(call),/origin/i);
    }
    await db.exec("delete from vault.decrypted_secrets where name='snapshot_project_url'");
    for(const call of calls)await assert.rejects(db.exec(call),/origin/i);
    await db.query('insert into vault.decrypted_secrets values ($1,$2),($1,$2)',['snapshot_project_url',origin]);
    for(const call of calls)await assert.rejects(db.exec(call),/origin/i);
    assert.equal((await db.query('select count(*)::int as n from net.requests')).rows[0].n,0);
    await db.exec("delete from vault.decrypted_secrets where name='snapshot_project_url'");
    await db.query('insert into vault.decrypted_secrets values ($1,$2)',['snapshot_project_url',origin+'/']);
    await db.exec(calls[4]);
    assert.equal((await db.query('select url from net.requests')).rows[0].url,origin+'/functions/v1/capture-pitchmix-features');
  }finally{await db.close();}
});

test('a late failure rolls back helper creation, all prior replacements and scheduling state',async()=>{
  const db=await database();try{
    const before=await snapshot(db);
    const broken=migration.replace('-- POSTFLIGHT: all six replacements must preserve privileges.',"perform 1 / 0;\n  -- POSTFLIGHT: all six replacements must preserve privileges.");
    assert.notEqual(broken,migration,'late failure is injected at the real postflight boundary');
    await assert.rejects(db.exec(broken),/division by zero/);
    assert.deepEqual(await snapshot(db),before);
    assert.equal((await db.query("select to_regprocedure('public.edge_lab_scheduler_origin_v1()') is null as absent")).rows[0].absent,true);
  }finally{await db.close();}
});
