/** Route each collector to compatible pending observations; never rewrite evidence. */
import {createHash} from 'node:crypto';
export const nbaWorkerPath='scripts/hosted/nba-worker.mjs';
export const nbaWorkerV46Hash='06299bec94fc5a9253d9b452c3b23536db1e8124fd5ed0be6dde23cafa3f6f4c';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function patchNbaSourceQueueWorker(source){
 if(typeof source!=='string'||sha(source)!==nbaWorkerV46Hash)throw Error('WORKER_SOURCE_CHANGED_REVIEW_REQUIRED');
 const before="rpc('claim_nba_prop_run_v1',{})";
 if(source.split(before).length!==2)throw Error('WORKER_PATCH_CONTEXT_MISMATCH');
 return source.replace(before,"rpc('claim_nba_prop_run_v2',{p_source_contract:sgoKey?'sgo-nba-v1':'legacy'})");
}
export function patchNbaSourceQueueBundle(bundle){
 if(bundle?.slug!=='collect-nba-props'||bundle.verify_jwt!==true||!Array.isArray(bundle.files)||bundle.files.filter(f=>f.name===nbaWorkerPath).length!==1)throw Error('WORKER_BUNDLE_CHANGED_REVIEW_REQUIRED');
 const source=bundle.files.find(f=>f.name===nbaWorkerPath).content;
 const patched=patchNbaSourceQueueWorker(source);
 return {...bundle,files:bundle.files.map(f=>f.name===nbaWorkerPath?{...f,content:patched}:{...f}),queueAudit:{sourceSha256:sha(source),patchedSha256:sha(patched),changedFiles:[nbaWorkerPath],modelFilesChanged:false,productionWeightChanged:false,observationOrOutcomeRewrites:false}};
}
