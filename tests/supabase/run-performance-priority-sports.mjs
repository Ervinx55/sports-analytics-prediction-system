import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {normalizePrediction,marketKey} from '../../supabase/functions/_shared/performance-contract.mjs';
const runtime=await import(pathToFileURL(resolve(process.argv[2])).href);
let db;
if(runtime.PGlite) db=new runtime.PGlite();
else {
 if(!['127.0.0.1','localhost','::1'].includes(process.env.PGHOST)||!process.env.PGPORT||!process.env.PGUSER||!process.env.PGPASSWORD_FILE)throw Error('Explicit loopback PostgreSQL fixture configuration required');
 const postgres=runtime.default,config={host:process.env.PGHOST,port:Number(process.env.PGPORT),username:process.env.PGUSER,password:readFileSync(process.env.PGPASSWORD_FILE,'utf8').trim(),max:2};
 const admin=postgres({...config,database:'postgres'}),name=`priority_scope_fixture_${process.pid}_${Date.now()}`;
 await admin`create database ${admin(name)}`;const native=postgres({...config,database:name});
 db={exec:sql=>native.unsafe(sql,[],{prepare:false}),query:async(sql,args)=>({rows:await native.unsafe(sql,(args??[]).map(v=>!sql.includes('::text::jsonb')&&typeof v==='string'&&v.startsWith('{')?JSON.parse(v):v),{prepare:false})}),close:async()=>{await native.end();await admin`drop database ${admin(name)}`;await admin.end();}};
}

try{await db.exec("do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;");
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
for(const [index,change] of [{tour:'WTA'},{marketScope:{unit:'GAME',set:9007199254740991,game:9007199254740991}},{marketScope:{unit:'SET',set:1}},{marketScope:{unit:'GAME',set:1,game:1}},{sport:'SOCCER',tour:null,marketScope:{period:'REGULATION'}},{sport:'SOCCER',tour:null,marketScope:{period:'INCLUDING_EXTRA_TIME'}},{sport:'NHL',tour:null,marketScope:{period:'REGULATION'}}].entries()){
 const candidate=normalizePrediction({...base,...change,sourceKey:'scope:'+index});const pid=await write(candidate);const row=(await db.query('select valid,market_key from performance_predictions where id=$1',[pid])).rows[0];assert.equal(row.valid,true);assert.deepEqual(JSON.parse(row.market_key),JSON.parse(marketKey(candidate)));
}
for(const [i,value] of ['1',true,null,0,-1,1.5,9007199254740992].entries())for(const [j,marketScope] of [{unit:'SET',set:value},{unit:'GAME',set:1,game:value}].entries()){
 const candidate={...base,sourceKey:`bad-index:${i}:${j}`,marketScope,eligibilityReasons:[]};const pid=await write(candidate);const row=(await db.query('select valid,eligibility_reasons from performance_predictions where id=$1',[pid])).rows[0];assert.equal(row.valid,false,JSON.stringify(marketScope));assert.ok(row.eligibility_reasons.includes('INVALID_MARKET_SCOPE'));
}
for(const unit of ['SET','GAME']){
const numeric=normalizePrediction({...base,sourceKey:`scale:integer:${unit}`,marketScope:unit==='SET'?{unit,set:1}:{unit,set:1,game:1}});const numericId=await write(numeric);
const raw=JSON.stringify({...numeric,sourceKey:`scale:decimal:${unit}`}).replace('"set":1','"set":1.0').replace('"game":1','"game":1.0');
const decimalId=(await db.query('select ingest_prediction_v1($1::text::jsonb) id',[raw])).rows[0].id;
const scaleRows=(await db.query('select market_key,payload from performance_predictions where id=$1 or id=$2',[numericId,decimalId])).rows;
assert.equal(scaleRows[0].market_key,scaleRows[1].market_key,'equal numeric indices must share portfolio identity');
assert.equal((await db.query("select payload#>'{marketScope,set}' as index, (payload#>'{marketScope,set}')::text as raw from performance_predictions where id=$1",[decimalId])).rows[0].raw,'1.0','raw payload representation retained');
}
console.log('Priority sport SQL identity, mapping, idempotency and missing-scope checks passed');
}finally{await db.close();}
