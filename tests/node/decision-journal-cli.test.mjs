import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { normalizeJournalDecision, runJournalOperation } from '../../scripts/edge-lab/decision-journal.mjs';

const script = new URL('../../scripts/edge-lab/decision-journal.mjs',import.meta.url);
const row = {source:'original_artifact',sourceReference:'cook',sport:'NFL',eventId:null,startsAt:null,
  playerName:'James Cook',playerId:null,marketType:'rushing_yards',marketScope:'FULL_GAME',side:'MORE',line:93.5,
  issuedAt:null,decision:'SELECT_RESEARCH',provenance:'conversation',evidence:{sourceDocument:'decision.md'},recordKind:'recommendation'};
function run(args, files) {
  const folder=mkdtempSync(join(tmpdir(),'edge-journal-test-'));
  try {
    for(const [name,value] of Object.entries(files))writeFileSync(join(folder,name),typeof value==='string'?value:JSON.stringify(value));
    return spawnSync(process.execPath,[script.pathname,...args],{cwd:folder,encoding:'utf8',env:{PATH:process.env.PATH}});
  } finally {rmSync(folder,{recursive:true,force:true});}
}
test('record CLI defaults to a reviewable no-network plan and keeps unknown issue times null',()=>{
  const result=run(['record','--input','record.json'],{'record.json':row});
  assert.equal(result.status,0,result.stderr);
  const plan=JSON.parse(result.stdout);
  assert.equal(plan.dryRun,true);assert.equal(plan.rpc,'record_edge_decision_v1');
  assert.equal(plan.args.p_decision.issuedAt,null);
  assert.equal(plan.args.p_decision.side,'OVER');
  assert.equal(plan.args.p_decision.isDocumentedWager,false);
});
test('record CLI will not apply writes without service credentials',()=>{
  const result=run(['record','--input','record.json','--apply'],{'record.json':row});
  assert.notEqual(result.status,0);assert.match(result.stderr,/SERVICE_CONFIG_REQUIRED/);
});
test('official result plan requires a matching source capture hash and reviewed identity binding',()=>{
  const bytes='official fixture capture';const hash=createHash('sha256').update(bytes).digest('hex');
  const payload={sport:'NBA',eventId:'nba:001',startsAt:'2020-01-02T01:00:00Z',playerId:'nba:player',marketType:'points',
    marketScope:'FULL_GAME',status:'FINAL',participation:'PLAYED',actualValue:16,officialEventId:'001',officialPlayerId:'player',
    sourceUrl:'https://www.nba.com/game/001/box-score',sourceSha256:hash,sourceCaptureFormat:'ORIGIN_RESPONSE_BYTES',retrievedAt:'2020-01-02T05:00:00Z',verifiedBy:'reviewer',
    identityEvidence:{eventId:'nba:001',startsAt:'2020-01-02T01:00:00Z',playerId:'nba:player',officialEventId:'001',officialPlayerId:'player',sourceSha256:hash,sourceCaptureFormat:'ORIGIN_RESPONSE_BYTES',marketType:'points',marketScope:'FULL_GAME',reference:'Matched official game and player.'}};
  const result=run(['result','--input','result.json','--source-file','source.txt'],{'result.json':payload,'source.txt':bytes});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).args.p_result.sourceSha256,hash);
  const invalid=run(['result','--input','result.json','--source-file','source.txt'],{'result.json':payload,'source.txt':bytes+'tampered'});
  assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/SOURCE_CAPTURE_HASH_MISMATCH/);
});
test('CLI does not fabricate a missing result source, accepts only supported operations and bounded batches',()=>{
  for(const args of [['result','--input','result.json'],['unknown'],['grade','--result-id','1','--limit','2001']]) {
    const r=run(args,{'result.json':{}});assert.notEqual(r.status,0);
  }
});
test('invalid calendar dates fail instead of rewriting the original issuance chronology',()=>{
  assert.throws(()=>normalizeJournalDecision({...row,issuedAt:'2020-02-30T01:00:00Z'}),/INVALID_ISSUED_AT/);
  assert.equal(normalizeJournalDecision({...row,issuedAt:'2020-02-29T01:00:00.123456Z'}).issuedAt,'2020-02-29T01:00:00.123456Z');
});
test('one explicit apply supports modern secret keys without a Bearer header and retains legacy JWT authentication',async()=>{
  for(const [envKey,key,bearer] of [['SUPABASE_SECRET_KEY','sb_secret_fixture',undefined],['SUPABASE_SERVICE_ROLE_KEY','legacy.fixture.jwt','Bearer legacy.fixture.jwt']]) {
    let calls=0;
    const result=await runJournalOperation({action:'record',input:row,apply:true},{
      env:{SUPABASE_URL:'https://fixture.supabase.co',[envKey]:key},
      fetchImpl:async(url,options)=>{
        calls++;assert.equal(String(url),'https://fixture.supabase.co/rest/v1/rpc/record_edge_decision_v1');
        assert.equal(options.method,'POST');assert.equal(options.headers.apikey,key);assert.equal(options.headers.authorization,bearer);
        assert.equal(JSON.parse(options.body).p_decision.issuedAt,null);
        return {ok:true,json:async()=>({journalId:1})};
      }
    });
    assert.equal(calls,1);assert.equal(result.result.journalId,1);
  }
});
