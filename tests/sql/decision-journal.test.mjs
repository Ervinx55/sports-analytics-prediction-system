import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrations = new URL('../../supabase/migrations/', import.meta.url);
const fixture = `
create role anon; create role authenticated; create role service_role bypassrls;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
create table public.market_grade_observations (id bigint primary key,captured_at timestamptz,sport text,event_id text,starts_at timestamptz,market_type text,market_side text,line numeric,best_odds int,best_book text,non_sharp_status text,model_probability numeric,model_version text,market_label text,away_team text,home_team text,reason text,ev_pct numeric,edge_pct_points numeric,raw jsonb);
create table public.performance_decisions (id uuid primary key,issued_at timestamptz,payload jsonb,status text,market_key text,source_key text,qualified boolean,evidence jsonb);
create table public.nba_live_decisions_v1 (decision_id text primary key,decided_at timestamptz,starts_at timestamptz,identity text,model_hash text,approval_id uuid,payload jsonb);
create table public.decision_outcome_attribution (leg_type text,observation_id bigint,event_id text,outcome text,process_grade text,primary_attribution text,evaluated_at timestamptz);
create table public.nba_prop_outcomes_v1 (identity text primary key,payload jsonb);
`;
async function database() {
  const db = new PGlite();
  await db.exec(fixture);
  for (const name of readdirSync(migrations).filter(n => n.startsWith('20261122') || n.endsWith('_repair_decision_journal_integrity.sql')).sort()) {
    await db.exec(readFileSync(new URL(name, migrations), 'utf8'));
  }
  return db;
}
const decision = overrides => ({
  source: 'test_original_record', sourceReference: 'recommendation-1', sport: 'NBA',
  eventId: 'nba:001', startsAt: '2020-01-02T01:00:00Z', playerId: 'nba:player-1',
  marketType: 'points', marketScope: 'FULL_GAME', side: 'OVER', line: 25.5,
  issuedAt: '2020-01-01T20:00:00Z', decision: 'SELECT_RESEARCH', provenance: 'conversation',
  recordKind: 'recommendation', evidence: { sourceDocument: 'original.md', sourceSha256: 'a'.repeat(64) },
  ...overrides
});
const result = overrides => {
 const input = {
  sport: 'NBA', eventId: 'nba:001', startsAt: '2020-01-02T01:00:00Z', playerId: 'nba:player-1',
  marketType: 'points', marketScope: 'FULL_GAME', actualValue: 16, participation: 'PLAYED', status: 'FINAL',
  officialEventId: '001', officialPlayerId: 'player-1', sourceUrl: 'https://www.nba.com/game/001/box-score',
  sourceSha256: 'b'.repeat(64), sourceCaptureFormat:'ORIGIN_RESPONSE_BYTES', retrievedAt: '2020-01-02T05:00:00Z',
  verifiedBy: 'test-reviewer',
  ...overrides
 };
 return {...input,identityEvidence:input.identityEvidence??{
   reference:'Official event and player IDs reviewed against original record.',
   eventId:input.eventId,startsAt:input.startsAt,playerId:input.playerId,
   officialEventId:input.officialEventId,officialPlayerId:input.officialPlayerId,sourceSha256:input.sourceSha256,
   marketType:input.marketType,marketScope:input.marketScope,sourceCaptureFormat:input.sourceCaptureFormat
 }};
};
async function rpc(db, name, args) {
  const keys = Object.keys(args);
  const rows = (await db.query(`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) as value`, Object.values(args))).rows;
  return rows[0].value;
}
async function record(db, value) { return rpc(db, 'record_edge_decision_v1', { p_decision: value }); }
async function official(db, value) { return rpc(db, 'record_edge_official_result_v1', { p_result: value }); }
async function grade(db, id, limit = 1000) { return rpc(db, 'grade_edge_journal_result_v1', { p_result_id: id, p_limit: limit }); }

test('journal triggers are unavailable to public roles and cannot execute with a mutable search path', async () => {
  const db = await database();
  try {
    const rows = (await db.query(`select proname,prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon_execute,has_function_privilege('authenticated',oid,'execute') as auth_execute from pg_proc where proname in ('edge_decision_journal_immutable','edge_journal_from_market_grade','edge_journal_from_performance_decision','edge_journal_from_nba_live')`)).rows;
    assert.equal(rows.length,4);
    for (const row of rows) {
      assert.equal(row.anon_execute,false,`${row.proname} must reject anon`);
      assert.equal(row.auth_execute,false,`${row.proname} must reject authenticated`);
      assert.equal(row.prosecdef,false,`${row.proname} must run with its caller's permissions`);
      assert.ok(row.proconfig?.some(value=>value.startsWith('search_path=')));
    }
    for(const table of ['edge_decision_journal_v1','edge_official_result_revisions_v1','edge_journal_grades_v1']) {
      const access=(await db.query("select has_table_privilege('service_role',$1,'truncate') as truncate,has_table_privilege('service_role',$1,'update') as update",['public.'+table])).rows[0];
      assert.equal(access.truncate,false,`${table} must deny truncation`);
      assert.equal(access.update,false,`${table} must deny updates`);
    }
  } finally { await db.close(); }
});

test('original research decisions record once, preserve unknown issue time, and reject conflicting retries', async () => {
  const db = await database();
  try {
    const input = decision({ issuedAt: null });
    let created;
    await assert.doesNotReject(async()=>{ created = await record(db,input); });
    assert.equal((await record(db,input)).journalId,created.journalId);
    await assert.rejects(record(db,{...input,line:26.5}),/IDEMPOTENCY_CONFLICT/);
    const rows = (await db.query('select issued_at,recorded_at,decision,is_documented_wager from public.edge_decision_journal_v1')).rows;
    assert.equal(rows.length,1); assert.equal(rows[0].issued_at,null);
    assert.equal(rows[0].decision,'SELECT_RESEARCH'); assert.equal(rows[0].is_documented_wager,false);
    assert.ok(rows[0].recorded_at);
    await assert.rejects(db.exec('update public.edge_decision_journal_v1 set line=26'),/append-only/);
  } finally { await db.close(); }
});

test('official grading matches exact identities and market scope, preserves pushes, and retries once', async () => {
  const db = await database();
  try {
    await db.exec('set role service_role');
    for (const [sourceReference,fields] of [
      ['loss',{}], ['push',{line:16}], ['win',{line:15.5}],
      ['wrong-player',{playerId:'nba:other'}], ['wrong-event',{eventId:'nba:other'}],
      ['wrong-period',{marketScope:'FIRST_HALF'}], ['wrong-start',{startsAt:'2020-01-03T01:00:00Z'}]
    ]) await record(db,decision({sourceReference,...fields}));
    const verified = await official(db,result());
    assert.equal((await official(db,result())).resultId,verified.resultId);
    const batch = await grade(db,verified.resultId,2);
    assert.equal(batch.inserted,2); assert.equal(batch.remaining,1);
    assert.equal((await grade(db,verified.resultId,2)).inserted,1);
    assert.equal((await grade(db,verified.resultId)).inserted,0);
    const rows = (await db.query('select j.source_reference,g.outcome,g.actual_value from public.edge_journal_grades_v1 g join public.edge_decision_journal_v1 j on j.id=g.journal_id order by j.source_reference')).rows;
    assert.deepEqual(rows.map(r=>[r.source_reference,r.outcome,Number(r.actual_value)]),[['loss','L',16],['push','PUSH',16],['win','W',16]]);
  } finally { await db.close(); }
});

test('result revisions append corrections and require the exact previous official result', async () => {
  const db = await database();
  try {
    await record(db,decision({line:17.5}));
    const first = await official(db,result()); await grade(db,first.resultId);
    await assert.rejects(official(db,result({actualValue:18,sourceSha256:'c'.repeat(64)})),/PREVIOUS_RESULT_REQUIRED/);
    const second = await official(db,result({actualValue:18,sourceSha256:'c'.repeat(64),supersedesResultId:first.resultId}));
    await grade(db,second.resultId);
    assert.deepEqual((await db.query('select outcome from public.edge_journal_grades_v1 order by result_id')).rows.map(r=>r.outcome),['L','W']);
    await assert.rejects(official(db,result({actualValue:19,sourceSha256:'d'.repeat(64),supersedesResultId:first.resultId})),/STALE_RESULT_REVISION/);
    const restored = await official(db,result({supersedesResultId:second.resultId}));
    assert.equal(restored.revision,3);
    assert.notEqual(restored.resultId,first.resultId);
    assert.equal((await official(db,result({supersedesResultId:second.resultId}))).resultId,restored.resultId);
    await assert.rejects(db.exec('delete from public.edge_official_result_revisions_v1'),/append-only/);
  } finally { await db.close(); }
});

test('decision supersession cannot silently target a rescheduled event', async () => {
  const db = await database();
  try {
    const first = await record(db,decision());
    await assert.rejects(record(db,decision({sourceReference:'changed-start',previousDecisionId:first.journalId,
      startsAt:'2020-01-03T01:00:00Z'})),/PREVIOUS_DECISION_IDENTITY_MISMATCH/);
  } finally { await db.close(); }
});

test('a later imported earlier issue time cannot replace the first recorded evaluation', async () => {
  const db = await database();
  try {
    await record(db,decision({sourceReference:'first',decision:'PASS'}));
    await record(db,decision({sourceReference:'backfilled',issuedAt:'2020-01-01T18:00:00Z'}));
    const report = await rpc(db,'edge_journal_scorecard_v2',{p_from:'2020-01-01T00:00:00Z',p_to:'2020-01-03T00:00:00Z'});
    assert.equal(report.byDecision[0].decision,'PASS');
  } finally { await db.close(); }
});

test('unreviewed, incomplete, nonfinal, and misattributed official-result evidence fails closed', async () => {
  const db = await database();
  try {
    for (const bad of [
      {sourceUrl:'https://nba.com.example.org/fake'}, {sourceUrl:'https://www.nfl.com/final'},
      {sourceSha256:null}, {verifiedBy:''}, {identityEvidence:{}}, {officialEventId:''},
      {playerId:null}, {participation:'UNKNOWN'}, {retrievedAt:'2020-01-01T00:00:00Z'},
      {actualValue:null}, {actualValue:'NaN'}, {marketScope:'FUTURE_UNKNOWN_SCOPE'}, {status:'IN_PROGRESS'},
      {identityEvidence:{...result().identityEvidence,eventId:'wrong'}},
      {identityEvidence:{...result().identityEvidence,playerId:'wrong'}},
      {identityEvidence:{...result().identityEvidence,officialPlayerId:'wrong'}},
      {identityEvidence:{...result().identityEvidence,sourceSha256:'f'.repeat(64)}},
      {actualValue:-1}, {actualValue:2.5},
      {startsAt:new Date(Date.now()+60000).toISOString(),retrievedAt:new Date(Date.now()+120000).toISOString()}
    ]) await assert.rejects(official(db,result(bad)));
    assert.equal((await db.query('select count(*)::int as n from public.edge_official_result_revisions_v1')).rows[0].n,0);
  } finally { await db.close(); }
});

test('scorecards count repeated market observations once and do not infer prospective timing for imports', async () => {
  const db = await database();
  try {
    for(let i=0;i<20;i++) await record(db,decision({sourceReference:`refresh-${i}`}));
    await record(db,decision({sourceReference:'unknown-original',issuedAt:null}));
    const verified = await official(db,result()); await grade(db,verified.resultId);
    const report = await rpc(db,'edge_journal_scorecard_v2',{p_from:'2020-01-01T00:00:00Z',p_to:'2020-01-03T00:00:00Z'});
    assert.equal(report.rawRecords,20); assert.equal(report.uniqueMarketSides,1);
    assert.equal(report.uniqueGames,1); assert.equal(report.gradedMarketSides,1);
    assert.equal(report.losses,1); assert.equal(report.prospectiveMarketSides,0);
    assert.equal(report.wagerSettlementCount,0);
    await assert.rejects(rpc(db,'edge_journal_scorecard_v2',{p_from:'2020-01-01T00:00:00Z',p_to:'2021-01-03T00:00:00Z'}),/MAX_31_DAYS/);
  } finally { await db.close(); }
});

test('journal records inserted after tipoff cannot inherit an earlier transaction timestamp', async () => {
  const db = await database();
  try {
    await db.exec('begin');
    const t=(await db.query("select clock_timestamp()+interval '10 milliseconds' as start")).rows[0].start;
    await new Promise(resolve=>setTimeout(resolve,35));
    await record(db,decision({sourceReference:'late-in-transaction',provenance:'system',startsAt:new Date(t).toISOString(),issuedAt:new Date(Date.parse(t)-1000).toISOString()}));
    const r=(await db.query('select recorded_at>=starts_at as after_start from public.edge_decision_journal_v1')).rows[0];
    assert.equal(r.after_start,true);
    await db.exec('commit');
  } finally { await db.close(); }
});

test('full-game capture contracts remain explicit while generic performance rows without a period stay unresolved', async () => {
  const db = await database();
  try {
    await db.exec(`insert into public.performance_decisions(id,issued_at,payload,status,market_key,evidence)
      values(gen_random_uuid(),'2020-01-01T00:00:00Z','{"sport":"NFL","market_type":"spread"}','PASS','spread','{}');
      insert into public.nba_live_decisions_v1(decision_id,decided_at,starts_at,identity,model_hash,payload)
      values('scope-fixture','2020-01-01T00:00:00Z','2020-01-02T00:00:00Z','obs','model','{"market":"points","status":"PASS"}');`);
    const rows=(await db.query('select source,market_scope from public.edge_decision_journal_v1 order by source')).rows;
    assert.deepEqual(rows,[{source:'nba_live_decisions_v1',market_scope:'FULL_GAME'},{source:'performance_decisions',market_scope:'UNKNOWN'}]);
    const quality=(await db.query("select reconciliation_state from public.edge_journal_quality_v1 where source='performance_decisions'")).rows[0];
    assert.equal(quality.reconciliation_state,'MISSING_MARKET_SCOPE');
  } finally { await db.close(); }
});
