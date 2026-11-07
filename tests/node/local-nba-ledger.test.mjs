import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLocalLedger} from '../../scripts/local/nba-ledger.mjs';
const now='2026-11-02T18:00:00Z';
const p={sourceKey:'original',sport:'NBA',modelMode:'SHADOW',modelVersion:'test',eventKey:'nba:1',startsAt:'2026-11-02T20:00:00Z',eligibilityStartsAt:'2026-11-02T20:00:00Z',capturedAt:now,modelProbability:.6,marketProbability:.5,marketType:'moneyline',side:'home',book:'test',line:null,sourceIds:{event:'1'},provenance:{receivedAt:now,productionWeight:0,raw:{home:'Home',away:'Away',shadowStatus:'PLAY'}}};
test('local capture preserves first forecast across restart, rejects late captures and persists cooldown',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'edge-local-'));let r;
 try{r=openLocalLedger(join(dir,'ledger.sqlite'),{clock:()=>now});assert.equal(await r.capture(p),true);assert.equal(await r.capture({...p,modelProbability:.9}),false);await r.cool('espn',600);r.close();
 r=openLocalLedger(join(dir,'ledger.sqlite'),{clock:()=>now});assert.equal(r.report().rows[0].prediction.modelProbability,.6);assert.equal(await r.cooldown('espn'),true);
 assert.equal(await r.capture({...p,startsAt:now,eligibilityStartsAt:now,sourceIds:{event:'late'}}),false);
 assert.throws(()=>r.importArchive([{...p,provenance:{productionWeight:1}}]),/Invalid/);
 }finally{r?.close();rmSync(dir,{recursive:true,force:true});}
});
test('archive import retains historical receipt and outcomes remain research-only and immutable',async()=>{
 const r=openLocalLedger(':memory:',{clock:()=> '2026-11-03T01:00:00Z'});
 try{assert.equal(r.importArchive([p]),1);const row=(await r.pending())[0];assert.equal(row.provenance.receivedAt,now);assert.equal(row.capturedAt,now);
 assert.equal(await r.settle({predictionId:row.id,outcome:'WIN',reason:'RESEARCH_DIRECTION_ONLY',researchOnly:true}),true);
 assert.equal(await r.settle({predictionId:row.id,outcome:'LOSS',reason:'RESEARCH_DIRECTION_ONLY',researchOnly:true}),false);
 assert.equal(r.report().summary.wins,1);assert.equal(r.report().summary.qualifiedPlays,0);assert.equal(r.report().summary.roi,null);assert.equal((await r.pending()).length,0);
 }finally{r.close();}
});
