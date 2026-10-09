import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {freezeExperiment} from '../../scripts/performance/freeze-experiment.mjs';

const config=()=>({experimentId:'fixture-only',modelSource:'model v1',formulaSource:'p=.6',
 cohort:{sport:'NFL',modelMode:'SHADOW',selection:'last valid pregame exact market',probabilityBasis:'CONDITIONAL_NO_PUSH'},
 evaluationStart:'2099-01-01T00:00:00Z',baseline:{market:'paired contemporaneous no-vig',currentModel:'v0'},
 power:{minimumDistinctGames:200,alpha:.05,power:.8,minimumEffect:.01,assumptions:'game cluster bootstrap; planning estimate'},
 promotionCriteria:{pairedMetrics:['brier','logLoss'],acceptance:'beat market and current model with game-cluster uncertainty',missingDataPolicy:'exclude incomplete pairs',stoppingRule:'fixed 200 games'},
 previouslyExaminedHoldouts:['NBA-examined','NFL-examined'],
 eventGroups:[{sport:'NFL',eventKey:'g1',partition:'development',startsAt:'2026-01-01T00:00:00Z',snapshots:['s1','s2']},{sport:'NFL',eventKey:'g2',partition:'untouched',startsAt:'2099-01-02T00:00:00Z',snapshots:['s3'],previouslyExamined:false,outcomeKnownAt:null}]});
function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'freeze-test-'));try{return fn(join(dir,'protocol.json'));}finally{rmSync(dir,{recursive:true,force:true});}}
test('freeze writes hashed immutable protocol; second freeze cannot replace bytes',()=>fixture(path=>{
 const protocol=freezeExperiment(config(),path);const before=readFileSync(path,'utf8');
 assert.match(protocol.modelHash,/^[a-f0-9]{64}$/);assert.match(protocol.formulaHash,/^[a-f0-9]{64}$/);
 assert.equal(protocol.status,'FROZEN_NOT_VALIDATED');assert.equal(protocol.promotionAuthorized,false);
 assert.throws(()=>freezeExperiment(config(),path),/EEXIST/);assert.equal(readFileSync(path,'utf8'),before);
}));
test('missing acceptance, paired baseline, or sample assumptions fails',()=>{for(const key of ['promotionCriteria','baseline','power'])fixture(path=>{const c=config();delete c[key];assert.throws(()=>freezeExperiment(c,path),new RegExp(key));});});
test('untouched excludes pre-freeze outcomes, starts, and examined holdouts',()=>{for(const change of [{outcomeKnownAt:'2026-01-01T00:00:00Z'},{startsAt:'2026-01-01T00:00:00Z'},{previouslyExamined:true},{holdoutId:'NBA-examined'},{holdoutId:'NFL-examined'}])fixture(path=>{const c=config();Object.assign(c.eventGroups[1],change);assert.throws(()=>freezeExperiment(c,path),/untouched/);});});
test('repeated snapshots cannot cross canonical game partitions',()=>fixture(path=>{const c=config();c.eventGroups.push({...c.eventGroups[0],partition:'untouched',startsAt:'2099-01-02T00:00:00Z'});assert.throws(()=>freezeExperiment(c,path),/canonical game/);}));
test('chronology and snapshot identity cannot leak across partitions',()=>{fixture(path=>{const c=config();c.eventGroups[0].startsAt='2099-01-03T00:00:00Z';assert.throws(()=>freezeExperiment(c,path),/chronology/);});fixture(path=>{const c=config();c.eventGroups[1].snapshots=['s1'];assert.throws(()=>freezeExperiment(c,path),/snapshot/);});});
test('evaluation start must be future and timestamps explicit UTC',()=>{for(const date of ['2020-01-01T00:00:00Z','2099-01-01','garbage'])fixture(path=>{const c=config();c.evaluationStart=date;assert.throws(()=>freezeExperiment(c,path),/evaluationStart/);});});
test('invalid calendar dates and string power assumptions cannot silently normalize',()=>{fixture(path=>{const c=config();c.evaluationStart='2099-02-30T00:00:00Z';c.eventGroups[1].startsAt='2099-03-05T00:00:00Z';assert.throws(()=>freezeExperiment(c,path),/evaluationStart/);});fixture(path=>{const c=config();c.power.alpha='0.05';assert.throws(()=>freezeExperiment(c,path),/power/);});});
