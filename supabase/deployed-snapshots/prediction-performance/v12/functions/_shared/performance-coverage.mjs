/** Describe only evidence returned by this report; no live-provider health claims. */
export function explainCoverage(result){
 for(const item of result.coverage?.sports??[]){
  const history=item.sport==='MLB'?result.history?.summary:null;
  const selected=Number.isSafeInteger(item.samples)?item.samples:0;
  item.message=selected>0?`${selected} saved predictions match these filters.`:'No predictions match the selected category and dates.';
  if(history&&history.auditRows>0){
   item.message+=` Historical MLB audit: ${history.grades} graded observations from ${history.auditRows} snapshots, stored separately. Last capture: ${history.latestAuditAt??'unknown'}.`;
   if(item.modelAvailability!=='SAVED_FORECASTS')item.modelAvailability='HISTORICAL_RECORDS_AVAILABLE';
  }else if(item.state==='DIAGNOSTIC_ONLY'){
   item.message+=' Saved forecasts need validation. Select Raw excluded candidates to inspect them.';
  }
  if(['SAVED_SOURCE_CONTRACT_ONLY','UNAVAILABLE'].includes(item.modelAvailability))item.modelAvailability='NO_SAVED_MODEL_EVIDENCE';
  item.providerCoverage='Live provider status is not checked by this results report.';
 }
 result.coverage.infrastructure='RESULTS_READER_CONNECTED';
 result.coverage.providerCoverageState='NOT_CHECKED_BY_RESULTS_REPORT';
 result.warnings=(result.warnings??[]).filter(w=>!w.startsWith('Capture/settlement jobs are disabled by default;'));
 result.warnings.unshift('This report shows saved records. Background capture, settlement jobs and live provider coverage require separate health checks.');
 return result;
}
