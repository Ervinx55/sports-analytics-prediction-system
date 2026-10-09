import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {normalizePrediction,marketKey} from '../../supabase/functions/_shared/performance-contract.mjs';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);const db=new PGlite();
try{await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
for(const f of ['20261005000000_prediction_performance_ledger.sql','20261006000000_sport_capture_receipts.sql','20261006010000_priority_sport_contracts.sql'])await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
const now=new Date(Date.now()-60000).toISOString(),start=new Date(Date.now()+3600000).toISOString();
const base={sourceKey:'new:1',sport:'TENNIS',competitionKey:'open',tour:'ATP',eventKey:'event',marketScope:{unit:'MATCH'},marketType:'moneyline',side:'home',modelVersion:'v',modelMode:'SHADOW',modelAvailable:true,capturedAt:now,startsAt:start,quoteAt:now,modelProbability:.6,marketProbability:.5,probabilityBasis:'CONDITIONAL_NO_PUSH',sourceIds:{provider:'fixture',event:'1'},settlementRule:{version:'v',format:'BEST_OF_3',retirement:'VOID',walkover:'VOID'}};
const write=async p=>(await db.query('select ingest_prediction_v1($1::jsonb) id',[JSON.stringify(p)])).rows[0].id;
const p=normalizePrediction(base);const id=await write(p);assert.equal(await write(p),id);
const saved=(await db.query('select * from performance_predictions where id=$1',[id])).rows[0];assert.equal(saved.valid,true);assert.deepEqual(JSON.parse(saved.market_key),JSON.parse(marketKey(p)));
await assert.rejects(write({...p,odds:120}),/payload conflict/);
const other=normalizePrediction({...base,sourceKey:'new:2',competitionKey:'other'});const otherId=await write(other);assert.equal((await db.query('select valid from performance_predictions where id=$1',[otherId])).rows[0].valid,true);
const conflict=normalizePrediction({...base,sourceKey:'new:3',eventKey:'different'});const conflictId=await write(conflict);assert.equal((await db.query('select valid from performance_predictions where id=$1',[conflictId])).rows[0].valid,false);
const missing=normalizePrediction({...base,sourceKey:'new:4',competitionKey:null});missing.eligibilityReasons=[];const bad=await write(missing);assert.equal((await db.query('select valid from performance_predictions where id=$1',[bad])).rows[0].valid,false);
for(const [index,change] of [{tour:'WTA'},{marketScope:{unit:'SET',set:1}},{marketScope:{unit:'GAME',set:1,game:1}},{sport:'SOCCER',tour:null,marketScope:{period:'REGULATION'}},{sport:'SOCCER',tour:null,marketScope:{period:'INCLUDING_EXTRA_TIME'}},{sport:'NHL',tour:null,marketScope:{period:'REGULATION'}}].entries()){
 const candidate=normalizePrediction({...base,...change,sourceKey:'scope:'+index});const pid=await write(candidate);const row=(await db.query('select valid,market_key from performance_predictions where id=$1',[pid])).rows[0];assert.equal(row.valid,true);assert.deepEqual(JSON.parse(row.market_key),JSON.parse(marketKey(candidate)));
}
console.log('Priority sport SQL identity, mapping, idempotency and missing-scope checks passed');
}finally{await db.close();}
