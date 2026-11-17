import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const sha=x=>createHash('sha256').update(x).digest('hex');
export const bdlPath='scripts/local/bdl-live.mjs';
export const helperPath='scripts/local/nba-reviewed-history-evidence.mjs';
export const artifactPath='docs/evaluations/nba-reviewed-history-2026-11-17/evidence.json';
export const originalBdlSha256='e61660e3c937399651ed2cd8b7b7ce9025e89e81eeba107f55f7870243712aaf';
export const artifactSha256='6dbb3ff0d7bece28e154875bd6733e38743f0eeeb639b31194cccfadafef440e';
export const helperSha256='f1f3411c07288aeaf27304ffd94bd5d6086650607a3e5e68c0331f9fa1e10a8b';
function once(s,b,a){if(s.split(b).length!==2)throw Error('HISTORY_PATCH_CONTEXT_CHANGED');return s.replace(b,a);}
export function patchHostedReviewedHistoryBundle(bundle,{artifact=readFileSync(new URL('../../'+artifactPath,import.meta.url),'utf8')}={}){
 if(bundle?.slug!=='collect-nba-props'||bundle.version!==46||bundle.verify_jwt!==true||bundle.ezbr_sha256!=='35f4766c46e369433a953da4006f12bafadbca74fcc9c985f519986a459276b4'||!Array.isArray(bundle.files))throw Error('HISTORY_BUNDLE_CHANGED');
 if(sha(artifact)!==artifactSha256)throw Error('HISTORY_ARTIFACT_CHANGED');
 if(bundle.files.some(f=>typeof f.name!=='string'||typeof f.content!=='string')||new Set(bundle.files.map(f=>f.name)).size!==bundle.files.length||bundle.files.some(f=>[helperPath,artifactPath].includes(f.name)))throw Error('HISTORY_FILES_CHANGED');
 const original=bundle.files.find(f=>f.name===bdlPath)?.content;if(typeof original!=='string'||sha(original)!==originalBdlSha256)throw Error('HISTORY_BDL_SOURCE_CHANGED');
 let source=once(original,"import {createHash} from 'node:crypto';","import {createHash} from 'node:crypto';\nimport {applyReviewedHistoryEvidence,verifyFreshOfficialFinal} from './nba-reviewed-history-evidence.mjs';");
 source=once(source,'let pointer=cache.dates[date],packet,staleReason=null;','let pointer=cache.dates[date],packet,staleReason=null,officialAttestation=null;');
 source=once(source,'if(!pointer||now-start<48*3600000||!/^BDL_', 'if(!pointer||!/^BDL_');
 source=once(source,'    staleReason=error.message;fallbackAudit.attempts++;',`    if(now-start<48*3600000){officialAttestation=verifyFreshOfficialFinal(e,packet,now);if(!officialAttestation)throw error;}
    staleReason=error.message;fallbackAudit.attempts++;`);
 source=once(source,'  const revision=applyGamebookRevision(e,candidates[0]);',`  const reviewed=applyReviewedHistoryEvidence(e,candidates[0],now);
  const revision=applyGamebookRevision(reviewed.source,reviewed.backup);`);
 source=once(source,'Math.max(time(observed),time(packet.retrievedAt),reviewedAt)','Math.max(time(observed),time(packet.retrievedAt),reviewedAt,reviewed.evidence?time(reviewed.evidence.evidenceObservedAt):0,officialAttestation?time(officialAttestation.evidenceObservedAt):0)');
 source=once(source,'  if(revision.evidence)g.backupEvidence.officialGamebookRevision=revision.evidence;',`  if(revision.evidence)g.backupEvidence.officialGamebookRevision=revision.evidence;
  if(reviewed.evidence)g.backupEvidence.reviewedHistoryRevision=reviewed.evidence;
  if(officialAttestation)g.backupEvidence.officialFinalAttestation=officialAttestation;`);
 source=once(source,'cacheKey:pointer.key,minimumGameAgeHours:48','cacheKey:pointer.key,...(officialAttestation?{acceptedVia:\'FRESH_NBA_OFFICIAL_ATTESTATION\',maximumOfficialAgeHours:6}:{minimumGameAgeHours:48})');
 const helper=readFileSync(new URL('./reviewed-history-evidence.mjs',import.meta.url),'utf8');
 if(sha(helper)!==helperSha256)throw Error('HISTORY_HELPER_CHANGED');
 return {slug:bundle.slug,verify_jwt:true,entrypoint_path:'supabase/functions/collect-nba-props/index.ts',files:[...bundle.files.map(f=>f.name===bdlPath?{...f,content:source}:{...f}),{name:helperPath,content:helper},{name:artifactPath,content:artifact}],audit:{sourceVersion:46,changedExistingFiles:[bdlPath],addedFiles:[helperPath,artifactPath],sourceBdlSha256:originalBdlSha256,patchedBdlSha256:sha(source),helperSha256:sha(helper),artifactSha256,frozenModelFilesChanged:false,existingCorrectionFilesChanged:false,productionWeightChanged:false,sourceRepairOnly:true,officialFreshnessMaximumHours:6}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: INPUT_V46_EXPORT OUTPUT_BUNDLE');const r=patchHostedReviewedHistoryBundle(JSON.parse(readFileSync(input,'utf8')));writeFileSync(output,JSON.stringify(r));console.log(JSON.stringify(r.audit,null,2));}
