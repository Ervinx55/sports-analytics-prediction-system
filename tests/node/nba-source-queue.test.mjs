import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=JSON.parse(readFileSync(new URL('../fixtures/nba-hosted-worker-v46.json',import.meta.url),'utf8')).content;
let patch=source=>source;
try{({patchNbaSourceQueueWorker:patch}=await import('../../scripts/nba/patch-hosted-source-queue.mjs'));}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
function worker(code){return vm.runInNewContext(code.replace(/^import .*;\r?\n/gm,'').replace(/export /g,'')+'\nrunHosted',{fetch});}
test('SGO worker claims only the native SGO outcome queue',async()=>{
 const calls=[];const result=await worker(patch(source))({rpc:async(name,args)=>{calls.push({name,args});return null;},sgoKey:'fixture'});
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{name:'claim_nba_prop_run_v2',args:{p_source_contract:'sgo-nba-v1'}}]);
 assert.equal(result.skipped,'LEASE_BUSY');
});
test('legacy collector requests only its compatible queue',async()=>{
 const calls=[];await worker(patch(source))({rpc:async(name,args)=>{calls.push({name,args});return null;}});
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{name:'claim_nba_prop_run_v2',args:{p_source_contract:'legacy'}}]);
});
test('unreviewed worker changes are rejected before patching',()=>{
 assert.throws(()=>patch(source+'// changed'),/SOURCE_CHANGED/);
});
