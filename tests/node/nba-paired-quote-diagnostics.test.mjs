import test from 'node:test';
import assert from 'node:assert/strict';
import {directSgoProps} from '../../sharp-service/lib/nba-direct-props.js';
import {normalizeResearch} from '../../sharp-service/research-data.js';
import {readFileSync} from 'node:fs';
import {patchQuoteDiagnosticsSource,patchHostedQuoteDiagnosticsBundle,quotePath} from '../../scripts/nba/patch-hosted-quote-diagnostics.mjs';
const readinessSource=readFileSync(new URL('../fixtures/nba-quote-readiness-v44.txt',import.meta.url),'utf8');
const {describeQuoteReadiness}=await import('data:text/javascript;base64,'+Buffer.from(readinessSource).toString('base64'));

const at='2026-11-17T16:06:04.397Z',now=Date.parse(at);
const price=(extra={})=>({odds:'-110',overUnder:'2.5',available:true,lastUpdatedAt:'2026-11-17T16:06:01.378Z',...extra});
function event(opposites){
 const e={eventID:'fixture',leagueID:'NBA',type:'match',status:{startsAt:'2026-11-18T00:30:00Z'},teams:{home:{teamID:'HOME_NBA'},away:{teamID:'AWAY_NBA'}},players:{},odds:{}};
 for(const [i,under] of opposites.entries()){
  const playerID=`PLAYER_${i}_NBA`;e.players[playerID]={playerID,name:`Player ${i}`,teamID:'HOME_NBA'};
  for(const side of ['over','under']){
   const oddID=`assists-${playerID}-game-ou-${side}`;
   e.odds[oddID]={oddID,playerID,statEntityID:playerID,statID:'assists',sideID:side,periodID:'game',betTypeID:'ou',byBookmaker:side==='over'?{draftkings:price()}:under};
  }
 }
 return e;
}
const collect=async e=>directSgoProps({clock:()=>at,page:async()=>({events:[e],observedAt:at})});

test('six suspended opposite quotes survive normalization and two absent book prices stay absent',async()=>{
 const body=await collect(event([...Array.from({length:6},()=>({draftkings:price({available:false})})),{},{}]));
 const props=body.events[0].players.map(p=>p.prop);
 assert.equal(props.filter(p=>p.under?.books.draftkings.available===false).length,6);
 assert.equal(props.filter(p=>!p.under?.books.draftkings).length,2);
 const rows=normalizeResearch(body,'NBA',now);
 assert.equal(rows.length,14);
 assert.equal(rows.filter(r=>r.available===false).length,6);
 assert.ok(rows.every(r=>r.market===null&&r.model===null));
 assert.equal(rows.filter(r=>r.side==='OVER').length,8);
 const readiness=describeQuoteReadiness(body,rows.filter(r=>r.available!==false),now);
 assert.deepEqual(readiness.reasons,{OPPOSITE_QUOTE_UNAVAILABLE:6,OPPOSITE_QUOTE_MISSING:2});
 assert.equal(readiness.ready,0);assert.equal(readiness.blocked,8);
});

test('preserving suspended prices never makes stale, different-line or different-book pairs eligible',async()=>{
 const body=await collect(event([
  {draftkings:price({available:false})},
  {draftkings:price({lastUpdatedAt:'2026-11-17T15:55:00Z'})},
  {draftkings:price({overUnder:'3.5'})},
  {fanduel:price()},
  {draftkings:price({lastUpdatedAt:'2026-11-17T16:08:00Z'})}
 ]));
 const rows=normalizeResearch(body,'NBA',now);
 assert.equal(rows.filter(r=>r.side==='OVER').length,5);
 assert.ok(rows.every(r=>r.market===null));
});

test('fresh same-book same-line active pairs retain both sides and their original prices',async()=>{
 const body=await collect(event([{draftkings:price({odds:'+120'})}]));
 const rows=normalizeResearch(body,'NBA',now);
 assert.equal(rows.length,2);
 assert.deepEqual(rows.map(r=>[r.side,r.line,r.odds]),[['OVER',2.5,-110],['UNDER',2.5,120]]);
 assert.ok(rows.every(r=>Number.isFinite(r.market)));
 assert.ok(Math.abs(rows[0].market+rows[1].market-1)<1e-12);
});

test('exact hosted fallback patch changes diagnostics only and preserves all other bundle files',async()=>{
 const source=readFileSync(new URL('../fixtures/nba-direct-props-v44.txt',import.meta.url),'utf8');
 const bundle={slug:'collect-nba-props',version:44,verify_jwt:true,files:[{name:quotePath,content:source},{name:'scripts/local/nba-quote-readiness.mjs',content:readinessSource},{name:'frozen-model.json',content:'{"productionWeight":0}'}]};
 const before=structuredClone(bundle),patched=patchHostedQuoteDiagnosticsBundle(bundle);
 assert.deepEqual(bundle,before);
 assert.deepEqual(patched.files.slice(1),bundle.files.slice(1));
 assert.deepEqual(patched.audit.changedFiles,[quotePath]);
 const {directSgoProps:hosted}=await import('data:text/javascript;base64,'+Buffer.from(patched.files[0].content).toString('base64'));
 const body=await hosted({clock:()=>at,page:async()=>({events:[event([...Array.from({length:6},()=>({draftkings:price({available:false})})),{},{}])],observedAt:at})});
 const rows=normalizeResearch(body,'NBA',now),readiness=describeQuoteReadiness(body,rows.filter(r=>r.available!==false),now);
 assert.equal(rows.length,14);
 assert.equal(rows.filter(r=>r.available===false).length,6);assert.ok(rows.every(r=>r.market===null));
 assert.deepEqual(readiness.reasons,{OPPOSITE_QUOTE_UNAVAILABLE:6,OPPOSITE_QUOTE_MISSING:2});
 assert.equal(readiness.ready,0);
 assert.throws(()=>patchQuoteDiagnosticsSource(source+'\n'),/SOURCE_CHANGED/);
 assert.throws(()=>patchHostedQuoteDiagnosticsBundle({...bundle,version:45}),/BUNDLE_CHANGED/);
 assert.throws(()=>patchHostedQuoteDiagnosticsBundle({...bundle,verify_jwt:false}),/BUNDLE_CHANGED/);
 assert.throws(()=>patchHostedQuoteDiagnosticsBundle({...bundle,files:[...bundle.files,bundle.files[0]]}),/INVALID_HOSTED_FILES/);
});
