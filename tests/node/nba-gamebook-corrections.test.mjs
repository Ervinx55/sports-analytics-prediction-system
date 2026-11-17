import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/nba-gamebook-corrections-v45.json',import.meta.url),'utf8'));
const baseline=process.env.NBA_GAMEBOOK_BASELINE==='1';
const patcher=baseline?{patchHostedGamebookBundle:b=>b}:await import('../../scripts/nba/patch-hosted-gamebook-corrections.mjs');
const patched=patcher.patchHostedGamebookBundle(fixture),root=mkdtempSync(join(tmpdir(),'nba-gamebook-review-'));
for(const file of patched.files){const path=join(root,file.name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,file.content);}
const {createBdlBackup,liveBdlContract}=await import(pathToFileURL(join(root,'scripts/local/bdl-live.mjs')));
const {applyGamebookRevision}=await import(pathToFileURL(join(root,'scripts/local/nba-gamebook-revision.mjs')));
test.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'nba-gamebook-review-'));rmSync(root,{recursive:true,force:true});});

for(const game of fixture.games)test('reviewed numeric correction accepts exact current '+game.source.eventID,async()=>{
 const observed='2026-11-17T17:00:00.000Z';
 const cacheKey=game.backupProvenance.storageKey,receipt=game.backupProvenance.retrievedAt;
 const packet={body:{data:[game.backup]},url:'https://api.balldontlie.io/v1/box_scores?date='+cacheKey.split(':')[1],retrievedAt:receipt,sha256:game.backupProvenance.sourceSha256};
 const state={bdl:{dates:{[cacheKey.split(':')[1]]:{key:cacheKey,retrievedAt:receipt}},nextRequestAt:Date.parse(observed)+3600000,lastAcquisitionError:'BDL_HTTP_401'}};
 const originalSource=structuredClone(game.source),originalBackup=structuredClone(game.backup);
 const run=createBdlBackup({key:'fixture-only',state,summaries:{[cacheKey]:packet},loadSummaries:async()=>({}),clock:()=>observed,fetchImpl:async()=>{throw Error('NETWORK_FORBIDDEN');}});
 const summary=await run(game.source,observed);
 assert.equal(summary.id,'sgo:'+game.source.eventID);assert.equal(summary.backupEvidence.retrievedAt,receipt);
 assert.equal(summary.backupEvidence.officialGamebookRevision.eventID,game.source.eventID);
 assert.equal(summary.backupEvidence.staleCacheFallback.reason,'BDL_COOLDOWN');assert.equal(state.bdl.lastAcquisitionError,'BDL_HTTP_401');
 assert.deepEqual(game.source,originalSource);assert.deepEqual(game.backup,originalBackup);
 assert.equal(liveBdlContract,'nba-bdl-live-v4:b82b8c2456625960c1b0a62ba35813cf22aaec0ae2d3fb89e6663b9538c29c02');
});

test('changed primary or backup inputs require renewed review',()=>{
 for(const game of fixture.games){
  const source=structuredClone(game.source);source.results.game.home.points++;
  assert.throws(()=>applyGamebookRevision(source,game.backup),/GAMEBOOK_SOURCE_CHANGED/);
  const backup=structuredClone(game.backup);backup.home_team_score++;
  assert.throws(()=>applyGamebookRevision(game.source,backup),/GAMEBOOK_BACKUP_CHANGED/);
 }
});

test('patch only appends the two reviewed records and preserves every other hosted file',()=>{
 const path=patcher.gamebookManifestPath,prior=JSON.parse(fixture.files.find(f=>f.name===path).content),next=JSON.parse(patched.files.find(f=>f.name===path).content);
 assert.deepEqual(next.slice(0,prior.length),prior);assert.equal(next.length,prior.length+2);
 assert.deepEqual(next.slice(prior.length).map(c=>c.eventID).sort(),['lifymi4jrXCpckkBVDDC','vF7mrlCAIjmb7rtvfi4s'].sort());
 assert.equal(new Set(next.map(c=>c.eventID)).size,next.length);
 for(const before of fixture.files)if(before.name!==path)assert.deepEqual(patched.files.find(f=>f.name===before.name),before);
 assert.deepEqual(patched.audit.changedFiles,[path]);assert.equal(patched.audit.frozenModelFilesChanged,false);assert.equal(patched.audit.acquisitionRulesChanged,false);
});

test('changed hosted version, authentication, manifest or reviewed artifact rejects',()=>{
 for(const edit of [b=>b.version=44,b=>b.verify_jwt=false,b=>b.ezbr_sha256='0'.repeat(64),b=>b.files.push({...b.files[0]}),b=>b.files.find(f=>f.name===patcher.gamebookManifestPath).content+='\n']){
  const b=structuredClone(fixture);edit(b);assert.throws(()=>patcher.patchHostedGamebookBundle(b));
 }
 const source=fixture.files.find(f=>f.name===patcher.gamebookManifestPath).content;
 assert.throws(()=>patcher.appendReviewedGamebookCorrections(source,'[]'),/REVIEWED_CORRECTIONS_CHANGED/);
});
