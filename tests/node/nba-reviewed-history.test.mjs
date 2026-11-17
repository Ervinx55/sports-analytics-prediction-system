import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/nba-reviewed-history-v46.json',import.meta.url),'utf8'));
const baseline=process.env.NBA_REVIEWED_HISTORY_BASELINE==='1',patcher=baseline?{patchHostedReviewedHistoryBundle:b=>b}:await import('../../scripts/nba/patch-hosted-reviewed-history.mjs');
const patched=patcher.patchHostedReviewedHistoryBundle(fixture),root=mkdtempSync(join(tmpdir(),'nba-reviewed-history-'));
for(const f of patched.files){const p=join(root,f.name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,f.content);}
const runtime=await import(pathToFileURL(join(root,'scripts/local/bdl-live.mjs')));
const review=baseline?null:await import(pathToFileURL(join(root,'scripts/local/nba-reviewed-history-evidence.mjs')));
test.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'nba-reviewed-history-'));rmSync(root,{recursive:true,force:true});});
const at='2026-11-17T18:00:00.000Z';
function runFor(game,{now=at,source=game.source,packet=game.packet.payload,fetchImpl=async()=>{throw Error('NETWORK_FORBIDDEN');},cooldown=true}={}){const key=game.packet.id,date=key.split(':')[1],state={bdl:{dates:{[date]:{key,retrievedAt:packet.retrievedAt}},nextRequestAt:cooldown?Date.parse(now)+3600000:0,lastAcquisitionError:'BDL_HTTP_401'}};return {state,run:runtime.createBdlBackup({key:'fixture',state,summaries:{[key]:packet},loadSummaries:async()=>({}),clock:()=>now,fetchImpl}),source};}
for(const game of fixture.games)test('reviewed history recovers exact '+game.source.eventID,async()=>{
 const before=structuredClone(game),scenario=runFor(game),summary=await scenario.run(game.source,at);
 assert.equal(summary.id,'sgo:'+game.source.eventID);assert.equal(summary.backupEvidence.retrievedAt,game.packet.payload.retrievedAt);assert.equal(scenario.state.bdl.lastAcquisitionError,'BDL_HTTP_401');assert.deepEqual(game,before);
 assert.equal(runtime.liveBdlContract,'nba-bdl-live-v4:b82b8c2456625960c1b0a62ba35813cf22aaec0ae2d3fb89e6663b9538c29c02');
 if(game.source.eventID==='P85upZIi5P758SI7lZPk'){
  const a=summary.backupEvidence.officialFinalAttestation;assert.equal(a.provider,'NBA official');assert.equal(a.coverage.officialPlayers,26);assert.equal(a.coverage.primaryPlayers,25);assert.equal(a.coverage.backupStatComparisons,442);assert.equal(a.coverage.primaryStatComparisons,425);assert.equal(a.maximumAgeHours,6);assert.equal(summary.backupEvidence.staleCacheFallback.acceptedVia,'FRESH_NBA_OFFICIAL_ATTESTATION');
 }else{assert.ok(summary.backupEvidence.reviewedHistoryRevision);if(game.source.eventID==='OeymLe7wQY2zwKedvCrU'){const q=summary.backupEvidence.reviewedHistoryRevision.quarantinedParticipants[0];assert.equal(q.playerID,'JEREMIAH_FEARS_1_NBA');assert.equal(q.stats.secondsPlayed,1770);assert.equal(q.stats.points,21);assert.equal(summary.players.some(p=>p.id===q.playerID),false);}}
});
test('changed source identity, any positive participant stats, or backup rejects',async()=>{
 for(const game of fixture.games){for(const mutate of [g=>g.source.players[Object.keys(g.source.players)[0]].firstName='Changed',g=>g.source.results.game.home.points++,g=>g.packet.payload.body.data.find(b=>b.id===g.backup.id).home_team_score++]){const changed=structuredClone(game);mutate(changed);const s=runFor(changed);await assert.rejects(s.run(changed.source,at),/NBA_REVIEW_(SOURCE_CHANGED|BACKUP_CHANGED)/);}}
});
test('replay observations include the latest receipt used by each reviewed repair',async()=>{
 const expected={RI94CiYdJuFOefB25PwX:'2026-11-17T17:34:52.533Z',OeymLe7wQY2zwKedvCrU:'2026-11-17T17:37:23.087Z',P85upZIi5P758SI7lZPk:'2026-11-17T17:34:52.019Z'};
 for(const game of fixture.games){const s=runFor(game),summary=await s.run(game.source,'2026-11-17T17:00:00.000Z'),evidence=summary.backupEvidence.reviewedHistoryRevision??summary.backupEvidence.officialFinalAttestation;assert.equal(summary.observedAt,expected[game.source.eventID]);assert.equal(evidence.evidenceObservedAt,expected[game.source.eventID]);}
});
test('identity support receipts cannot be consumed before they were retrieved',async()=>{
 for(const [eventID,now]of [['RI94CiYdJuFOefB25PwX','2026-11-17T17:34:51.000Z'],['OeymLe7wQY2zwKedvCrU','2026-11-17T17:37:22.500Z']]){const game=fixture.games.find(g=>g.source.eventID===eventID),s=runFor(game,{now});await assert.rejects(s.run(game.source,now),/NBA_REVIEW_EVIDENCE_FROM_FUTURE/);}
});
test('recent official evidence rejects expired or future receipts and altered provenance',async()=>{
 const game=fixture.games.find(g=>g.source.eventID==='P85upZIi5P758SI7lZPk');
 assert.throws(()=>review.verifyFreshOfficialFinal(game.source,game.packet.payload,Date.parse('2026-11-17T23:34:52.020Z')),/NBA_REVIEW_OFFICIAL_EXPIRED/);
 const now='2026-11-17T17:34:51.000Z',future=runFor(game,{now});await assert.rejects(future.run(game.source,now),/NBA_REVIEW_EVIDENCE_FROM_FUTURE/);
 const altered=structuredClone(game);altered.packet.payload.retrievedAt='2026-11-17T17:00:00.000Z';const s=runFor(altered);await assert.rejects(s.run(altered.source,at),/BDL_STALE_CACHE_PROVENANCE/);
});
test('unreviewed recent finals retain the existing 48-hour restriction',async()=>{
 const game=structuredClone(fixture.games.find(g=>g.source.eventID==='P85upZIi5P758SI7lZPk'));game.source.eventID='UNREVIEWED';const s=runFor(game);await assert.rejects(s.run(game.source,at),/BDL_COOLDOWN/);
});
test('a real 401 can use fresh NBA proof without disguising failed BDL acquisition',async()=>{
 const game=fixture.games.find(g=>g.source.eventID==='P85upZIi5P758SI7lZPk');let requests=0;const s=runFor(game,{cooldown:false,fetchImpl:async()=>{requests++;return new Response('unauthorized',{status:401});}}),summary=await s.run(game.source,at);
 assert.equal(requests,1);assert.equal(s.state.bdl.lastAcquisitionError,'BDL_HTTP_401');assert.equal(summary.backupEvidence.staleCacheFallback.reason,'BDL_HTTP_401');assert.equal(summary.backupEvidence.retrievedAt,game.packet.payload.retrievedAt);assert.ok(summary.backupEvidence.officialFinalAttestation);
});
test('fresh BDL success remains authoritative and a new conflict never uses the attestation',async()=>{
 const game=fixture.games.find(g=>g.source.eventID==='P85upZIi5P758SI7lZPk');
 const valid=runFor(game,{cooldown:false,fetchImpl:async()=>Response.json({data:[game.backup]})}),summary=await valid.run(game.source,at);
 assert.equal(summary.backupEvidence.retrievedAt,at);assert.equal(summary.backupEvidence.officialFinalAttestation,undefined);assert.equal(valid.state.bdl.lastAcquisitionError,null);
 const changed=structuredClone(game.backup);changed.home_team_score++;const invalid=runFor(game,{cooldown:false,fetchImpl:async()=>Response.json({data:[changed]})});await assert.rejects(invalid.run(game.source,at),/GAME_TEAM_OR_SCORE_CONFLICT/);
});
test('patch preserves every prior correction/model file and rejects edited artifact or deployed version',()=>{
 assert.deepEqual(patched.audit.changedExistingFiles,['scripts/local/bdl-live.mjs']);
 for(const f of fixture.files)if(f.name!=='scripts/local/bdl-live.mjs')assert.deepEqual(patched.files.find(p=>p.name===f.name),f);
 for(const change of [b=>b.version=45,b=>b.verify_jwt=false,b=>b.files.find(f=>f.name==='scripts/local/bdl-live.mjs').content+='\n']){const b=structuredClone(fixture);change(b);assert.throws(()=>patcher.patchHostedReviewedHistoryBundle(b));}
 assert.throws(()=>patcher.patchHostedReviewedHistoryBundle(fixture,{artifact:'[]'}),/ARTIFACT_CHANGED/);
});
