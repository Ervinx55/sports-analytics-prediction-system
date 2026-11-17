/** Append two independently reviewed source corrections to the exact deployed v45 manifest. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const gamebookManifestPath='docs/evaluations/nba-gamebooks-2026-11-12/corrections.json';
export const sourceBundleSha256='7bb9b9ef3de8c8c76e9d6b88eadd450518097cf602a6a3fa5b1b45854b853e8a';
export const sourceManifestSha256='914ceaafceeb2b5d858c72208b1b266b87e75bb95b2cf9263bd073a1807a52ff';
export const reviewedCorrectionsSha256='a6d4604280fb594c67884db0fa437bb9b335ec1f549864a15d955bfefc15763e';
const sha=x=>createHash('sha256').update(x).digest('hex');
const reviewedPath=new URL('../../docs/evaluations/nba-gamebooks-2026-11-17/corrections.json',import.meta.url);
export function appendReviewedGamebookCorrections(source,reviewed=readFileSync(reviewedPath,'utf8')){
 if(typeof source!=='string'||sha(source)!==sourceManifestSha256)throw Error('GAMEBOOK_MANIFEST_CHANGED_REVIEW_REQUIRED');
 if(typeof reviewed!=='string'||sha(reviewed)!==reviewedCorrectionsSha256)throw Error('REVIEWED_CORRECTIONS_CHANGED');
 const prior=JSON.parse(source),added=JSON.parse(reviewed);
 if(!Array.isArray(prior)||!Array.isArray(added)||added.length!==2||added.map(c=>c.eventID).sort().join(',')!=='lifymi4jrXCpckkBVDDC,vF7mrlCAIjmb7rtvfi4s')throw Error('GAMEBOOK_REVIEW_SCOPE');
 const next=[...prior,...added];if(new Set(next.map(c=>c.eventID)).size!==next.length)throw Error('GAMEBOOK_DUPLICATE_EVENT');
 return JSON.stringify(next,null,2)+'\n';
}
export function patchHostedGamebookBundle(bundle){
 if(bundle?.slug!=='collect-nba-props'||bundle.version!==45||bundle.verify_jwt!==true||bundle.ezbr_sha256!==sourceBundleSha256||!Array.isArray(bundle.files))throw Error('HOSTED_BUNDLE_CHANGED_REVIEW_REQUIRED');
 if(bundle.files.some(f=>typeof f?.name!=='string'||typeof f?.content!=='string')||new Set(bundle.files.map(f=>f.name)).size!==bundle.files.length)throw Error('INVALID_HOSTED_FILES');
 const matches=bundle.files.filter(f=>f.name===gamebookManifestPath);if(matches.length!==1)throw Error('GAMEBOOK_MANIFEST_NOT_UNIQUE');
 const source=matches[0].content,content=appendReviewedGamebookCorrections(source);
 return {slug:bundle.slug,verify_jwt:true,entrypoint_path:'supabase/functions/collect-nba-props/index.ts',files:bundle.files.map(f=>f.name===gamebookManifestPath?{...f,content}:{...f}),audit:{sourceVersion:45,sourceBundleSha256,sourceManifestSha256,reviewedCorrectionsSha256,patchedManifestSha256:sha(content),changedFiles:[gamebookManifestPath],priorCorrections:JSON.parse(source).length,appendedCorrections:2,frozenModelFilesChanged:false,acquisitionRulesChanged:false,settlementRulesChanged:false,productionWeightChanged:false}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const[input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/nba/patch-hosted-gamebook-corrections.mjs INPUT_V45_EXPORT OUTPUT_BUNDLE');
 const result=patchHostedGamebookBundle(JSON.parse(readFileSync(input,'utf8')));writeFileSync(output,JSON.stringify(result));console.log(JSON.stringify(result.audit,null,2));
}
