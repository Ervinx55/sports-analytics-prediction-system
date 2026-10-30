import {PGlite} from '../../../performance-db-tools/package/dist/index.js';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {gradingRepository} from '../../supabase/functions/_shared/grading-database.mjs';
const db=new PGlite();
const sql={begin:async(mode,fn)=>{await db.exec('begin '+mode);try{const r=await fn({unsafe:async(q,args)=>args?(await db.query(q,args)).rows:(await db.exec(q)).at(-1)?.rows??[]});await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}};
try{
 await db.exec("create role service_role bypassrls;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('snapshot_publishable_key','fixture-only'); create table market_grade_observations(id bigint primary key,sport text,starts_at timestamptz);create table sharp_gate_history(id bigint,sport text,event_id text,checked_at timestamptz);");
 await db.exec(readFileSync('supabase/migrations/20260923012236_create_player_prop_audit_and_results.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260923034936_create_team_market_results_ledger.sql','utf8').split('create or replace view')[0]);
 await db.exec('grant usage on schema public to service_role;grant select,insert on all tables in schema public to service_role;');
 await db.exec("insert into market_grade_observations values(1,'MLB','2026-10-01'),(2,'NFL','2026-10-01');insert into player_prop_observations(id,model_version,event_id,player_name,stat_id,line,side,label,status,starts_at) values(1,'fixture','event','Player','batting_hits',1.5,'over','Hits','PASS','2026-10-01');");
 const r=gradingRepository(sql);
 assert.equal(await r.authorized('Bearer fixture-only'),true);assert.equal(await r.authorized('Bearer wrong'),false);
 assert.equal((await r.observations('team','2026-09-30','2026-10-02')).length,1);
 assert.equal((await r.observations('prop','2026-09-30','2026-10-02')).length,1);
 const common={observation_id:1,event_id:'event',outcome:'W',won:true,pushed:false,graded_at:'2026-10-02T00:00:00Z',raw:{fixture:true}};
 const prop={...common,stat_id:'batting_hits',line:1.5,side:'over',actual_value:2};
 assert.equal(await r.save('prop',[prop]),1);assert.equal(await r.save('prop',[{...prop,outcome:'L'}]),0);
 const team={...common,market_type:'moneyline',market_side:'home',market_label:'Home',decision_status:'PASS',away_score:1,home_score:2};
 assert.equal(await r.save('team',[team]),1);assert.equal(await r.save('team',[team]),0);
 assert.equal((await r.existing('team',[1])).length,1);assert.equal((await r.existing('prop',[1])).length,1);
 assert.equal((await db.query('select outcome from player_prop_results')).rows[0].outcome,'W');
 assert.deepEqual(await r.sharp(['missing']),[]);
 console.log('Grading database: real PostgreSQL schemas, authorization, sport isolation, saved outcomes and retry immutability passed');
}finally{await db.close();}
