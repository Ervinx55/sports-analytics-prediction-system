import {parsePerformanceFilters,selectCohort,summarizePerformance,PERFORMANCE_SPORTS} from './performance-metrics.mjs';
export async function readPerformance(client,input={},now=new Date()){
 const filters=parsePerformanceFilters(input,now);
 // One SQL statement snapshot returns a JSON object, avoiding PostgREST's row cap and cross-page drift.
 const {data,error}=await client.rpc('read_performance_v1',{p_from:filters.from,p_to:filters.to,p_sport:filters.sport});
 // Validate the decoded RPC object's UTF-8 serialization; this is not a streaming HTTP body cap.
 const decodedBytes=data?new TextEncoder().encode(JSON.stringify(data)).byteLength:0;
 if(data?.error==='PERFORMANCE_READ_LIMIT_EXCEEDED'||data?.predictions?.length>10000||data?.decisions?.length>30000||decodedBytes>20*1024*1024)throw Error('PERFORMANCE_READ_LIMIT_EXCEEDED');
 if(error||!data||!Array.isArray(data.predictions)||!Array.isArray(data.decisions)||!Array.isArray(data.settlements))throw Error('PERFORMANCE_READ_UNAVAILABLE');
 const rows=selectCohort(data.predictions,data.decisions,data.settlements,filters),result=summarizePerformance(rows,{filters,cursor:filters.cursor,limit:filters.limit,generatedAt:now.toISOString()});
 const diagnostics=selectCohort(data.predictions,data.decisions,data.settlements,{...filters,cohort:'DIAGNOSTIC'}),exclusions={};
 for(const p of diagnostics)for(const reason of new Set(p.eligibilityReasons??[]))if(typeof reason==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(reason))exclusions[reason]=(exclusions[reason]??0)+1;
 const settlementExclusions={};for(const r of rows)if(r.outcome==='UNRESOLVED'&&r.settlementReason&&/^[A-Z][A-Z0-9_]{0,99}$/.test(r.settlementReason))settlementExclusions[r.settlementReason]=(settlementExclusions[r.settlementReason]??0)+1;
 const exclusionCategories={model:{},source:{},mapping:{},rule:{},other:{}};
 for(const [reason,count] of Object.entries({...exclusions,...settlementExclusions})){const category=reason.includes('MODEL')?'model':/MAPPING|IDENTITY|PLAYER_KEY/.test(reason)?'mapping':/RULE|POLICY|SCOPE/.test(reason)?'rule':/SOURCE|PROVIDER|RESULT_ADAPTER/.test(reason)?'source':'other';exclusionCategories[category][reason]=count;}
 const matchingIds=new Set(data.predictions.filter(p=>(!filters.market||p.marketType===filters.market)&&(!filters.modelVersion||p.modelVersion===filters.modelVersion)&&(filters.kind==='ALL'||(filters.kind==='PROP')===p.marketType?.startsWith('player_'))).map(p=>p.id));
 const retries=(data.queue??[]).filter(q=>matchingIds.has(q.predictionId)&&q.lastError&&q.attempts>0);
 const retryReasons={};for(const q of retries){const reason=/^[A-Z][A-Z0-9_]{0,99}$/.test(q.lastError)?q.lastError:'PROVIDER_RETRY_PENDING';retryReasons[reason]=(retryReasons[reason]??0)+1;}
 const sports=filters.sport?[filters.sport]:PERFORMANCE_SPORTS;
 result.coverage={...result.coverage,legacyReconstructedCount:rows.filter(r=>r.legacyReconstructed).length,prospectiveCount:rows.filter(r=>!r.legacyReconstructed&&r.valid!==false).length,diagnosticCount:diagnostics.length,exclusions,settlementExclusions,exclusionCategories,retryCount:retries.length,retryReasons,providerState:retries.length?'PROVIDER_UNAVAILABLE_OR_RETRY_PENDING':'UNVERIFIED',settledCount:rows.filter(r=>['WIN','LOSS','PUSH','VOID'].includes(r.outcome)).length,missingOdds:rows.filter(r=>['WIN','LOSS','PUSH'].includes(r.outcome)&&!(typeof r.odds==='number'&&Number.isFinite(r.odds)&&Math.abs(r.odds)>=100)).length,limits:{rawPredictions:10000,decisions:30000,responseBytes:20*1024*1024,responseByteValidation:'DECODED_RPC_JSON_UTF8',streamingTransportByteLimit:false},infrastructure:'UNVERIFIED_DISABLED_BY_DEFAULT',providerCoverageState:'UNVERIFIED',providerLeagues:null,requestedTours:sports.includes('TENNIS')?['ATP','WTA']:[],sports:sports.map(sport=>({sport,samples:rows.filter(r=>r.sport===sport).length,modelAvailability:['MLB','NFL'].includes(sport)?'SAVED_SOURCE_CONTRACT_ONLY':'UNAVAILABLE',providerCoverage:'UNVERIFIED',state:rows.some(r=>r.sport===sport)?'PARTIAL': ['MLB','NFL'].includes(sport)?'NO_SAMPLES':'MODEL_UNAVAILABLE'}))};
 result.warnings=['Capture/settlement jobs are disabled by default; hosted runtime, provider coverage and release configuration remain unverified.','Saved MLB book settlement policy and exact NFL result mappings may be unavailable; exclusions and unresolved results are retained.','No execution records: returns are hypothetical; market anchored estimates are not independent skill evidence.'];
 return result;
}
