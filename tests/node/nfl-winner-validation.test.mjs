import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  buildFeatureRows, fitCandidates, predictCandidate, evaluateRows, kickoffIso, runOffline
} from '../../scripts/evaluation/nfl-winner-validation.mjs';

function fixture() {
  const schedule = [], stats = [];
  const matchups = [[['A','B'],['C','D']], [['A','C'],['B','D']],
    [['A','D'],['B','C']], [['A','B'],['C','D']]];
  for (const season of [2023, 2024]) for (let week = 1; week <= 4; week++) {
    for (const [i, [home, away]] of matchups[week - 1].entries()) {
      const game_id = `${season}_${week}_${away}_${home}`;
      schedule.push({game_id, season: String(season), week: String(week), game_type:'REG',
        gameday: `${season}-09-${String(3 + (week - 1) * 7).padStart(2,'0')}`,
        gametime:'13:00', home_team:home, away_team:away,
        home_score: String(week % 2 ? 24 : 17), away_score: String(i ? 14 : 21),
        location:'Home', home_moneyline:'-120', away_moneyline:'110',
        home_qb_name:'Historical starter', away_qb_name:'Historical starter'});
      for (const [team, opponent_team] of [[home,away],[away,home]]) {
        stats.push({game_id,season:String(season),week:String(week),season_type:'REG',team,opponent_team,
          attempts:'20',sacks_suffered:'0',carries:'20',
          passing_epa:String({A:8,B:-4,C:2,D:-2}[team]),rushing_epa:'0'});
      }
    }
  }
  return {schedule, stats};
}

test('future/target outcomes and target market, rest or starter fields cannot change pregame features', () => {
  const input=fixture(), before=buildFeatureRows(input.schedule,input.stats);
  const target=before.rows.find(r=>r.gameId==='2024_4_B_A');
  assert.ok(target);
  const changed=structuredClone(input);
  for (const g of changed.schedule) {
    g.home_moneyline='-900'; g.away_moneyline='700'; g.home_rest='999'; g.away_rest='1';
    g.home_qb_name='Future QB'; g.away_qb_name='Future QB'; g.spread_line='99';
    if(g.gameday>='2024-09-24'){g.home_score='100';g.away_score='0';}
  }
  for (const r of changed.stats) if(r.season==='2024'&&Number(r.week)>=4) r.passing_epa='99999';
  const after=buildFeatureRows(changed.schedule,changed.stats).rows.find(r=>r.gameId===target.gameId);
  assert.deepEqual(after.features,target.features);
  assert.ok(target.featureEvidence.scheduleGameIds.every(id=>id!==target.gameId));
  assert.ok(target.featureEvidence.statGameIds.every(id=>id!==target.gameId));
});

test('EPA defense joins opponent performance and includes only strictly earlier current-season games', () => {
  const {schedule,stats}=fixture();
  // All previous opponents allow the same fixed EPA, making the differential hand-checkable.
  for(const row of stats) {row.passing_epa='4'; row.rushing_epa='0';}
  const a=buildFeatureRows(schedule,stats).rows.find(r=>r.gameId==='2024_4_B_A');
  assert.ok(a);
  assert.equal(a.features.epaMatchupDifference,0);
  for(const row of stats) if(row.season==='2024'&&Number(row.week)<4&&row.team==='A') row.passing_epa='8';
  const b=buildFeatureRows(schedule,stats).rows.find(r=>r.gameId==='2024_4_B_A');
  assert.ok(b.features.epaMatchupDifference>0.1);
  assert.ok(b.featureEvidence.statGameIds.every(id=>id.startsWith('2024_')&&!id.startsWith('2024_4_')));
  const priorSeasonChanged=structuredClone(stats);
  for(const row of priorSeasonChanged) if(row.season==='2023') row.passing_epa='99999';
  assert.equal(buildFeatureRows(schedule,priorSeasonChanged).rows.find(r=>r.gameId===b.gameId).features.epaMatchupDifference,b.features.epaMatchupDifference);
});

test('rest is recomputed from prior game dates and respects the shared feature cohort', () => {
  const {schedule,stats}=fixture();
  schedule.find(g=>g.game_id==='2024_3_C_B').gameday='2024-09-18';
  const row=buildFeatureRows(schedule,stats).rows.find(r=>r.gameId==='2024_4_B_A');
  assert.ok(row);
  assert.equal(row.features.restDifference,1); // Home last played Sep17 (7d); away Sep18 (6d).
  const missing=stats.filter(r=>!(r.season==='2024'&&r.week==='1'&&r.team==='A'));
  const result=buildFeatureRows(schedule,missing);
  assert.equal(result.rows.some(r=>r.gameId==='2024_4_B_A'),false);
  assert.ok(result.exclusions.some(r=>r.gameId==='2024_4_B_A'&&r.reason==='insufficient_prior_epa'));
});

test('an earlier-starting game in the target week cannot leak into result or strength features', () => {
  const {schedule,stats}=fixture();
  const expected=buildFeatureRows(schedule,stats).rows.find(r=>r.gameId==='2024_4_B_A');
  const extra={...schedule.find(r=>r.game_id==='2024_4_B_A'),game_id:'same-week-earlier',
    gameday:'2024-09-22',home_score:'999',away_score:'0'};
  const replay=buildFeatureRows([...schedule,extra],stats).rows.find(r=>r.gameId===expected.gameId);
  assert.deepEqual(replay.features,expected.features);
});

test('opponent ratings stay frozen before each historical matchup instead of using later results', () => {
  const {schedule,stats}=fixture();
  const expected=buildFeatureRows(schedule,stats).rows.find(r=>r.gameId==='2024_4_B_A');
  const extra={...schedule.find(r=>r.game_id==='2024_3_D_A'),game_id:'opponent-same-week-earlier',
    home_team:'D',away_team:'C',gameday:'2024-09-16',home_score:'999',away_score:'0'};
  const replay=buildFeatureRows([...schedule,extra],stats).rows.find(r=>r.gameId===expected.gameId);
  assert.deepEqual(replay.features,expected.features);
});

test('identical duplicate games/stat rows do not inflate samples and conflicting identities fail closed', () => {
  const {schedule,stats}=fixture(), original=buildFeatureRows(schedule,stats);
  const replay=buildFeatureRows([...schedule,...schedule],[...stats,...stats]);
  assert.deepEqual(replay.rows,original.rows);
  assert.equal(replay.inventory.duplicateScheduleRows,schedule.length);
  assert.throws(()=>buildFeatureRows([...schedule,{...schedule[0],home_score:'999'}],stats),/Conflicting schedule/);
  assert.throws(()=>buildFeatureRows(schedule,[...stats,{...stats[0],passing_epa:'999'}]),/Conflicting team statistics/);
});

test('evaluation labels cannot affect training parameters or standardization', () => {
  const {schedule,stats}=fixture(), {rows}=buildFeatureRows(schedule,stats);
  const first=fitCandidates(rows);
  assert.equal(Object.keys(first).length,4);
  const changed=rows.map(r=>r.season===2024?{...r,outcome:1-r.outcome,features:Object.fromEntries(Object.entries(r.features).map(([k,v])=>[k,v+100]))}:r);
  assert.deepEqual(fitCandidates(changed),first);
  for(const model of Object.values(first)) {
    const p=predictCandidate(model,rows[0].features);
    assert.ok(Number.isFinite(p)&&p>0&&p<1);
  }
});

test('ties are counted separately and all four candidates use the same decisive evaluation games', async () => {
  const {schedule,stats}=fixture();
  const g=schedule.find(r=>r.game_id==='2024_4_B_A'); g.away_score=g.home_score;
  const built=buildFeatureRows(schedule,stats);
  const result=await evaluateRows(built.rows,{bootstrapIterations:100});
  assert.equal(result.evaluation.games,2);
  assert.equal(result.evaluation.ties,1);
  assert.equal(result.evaluation.decisiveGames,1);
  assert.deepEqual(result.evaluation.tieGameIds,['2024_4_B_A']);
  for(const item of Object.values(result.evaluation.candidates)) assert.equal(item.metrics.n,1);
  assert.equal(result.evaluation.predictions.length,1);
  assert.equal(result.lineupAblation.status,'unavailable');
});

test('NFL kickoff conversion preserves Eastern source dates across DST and late night games', () => {
  assert.equal(kickoffIso({gameday:'2024-09-26',gametime:'20:15'}),'2024-09-27T00:15:00.000Z');
  assert.equal(kickoffIso({gameday:'2024-11-07',gametime:'20:15'}),'2024-11-08T01:15:00.000Z');
  assert.equal(kickoffIso({gameday:'2024-03-10',gametime:'02:30'}),null);
  assert.equal(kickoffIso({gameday:'2024-09-26',gametime:''}),null);
});

function fixtureCache(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-winner-validation-test-'));
  t.after(()=>{
    const resolved=path.resolve(directory),prefix=path.join(path.resolve(os.tmpdir()),'nfl-winner-validation-test-');
    assert.ok(resolved.startsWith(prefix));
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  const {schedule,stats}=fixture(),cacheDir=path.join(directory,'cache');fs.mkdirSync(cacheDir);
  const hash=b=>createHash('sha256').update(b).digest('hex');
  const csv=rows=>{
    const columns=[...new Set(rows.flatMap(r=>Object.keys(r)))];
    return [columns.join(','),...rows.map(r=>columns.map(k=>String(r[k]??'')).join(','))].join('\n')+'\n';
  };
  const sources={'games.csv':schedule,'stats_team_week_2023.csv':stats.filter(r=>r.season==='2023'),
    'stats_team_week_2024.csv':stats.filter(r=>r.season==='2024'),
    'depth_charts_2024.csv':[{season:'2024',club_code:'A',week:'4',position:'QB',depth_team:'1',full_name:'No timestamp'}]};
  const manifest={},expectedSourceHashes={};
  for(const [name,rows] of Object.entries(sources)){
    const url=`https://example.test/${name}`,bytes=Buffer.from(csv(rows)),id=hash(url);
    fs.writeFileSync(path.join(cacheDir,`${id}.bin`),bytes);
    manifest[id]={url,sha256:hash(bytes),bytes:bytes.length,receivedAt:'2026-11-16T15:00:00Z'};
    expectedSourceHashes[name]=hash(bytes);
  }
  fs.writeFileSync(path.join(cacheDir,'manifest.json'),JSON.stringify(manifest));
  return {directory,cacheDir,expectedSourceHashes,manifest,hash};
}

test('offline source hashes are verified and generated artifacts cannot be overwritten', async t => {
  const {directory,cacheDir,expectedSourceHashes,hash}=fixtureCache(t);
  const outputDir=path.join(directory,'output'),report=await runOffline({cacheDir,outputDir,expectedSourceHashes});
  const reportBytes=fs.readFileSync(path.join(outputDir,'report.json'));
  assert.equal(report.provenance.coefficientsSha256,hash(fs.readFileSync(path.join(outputDir,'models.json'))));
  assert.equal(report.provenance.featureRowsSha256,hash(fs.readFileSync(path.join(outputDir,'features.json'))));
  assert.equal(report.depthArchive.datedRows,0);
  assert.equal(report.depthArchive.usedForFeatures,false);
  await assert.rejects(runOffline({cacheDir,outputDir,expectedSourceHashes}),/Refusing to overwrite/);
  assert.deepEqual(fs.readFileSync(path.join(outputDir,'report.json')),reportBytes);
  const replayDir=path.join(directory,'replay');await runOffline({cacheDir,outputDir:replayDir,expectedSourceHashes});
  for(const name of ['features.json','models.json','predictions.json'])
    assert.deepEqual(fs.readFileSync(path.join(outputDir,name)),fs.readFileSync(path.join(replayDir,name)));
  fs.appendFileSync(path.join(cacheDir,`${hash('https://example.test/games.csv')}.bin`),'tampered');
  const badOutput=path.join(directory,'invalid');
  await assert.rejects(runOffline({cacheDir,outputDir:badOutput,expectedSourceHashes}),/Source integrity mismatch/);
  assert.equal(fs.existsSync(badOutput),false);
});

test('a rewritten manifest cannot silently replace the pinned protocol inputs', async t => {
  const {directory,cacheDir,expectedSourceHashes,manifest,hash}=fixtureCache(t);
  const id=hash('https://example.test/games.csv'),file=path.join(cacheDir,`${id}.bin`);
  const bytes=Buffer.concat([fs.readFileSync(file),Buffer.from('\n')]);
  fs.writeFileSync(file,bytes);manifest[id].sha256=hash(bytes);manifest[id].bytes=bytes.length;
  fs.writeFileSync(path.join(cacheDir,'manifest.json'),JSON.stringify(manifest));
  await assert.rejects(runOffline({cacheDir,outputDir:path.join(directory,'changed-source'),expectedSourceHashes}),/Protocol source hash mismatch/);
});

test('CLI accepts only the fixed real source pins, never fixture or user-supplied expectations', t => {
  const {directory,cacheDir,expectedSourceHashes}=fixtureCache(t);
  const script=fileURLToPath(new URL('../../scripts/evaluation/nfl-winner-validation.mjs',import.meta.url));
  const outputDir=path.join(directory,'cli-output');
  const result=spawnSync(process.execPath,[script,`--cache-dir=${cacheDir}`,`--output-dir=${outputDir}`,
    `--expected-source-hashes=${JSON.stringify(expectedSourceHashes)}`],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Protocol source hash mismatch/);
  assert.equal(fs.existsSync(outputDir),false);
});

test('concurrent runs acquire one immutable output directory before fitting or writing', async t => {
  const {directory,cacheDir,expectedSourceHashes}=fixtureCache(t);
  const outputDir=path.join(directory,'new-parent','concurrent-output');
  const results=await Promise.allSettled([
    runOffline({cacheDir,outputDir,expectedSourceHashes}),
    runOffline({cacheDir,outputDir,expectedSourceHashes})
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const rejected=results.find(r=>r.status==='rejected');
  assert.match(String(rejected.reason),/Refusing to overwrite/);
  const report=JSON.parse(fs.readFileSync(path.join(outputDir,'report.json'),'utf8'));
  assert.equal(report.training.games,2);
});

test('an artifact appearing after directory reservation is never overwritten', async t => {
  const {directory,cacheDir,expectedSourceHashes}=fixtureCache(t);
  const outputDir=path.join(directory,'raced-artifact');
  const pending=runOffline({cacheDir,outputDir,expectedSourceHashes});
  const file=path.join(outputDir,'features.json');
  fs.writeFileSync(file,'existing evidence',{flag:'wx'});
  await assert.rejects(pending,error=>error.code==='EEXIST');
  assert.equal(fs.readFileSync(file,'utf8'),'existing evidence');
});
