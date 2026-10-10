import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {readPerformance} from '../../supabase/functions/_shared/performance-read.mjs';
const runtime=await import(pathToFileURL(resolve(process.argv[2])).href);
let sql,cleanup;
if(runtime.PGlite){const db=new runtime.PGlite();sql={unsafe:async(statement,args)=>args?(await db.query(statement,args)).rows:(await db.exec(statement)).at(-1)?.rows??[]};cleanup=()=>db.close();}
else{
 if(!['127.0.0.1','localhost','::1'].includes(process.env.PGHOST)||!process.env.PGPORT||!process.env.PGUSER||!process.env.PGPASSWORD_FILE)throw Error('Explicit loopback PostgreSQL fixture configuration required');
 const postgres=runtime.default,config={host:process.env.PGHOST,port:Number(process.env.PGPORT),username:process.env.PGUSER,password:readFileSync(process.env.PGPASSWORD_FILE,'utf8').trim(),max:1};
 const admin=postgres({...config,database:'postgres'}),name=`performance_read_fixture_${process.pid}_${Date.now()}`;
 await admin`create database ${admin(name)}`;sql=postgres({...config,database:name});cleanup=async()=>{await sql.end();await admin`drop database ${admin(name)}`;await admin.end();};
}
try{
 await sql.unsafe("do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;");
 for(const f of ['20261005000000_prediction_performance_ledger.sql','20261006000000_sport_capture_receipts.sql','20261006010000_priority_sport_contracts.sql'])await sql.unsafe(readFileSync('supabase/migrations/'+f,'utf8'));
 // Actual Task5 queue/RLS schema prefix; scheduling functions and pg_cron are not needed for this read fixture.
 await sql.unsafe(readFileSync('supabase/migrations/20261006020000_register_prediction_performance_jobs.sql','utf8').split('create function public.claim_performance_settlements_v1')[0]);
 await sql.unsafe(readFileSync(process.argv[3]??'supabase/migrations/20261006030000_performance_read.sql','utf8'));
 await sql.unsafe("insert into performance_events select 'MLB','game:'||i,'2026-10-01T14:00:00Z'::timestamptz from generate_series(1,10000)i;");
 const insert=`insert into performance_predictions(source_key,sport,event_key,market_type,model_version,model_mode,model_available,captured_at,starts_at,eligibility_starts_at,quote_at,model_probability,market_probability,odds,probability_basis,source_ids,provenance,market_key,eligibility_reasons,valid,payload) select 'fixture:'||i,'MLB','game:'||i,'moneyline','v','LIVE',true,'2026-10-01T12:00:00Z'::timestamptz,'2026-10-01T14:00:00Z'::timestamptz,'2026-10-01T14:00:00Z'::timestamptz,'2026-10-01T12:00:00Z'::timestamptz,.6,.5,100,'CONDITIONAL_NO_PUSH','{}',jsonb_build_object('secret','never public','legacyReconstructed',i=1),'market:'||i,'[]',true,'{"secret":"never public"}' from generate_series($1::int,$2::int)i`;
 await sql.unsafe(insert,[1,250]);
 await sql.unsafe("insert into performance_predictions(source_key,model_available,captured_at,source_ids,provenance,market_key,eligibility_reasons,valid,payload) values('diagnostic',false,'2026-10-01T12:00:00Z','{}','{\"legacyReconstructed\":true}','diagnostic','[\"MODEL_UNAVAILABLE\",\"QUOTE_LINE_MISMATCH\"]',false,'{\"sport\":\"NFL\",\"secret\":\"never public\"}');");
 await sql.unsafe("insert into performance_settlements(prediction_id,revision,outcome,source,source_updated_at,settled_at,rule_version,payload) select id,1,'WIN','fixture',now(),now(),'fixture','{}' from performance_predictions where valid;");
 await sql.unsafe("insert into performance_settlements(prediction_id,revision,outcome,source,source_updated_at,settled_at,rule_version,supersedes_revision,payload) select id,2,'LOSS','fixture',now(),now(),'fixture',1,'{}' from performance_predictions where source_key='fixture:1';");
 await sql.unsafe("insert into performance_settlement_queue(prediction_id,sport,provider,attempts,last_error) select id,'MLB','fixture',1,'HTTP_429' from performance_predictions where source_key='fixture:2';");
 await sql.unsafe("insert into performance_decisions(source_key,prediction_id,market_key,issued_at,status,qualified,evidence,legacy_reconstructed,payload) select 'legacy:fixture2',id,'market:2','2026-10-01T12:01:00Z'::timestamptz,'PASS',false,'{}',true,'{}' from performance_predictions where source_key='fixture:2';");
 await sql.unsafe('set role service_role');
 const client={rpc:async(_name,args)=>({data:(await sql.unsafe('select read_performance_v1($1::timestamptz,$2::timestamptz,$3::text) value',[args.p_from,args.p_to,args.p_sport]))[0].value,error:null})};
 const f={sport:'MLB',from:'2026-10-01',to:'2026-10-03'};
 const first=await readPerformance(client,f);assert.equal(first.summary.count,250);assert.equal(first.summary.wins,249);assert.equal(first.summary.losses,1);assert.equal(first.rows.length,100);assert.equal(first.nextCursor,'100');assert.equal(first.summary.distinctGames,250);
 const all=(await client.rpc('',{p_from:'2026-10-01',p_to:'2026-10-03',p_sport:'MLB'})).data;const imported=all.predictions.find(p=>p.sourceKey==='fixture:1');assert.equal(imported.legacyReconstructed,true,'SQL must project immutable imported provenance');
 const legacy=await readPerformance(client,{...f,cohort:'LEGACY'});assert.equal(legacy.rows.length,2);assert.ok(legacy.rows.every(r=>r.legacyReconstructed===true));assert.equal(legacy.rows.find(r=>r.id===imported.id).issuedAt,null);
 const allPages=[first.rows,(await readPerformance(client,{...f,cursor:'100'})).rows,(await readPerformance(client,{...f,cursor:'200'})).rows].flat();assert.equal(allPages.find(r=>r.id===imported.id).legacyReconstructed,true);
 assert.equal(first.coverage.retryReasons.HTTP_429,1);assert.equal(first.coverage.providerState,'PROVIDER_UNAVAILABLE_OR_RETRY_PENDING');
 const third=await readPerformance(client,{...f,cursor:'200'});assert.equal(third.rows.length,50);assert.equal(third.summary.count,250);assert.equal(third.nextCursor,null);assert.ok(!JSON.stringify(first).includes('never public'));
 const diagnostic=await readPerformance(client,{...f,sport:'NFL'});assert.equal(diagnostic.coverage.diagnosticCount,1);assert.equal(diagnostic.coverage.exclusions.MODEL_UNAVAILABLE,1);assert.equal(diagnostic.summary.count,0);const diagnosticHistory=await readPerformance(client,{...f,sport:'NFL',cohort:'DIAGNOSTIC'});assert.equal(diagnosticHistory.rows[0].legacyReconstructed,true);
 const raw=(await client.rpc('',{p_from:'2026-10-01',p_to:'2026-10-03',p_sport:'MLB'})).data;assert.equal(raw.settlements.length,250);assert.equal(raw.settlements.find(s=>s.revision===2).outcome,'LOSS');
 for(const role of ['anon','authenticated']){await sql.unsafe('reset role');await sql.unsafe('set role '+role);await assert.rejects(sql.unsafe("select read_performance_v1('2026-10-01','2026-10-03',null)"),/permission denied/);await assert.rejects(sql.unsafe('select * from performance_predictions'),/permission denied/);}
 await sql.unsafe('reset role');
 const decisions="insert into performance_decisions(source_key,prediction_id,market_key,issued_at,status,qualified,evidence,legacy_reconstructed,payload) select 'decision:'||i,p.id,'diagnostic','2026-10-01T12:01:00Z'::timestamptz,'PASS',false,'{}',false,'{}' from performance_predictions p cross join generate_series($1::int,$2::int)i where p.source_key='diagnostic'";
 await sql.unsafe(decisions,[1,30000]);await sql.unsafe('set role service_role');
 assert.equal((await client.rpc('',{p_from:'2026-10-01',p_to:'2026-10-03',p_sport:'NFL'})).data.decisions.length,30000);
 await sql.unsafe('reset role');await sql.unsafe(decisions,[30001,30001]);await sql.unsafe('set role service_role');
 await assert.rejects(readPerformance(client,{...f,sport:'NFL'}),/PERFORMANCE_READ_LIMIT_EXCEEDED/);
 await sql.unsafe('reset role');await sql.unsafe(insert,[251,10000]);await sql.unsafe('set role service_role');
 const exact=(await client.rpc('',{p_from:'2026-10-01',p_to:'2026-10-03',p_sport:'MLB'})).data;assert.equal(exact.predictions.length,10000);
 await sql.unsafe('reset role');await sql.unsafe("insert into performance_predictions(source_key,model_available,captured_at,source_ids,provenance,market_key,eligibility_reasons,valid,payload) values('over-limit',false,'2026-10-01T12:00:00Z','{}','{}','over-limit','[]',false,'{\"sport\":\"MLB\"}');");await sql.unsafe('set role service_role');
 await assert.rejects(readPerformance(client,f),/PERFORMANCE_READ_LIMIT_EXCEEDED/);
 assert.equal((await sql.unsafe("select count(*)::int count from performance_predictions"))[0].count,10002,'read never mutates ledger');
 console.log('PostgreSQL performance read: 250-row full aggregates, three pages, latest revision, diagnostic payload sport, safe projection, RLS, exact 10000 limit and overflow passed');
}finally{await cleanup();}
