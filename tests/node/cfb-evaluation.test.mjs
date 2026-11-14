import test from 'node:test';import assert from 'node:assert/strict';
import {evaluateCandidates,CFB_MANIFEST,contentHash} from '../../sharp-service/lib/cfb-evaluation.js';
test('CFB evidence hashing survives JSONB object-key ordering',()=>{assert.equal(contentHash({a:1,b:{x:2,y:3}}),contentHash({b:{y:3,x:2},a:1}));});
test('CFB evaluation does not select on the holdout and refuses incomplete evidence',()=>{
 const games=[];for(const season of [2024,2025,2026])for(let i=0;i<12;i++)games.push({id:`${season}-${i}`,season,startsAt:`${season}-09-${String(i+1).padStart(2,'0')}T17:00:00Z`,homeID:'a',awayID:'b',homeScore:20,awayScore:10,completed:true,fbsVerified:true,neutralSite:false});
 const source={complete:true,games,membership:{2024:['a','b'],2025:['a','b'],2026:['a','b']}};
 const a=evaluateCandidates(source),b=evaluateCandidates({...source,games:games.map(g=>g.season===2026?{...g,homeScore:0,awayScore:100}:g)});
 assert.deepEqual(a.config,b.config);assert.equal(a.modelVersion,b.modelVersion);assert.equal(a.productionEligible,false);assert.equal(a.holdout.n,12);assert.notEqual(a.holdout.brier,b.holdout.brier);
 assert.equal(evaluateCandidates({...source,complete:false}).status,'BLOCKED');
 assert.equal(CFB_MANIFEST.grid.length,18);
});
