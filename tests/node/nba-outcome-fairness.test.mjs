import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchCollectorSource,patchHostedBundle,collectorPath} from '../../scripts/nba/patch-hosted-outcome-fairness.mjs';
const original=readFileSync(new URL('../fixtures/nba-outcome-collector-v42.txt',import.meta.url),'utf8');
function selector(source){const code=source.slice(source.indexOf('export function selectSgoSettlementEvents'),source.indexOf('export async function exactSgoEvents'));return Function(code.replace('export ','')+';return selectSgoSettlementEvents')();}
test('all eligible games rotate backup priority even when fewer than eight fit',()=>{
 const select=selector(patchCollectorSource(original)),state={},rows=['a','b','c'].map(id=>({eventID:'sgo:'+id,startsAt:'2026-11-15T01:00:00Z'}));
 assert.equal(select(rows,state)[0],'a');
 assert.equal(select(rows,state)[0],'b');
 assert.equal(select(rows,state)[0],'c');
});

test('large queues retain the eight-event request limit without starvation',()=>{
 const select=selector(patchCollectorSource(original)),state={},rows=Array.from({length:19},(_,i)=>({eventID:'sgo:g'+i,startsAt:'2026-11-15T01:00:00Z'}));
 const seen=new Set();for(let i=0;i<3;i++){const ids=select(rows,state);assert.equal(ids.length,8);ids.forEach(id=>seen.add(id));}assert.equal(seen.size,19);
 assert.deepEqual(select([],state),[]);
});

test('one-date backup budget follows rotated priority, not persistent DB order',async()=>{
 const source=patchCollectorSource(original),select=selector(source),state={};
 const pending=['a','b'].map(id=>({identity:id,eventID:'sgo:'+id,startsAt:'2026-11-15T01:00:00Z',context:{sourceContract:'sgo-nba-v1'}}));
 const code=source.slice(source.indexOf(' const settlePending=async()=>{'),source.indexOf(' // Alternate priority'));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const execute=new AsyncFunction('db','state','clock','selectSgoSettlementEvents','exactSgoEvents','page','season','sgoOutcome','liveBackup','resolvedSummary','backupArchive','bdlArchive','report',code+';await settlePending();');
 const settled=[];const db={pending:()=>pending,settle:row=>{settled.push(row.identity);return 1;}};
 const results=[];
 for(let run=0;run<2;run++){
  let used=false;const report={settled:0,faults:[]};
  const resolve=async e=>{if(used)throw Error('BDL_RUN_BUDGET');used=true;if(e.eventID==='a')throw Error('PLAYER_MAPPING_UNVERIFIED');return {valid:true};};
  await execute(db,state,()=> '2026-11-16T12:00:00Z',select,async ids=>({events:ids.slice().reverse().map(eventID=>({eventID})),observedAt:'2026-11-16T12:00:00Z'}),()=>{},()=>2026,(row,e,at,year,g)=>g?{identity:row.identity}:null,true,resolve,null,null,report);
  results.push(report);
 }
 assert.deepEqual(settled,['b']);assert.equal(results[0].settlement.failures['sgo:a'],'PLAYER_MAPPING_UNVERIFIED');assert.equal(results[0].settlement.failures['sgo:b'],'BDL_RUN_BUDGET');assert.equal(results[1].settled,1);
});

test('patch is immutable and changes only audited collector source',()=>{
 const frozen='{\"productionWeight\":0,\"weights\":[1,2]}',bundle={slug:'collect-nba-props',version:42,verify_jwt:true,entrypoint_path:'supabase/functions/collect-nba-props/index.ts',files:[{name:collectorPath,content:original},{name:'candidate.json',content:frozen}]};
 const before=JSON.stringify(bundle),result=patchHostedBundle(bundle);
 assert.equal(JSON.stringify(bundle),before);assert.equal(result.files[1].content,frozen);assert.deepEqual(result.audit.changedFiles,[collectorPath]);assert.equal(result.verify_jwt,true);
 assert.throws(()=>patchHostedBundle({...bundle,version:43}),/CHANGED_REVIEW/);
 assert.throws(()=>patchHostedBundle({...bundle,verify_jwt:false}),/CHANGED_REVIEW/);
 assert.throws(()=>patchCollectorSource(original+'\n'),/SOURCE_CHANGED/);
 assert.throws(()=>patchHostedBundle({...bundle,files:[...bundle.files,bundle.files[0]]}),/INVALID_HOSTED_FILES/);
});
