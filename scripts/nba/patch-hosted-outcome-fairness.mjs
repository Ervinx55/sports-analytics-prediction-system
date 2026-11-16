/** Reviewed transport-only patch for the exported hosted collector; never fits a model. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const collectorPath='scripts/local/sgo-nba-collector.mjs';
export const originalCollectorSha256='bc0b2161c675d167153a95a0734039b20019b0bb10e29bad2b56a0c376f75b90';
const sha=value=>createHash('sha256').update(value).digest('hex');
function replaceOnce(source,before,after){
 if(source.split(before).length!==2)throw Error('COLLECTOR_PATCH_CONTEXT_MISMATCH');
 return source.replace(before,after);
}

export function patchCollectorSource(source){
 if(typeof source!=='string'||sha(source)!==originalCollectorSha256)throw Error('COLLECTOR_SOURCE_CHANGED_REVIEW_REQUIRED');
 let result=replaceOnce(source,
  'state.sgoSettlementCursors[key]=(cursor+selected.length)%ids.length;',
  '// Rotate priority even when every event fits: the backup permits one fresh date per run.\n state.sgoSettlementCursors[key]=(cursor+(ids.length<=8?1:selected.length))%ids.length;');
 result=replaceOnce(result,
  '  const repaired=new Map();\n  for(const row of pending){',
  '  const repaired=new Map();\n  const priority=new Map(ids.map((id,index)=>[`sgo:${id}`,index]));\n  const ordered=pending.filter(row=>priority.has(row.eventID)).sort((a,b)=>priority.get(a.eventID)-priority.get(b.eventID));\n  report.settlement={selectedEvents:ids.length,pendingRows:ordered.length,failures:{}};\n  for(const row of ordered){');
 result=replaceOnce(result,
  '}catch{repaired.set(row.eventID,null);}',
  '}catch(error){repaired.set(row.eventID,null);const reason=/^[A-Z][A-Z0-9_]{1,100}$/.test(error?.message??\'\')?error.message:\'SETTLEMENT_SOURCE_FAILED\';report.settlement.failures[row.eventID]=reason;}');
 return result;
}

export function patchHostedBundle(bundle){
 if(bundle?.slug!=='collect-nba-props'||bundle.version!==42||bundle.verify_jwt!==true||!Array.isArray(bundle.files))throw Error('HOSTED_BUNDLE_CHANGED_REVIEW_REQUIRED');
 if(bundle.files.some(f=>typeof f?.name!=='string'||typeof f?.content!=='string')||new Set(bundle.files.map(f=>f.name)).size!==bundle.files.length)throw Error('INVALID_HOSTED_FILES');
 const matches=bundle.files.filter(f=>f.name===collectorPath);if(matches.length!==1)throw Error('COLLECTOR_FILE_NOT_UNIQUE');
 const source=matches[0].content,patched=patchCollectorSource(source);
 return {slug:bundle.slug,verify_jwt:true,entrypoint_path:'supabase/functions/collect-nba-props/index.ts',files:bundle.files.map(f=>f.name===collectorPath?{...f,content:patched}:{...f}),audit:{sourceVersion:42,sourceSha256:sha(source),patchedSha256:sha(patched),changedFiles:[collectorPath],productionWeightChanged:false,forecastOrModelFilesChanged:false}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output]=process.argv.slice(2);
 if(!input||!output)throw Error('Usage: node scripts/nba/patch-hosted-outcome-fairness.mjs INPUT_EXPORT OUTPUT_BUNDLE');
 const result=patchHostedBundle(JSON.parse(readFileSync(input,'utf8')));
 writeFileSync(output,JSON.stringify(result));console.log(JSON.stringify(result.audit,null,2));
}
