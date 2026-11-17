/** Recover expired final history only after an acquisition failure, with strict reconciliation. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const bdlPath='scripts/local/bdl-live.mjs';
export const originalBdlSha256='e09b0afa9cc12e4a340694b420e6b3090028f973aa66446e8f1ad6c6eda02154';
const sha=value=>createHash('sha256').update(value).digest('hex');
function replaceOnce(source,before,after){
 if(source.split(before).length!==2)throw Error('BDL_PATCH_CONTEXT_MISMATCH');
 return source.replace(before,after);
}

export function patchHistoryCacheSource(source){
 if(typeof source!=='string'||sha(source)!==originalBdlSha256)throw Error('BDL_SOURCE_CHANGED_REVIEW_REQUIRED');
 let result=replaceOnce(source,'cache.dates??={};let requested=false;',"cache.dates??={};let requested=false;\n const fallbackAudit=cache.staleFallback={at:clock(),attempts:0,accepted:0,rejected:0,events:{}};");
 result=replaceOnce(result,'let pointer=cache.dates[date],packet;','let pointer=cache.dates[date],packet,staleReason=null;');
 result=replaceOnce(result,'requested=true;cache.nextRequestAt=now+15000;','requested=true;cache.nextRequestAt=now+15000;cache.lastAcquisitionAttemptAt=clock();');
 result=replaceOnce(result,"    const body=JSON.parse(text);require(Array.isArray(body.data)&&body.data.length<=30,'BDL_INVALID_RESPONSE');","    let body;try{body=JSON.parse(text);}catch{throw Error('BDL_INVALID_RESPONSE');}require(Array.isArray(body?.data)&&body.data.length<=30,'BDL_INVALID_RESPONSE');");
 result=replaceOnce(result,"    packet={body,url,retrievedAt:clock(),sha256:createHash('sha256').update(text).digest('hex')};","    packet={body,url,retrievedAt:clock(),sha256:createHash('sha256').update(text).digest('hex')};cache.lastAcquisitionError=null;cache.lastSuccessfulFetchAt=packet.retrievedAt;");
 result=replaceOnce(result,'  if(!packet){\n   require((cache.nextRequestAt', '  if(!packet){\n   try{\n   require((cache.nextRequestAt');
 result=replaceOnce(result,"   }catch(err){cache.lastError=/^BDL_/.test(err.message)?err.message:'BDL_FETCH_FAILED';throw Error(cache.lastError);}finally{clearTimeout(timer);}\n  }",String.raw`   }catch(err){cache.lastError=/^BDL_/.test(err.message)?err.message:'BDL_FETCH_FAILED';throw Error(cache.lastError);}finally{clearTimeout(timer);}
   }catch(error){
    // Keep the existing 48-hour recent-game boundary: incomplete/live results and
    // recent settlements still require the normal fresh-source policy.
    if(!pointer||now-start<48*3600000||!/^BDL_(?:HTTP_\d{3}|COOLDOWN|RUN_BUDGET|FETCH_FAILED)$/.test(error.message))throw error;
    packet=summaries[pointer.key];if(!packet){Object.assign(summaries,await loadSummaries([pointer.key]));packet=summaries[pointer.key];}
    require(packet&&packet.url==='https://api.balldontlie.io/v1/box_scores?date='+date&&/^[a-f0-9]{64}$/.test(packet.sha256??'')&&pointer.key==='bdl-date:'+date+':'+packet.sha256+':'+packet.retrievedAt&&pointer.retrievedAt===packet.retrievedAt&&time(packet.retrievedAt)>start&&time(packet.retrievedAt)<=now&&Array.isArray(packet.body?.data)&&packet.body.data.length<=30,'BDL_STALE_CACHE_PROVENANCE');
    staleReason=error.message;fallbackAudit.attempts++;
   }
  }`);
 result=replaceOnce(result,"cache.lastError=/^BDL_/.test(err.message)?err.message:'BDL_FETCH_FAILED';throw Error(cache.lastError);","cache.lastError=/^BDL_/.test(err.message)?err.message:'BDL_FETCH_FAILED';cache.lastAcquisitionError=cache.lastError;throw Error(cache.lastError);");
 result=replaceOnce(result,'  const candidates=packet.body.data.filter', '  try{\n  const candidates=packet.body.data.filter');
 result=replaceOnce(result,'  cache.lastVerifiedAt=clock();cache.lastError=null;return g;',String.raw`  if(staleReason){
   g.backupEvidence.staleCacheFallback={reason:staleReason,verifiedAt:clock(),retrievedAt:packet.retrievedAt,cacheKey:pointer.key,minimumGameAgeHours:48};
   fallbackAudit.events[e.eventID]={status:'ACCEPTED',reason:staleReason,retrievedAt:packet.retrievedAt};
   fallbackAudit.accepted=Object.values(fallbackAudit.events).filter(r=>r.status==='ACCEPTED').length;
   fallbackAudit.rejected=Object.values(fallbackAudit.events).filter(r=>r.status==='REJECTED').length;
  }
  // Verification time describes reconciliation; retrieval time remains original.
  // A cached success must not erase the live provider's authorization failure.
  cache.lastVerifiedAt=clock();if(!staleReason&&!cache.lastAcquisitionError)cache.lastError=null;return g;
  }catch(error){
   if(staleReason){fallbackAudit.events[e.eventID]={status:'REJECTED',reason:error.message,retrievedAt:packet.retrievedAt};fallbackAudit.rejected=Object.values(fallbackAudit.events).filter(r=>r.status==='REJECTED').length;fallbackAudit.accepted=Object.values(fallbackAudit.events).filter(r=>r.status==='ACCEPTED').length;}
   throw error;
  }`);
 return result;
}

export function patchHostedHistoryCacheBundle(bundle){
 if(bundle?.slug!=='collect-nba-props'||bundle.version!==44||bundle.verify_jwt!==true||!Array.isArray(bundle.files))throw Error('HOSTED_BUNDLE_CHANGED_REVIEW_REQUIRED');
 if(bundle.files.some(f=>typeof f?.name!=='string'||typeof f?.content!=='string')||new Set(bundle.files.map(f=>f.name)).size!==bundle.files.length)throw Error('INVALID_HOSTED_FILES');
 const matches=bundle.files.filter(f=>f.name===bdlPath);if(matches.length!==1)throw Error('BDL_FILE_NOT_UNIQUE');
 const source=matches[0].content,patched=patchHistoryCacheSource(source);
 return {slug:bundle.slug,verify_jwt:true,entrypoint_path:'supabase/functions/collect-nba-props/index.ts',files:bundle.files.map(f=>f.name===bdlPath?{...f,content:patched}:{...f}),audit:{sourceVersion:44,sourceSha256:sha(source),patchedSha256:sha(patched),changedFiles:[bdlPath],sourceAcquisitionOnly:true,settlementRulesChanged:false,productionWeightChanged:false,forecastOrModelFilesChanged:false}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output]=process.argv.slice(2);
 if(!input||!output)throw Error('Usage: node scripts/nba/patch-hosted-history-cache.mjs INPUT_V44_EXPORT OUTPUT_BUNDLE');
 const result=patchHostedHistoryCacheBundle(JSON.parse(readFileSync(input,'utf8')));
 writeFileSync(output,JSON.stringify(result));console.log(JSON.stringify(result.audit,null,2));
}
