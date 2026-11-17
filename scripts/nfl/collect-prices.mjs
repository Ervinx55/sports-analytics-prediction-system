import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {captureNflPrices} from './price-capture-lib.mjs';
const arg=(key,fallback)=>process.argv.find(x=>x.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const input=arg('input',null);
const output=path.resolve(arg('output-dir','artifacts/nfl-price-capture'));
const base=arg('base-url','https://sports-analytics-prediction-system-tau.vercel.app');
const books=arg('books','draftkings,fanduel,betmgm,caesars,bovada,pinnacle');
let bytes,source;
if(input){bytes=fs.readFileSync(input);source={kind:'archive-import',path:path.resolve(input)};}
else{
  const url=new URL('/api/nflprops',base);
  if(url.protocol!=='https:') throw new Error('Hosted capture requires HTTPS');
  url.searchParams.set('books',books);url.searchParams.set('limit','20');
  const response=await fetch(url,{signal:AbortSignal.timeout(60000),headers:{accept:'application/json'}});
  if(!response.ok) throw new Error(`NFL capture HTTP ${response.status}`);
  bytes=Buffer.from(await response.arrayBuffer());source={kind:'live-http',url:url.toString(),status:response.status};
}
const receivedAt=new Date().toISOString();
const sourceHash=createHash('sha256').update(bytes).digest('hex');
const capture=captureNflPrices(JSON.parse(bytes.toString('utf8')),{receivedAt});
// An imported file is useful price research, but never backdates a new forecast receipt.
if(input) for(const row of capture.records){row.quoteEligible=false;row.validationBlocker='Imported archive; original pregame receipt provenance not established.';}
fs.mkdirSync(path.join(output,'raw'),{recursive:true});
const rawPath=path.join(output,'raw',`${sourceHash}.json`);
if(!fs.existsSync(rawPath)) fs.writeFileSync(rawPath,bytes,{flag:'wx'});
const ledger=path.join(output,'prices.jsonl');
const ids=new Set(fs.existsSync(ledger)?fs.readFileSync(ledger,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x).identity):[]);
let appended=0;
for(const row of capture.records){
  if(ids.has(row.identity)) continue;
  fs.appendFileSync(ledger,JSON.stringify({...row,sourceHash,captureSource:source})+'\n');ids.add(row.identity);appended++;
}
const report={receivedAt,source,sourceHash,observedPairs:capture.records.length,appended,rejected:capture.rejected,productionWeight:0,
  note:'Archive imports do not establish retrospective pregame receipt. Price capture does not authorize model influence.'};
fs.appendFileSync(path.join(output,'runs.jsonl'),JSON.stringify(report)+'\n');
console.log(JSON.stringify(report));
