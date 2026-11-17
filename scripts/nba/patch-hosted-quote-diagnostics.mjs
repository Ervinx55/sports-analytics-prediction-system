/** Preserve suspended opposite prices for diagnostics without changing gates. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const quotePath='scripts/local/nba-direct-props.mjs';
export const originalQuoteSha256='ab43abbfff84ee8a946d805b1ac8a69a59a92558209a5f1c4359d74876a7465c';
const sha=value=>createHash('sha256').update(value).digest('hex');
function replaceOnce(source,before,after){
 if(source.split(before).length!==2)throw Error('QUOTE_PATCH_CONTEXT_MISMATCH');
 return source.replace(before,after);
}
export function patchQuoteDiagnosticsSource(source){
 if(typeof source!=='string'||sha(source)!==originalQuoteSha256)throw Error('QUOTE_SOURCE_CHANGED_REVIEW_REQUIRED');
 let result=replaceOnce(source,"if(!b||b.available===false||b.overUnder==null","if(!b||b.overUnder==null");
 result=replaceOnce(result,'line,odds,available:true,updatedAt:b.lastUpdatedAt??null','line,odds,available:b.available!==false,updatedAt:b.lastUpdatedAt??null');
 return result;
}
export function patchHostedQuoteDiagnosticsBundle(bundle){
 if(bundle?.slug!=='collect-nba-props'||bundle.version!==44||bundle.verify_jwt!==true||!Array.isArray(bundle.files))throw Error('HOSTED_BUNDLE_CHANGED_REVIEW_REQUIRED');
 if(bundle.files.some(f=>typeof f?.name!=='string'||typeof f?.content!=='string')||new Set(bundle.files.map(f=>f.name)).size!==bundle.files.length)throw Error('INVALID_HOSTED_FILES');
 const matches=bundle.files.filter(f=>f.name===quotePath);if(matches.length!==1)throw Error('QUOTE_FILE_NOT_UNIQUE');
 const source=matches[0].content,patched=patchQuoteDiagnosticsSource(source);
 return {slug:bundle.slug,verify_jwt:true,entrypoint_path:'supabase/functions/collect-nba-props/index.ts',files:bundle.files.map(f=>f.name===quotePath?{...f,content:patched}:{...f}),audit:{sourceVersion:44,sourceSha256:sha(source),patchedSha256:sha(patched),changedFiles:[quotePath],diagnosticsOnly:true,eligibilityRulesChanged:false,productionWeightChanged:false,forecastOrModelFilesChanged:false}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output]=process.argv.slice(2);
 if(!input||!output)throw Error('Usage: node scripts/nba/patch-hosted-quote-diagnostics.mjs INPUT_V44_EXPORT OUTPUT_BUNDLE');
 const result=patchHostedQuoteDiagnosticsBundle(JSON.parse(readFileSync(input,'utf8')));
 writeFileSync(output,JSON.stringify(result));console.log(JSON.stringify(result.audit,null,2));
}
