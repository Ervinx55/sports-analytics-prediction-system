import {createHash} from 'node:crypto';
import {writeFileSync, readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const hash=value=>createHash('sha256').update(value).digest('hex');
const requireText=(value,name)=>{if(typeof value!=='string'||!value.trim())throw Error(`${name} is required`);};
function utc(value,name){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error(`${name} must be an explicit UTC timestamp`);const time=Date.parse(value);if(new Date(time).toISOString()!==value.replace(/(?<=\d\d)Z$/,'.000Z')&&!value.includes('.'))throw Error(`${name} has an invalid calendar date`);if(value.includes('.')&&new Date(time).toISOString()!==value)throw Error(`${name} has an invalid calendar date`);return time;}

// Exclusive file creation prevents concurrent writers or retries replacing a protocol.
// This is an append-only workflow guarantee, not filesystem administrator protection.
export function freezeExperiment(config,outputPath){
 const c=JSON.parse(JSON.stringify(config)),frozenAt=new Date().toISOString(),freeze=Date.parse(frozenAt);
 // This derived field must never enter its own digest, even in copied inputs.
 delete c.protocolHash;
 for(const name of ['experimentId','modelSource','formulaSource'])requireText(c[name],name);
 for(const name of ['sport','modelMode','selection','probabilityBasis'])requireText(c.cohort?.[name],`cohort.${name}`);
 if(!['LIVE','SHADOW'].includes(c.cohort.modelMode))throw Error('cohort.modelMode invalid');
 const start=utc(c.evaluationStart,'evaluationStart');if(start<=freeze)throw Error('evaluationStart must follow freeze');
 for(const name of ['market','currentModel'])requireText(c.baseline?.[name],`baseline.${name}`);
 const p=c.power;
 if(!p||!Number.isInteger(p.minimumDistinctGames)||p.minimumDistinctGames<2||!Number.isFinite(p.alpha)||!(p.alpha>0&&p.alpha<1)||!Number.isFinite(p.power)||!(p.power>0&&p.power<1)||!Number.isFinite(p.minimumEffect)||p.minimumEffect<=0)throw Error('power requires positive game sample, effect, alpha and power');
 requireText(p.assumptions,'power.assumptions');
 const criteria=c.promotionCriteria;
 if(!criteria||!Array.isArray(criteria.pairedMetrics)||!['brier','logLoss'].every(m=>criteria.pairedMetrics.includes(m)))throw Error('promotionCriteria requires paired brier and logLoss');
 for(const name of ['acceptance','missingDataPolicy','stoppingRule'])requireText(criteria[name],`promotionCriteria.${name}`);
 if(!Array.isArray(c.previouslyExaminedHoldouts)||c.previouslyExaminedHoldouts.some(x=>typeof x!=='string'||!x.trim()))throw Error('previouslyExaminedHoldouts inventory required');
 if(!Array.isArray(c.eventGroups)||!c.eventGroups.length)throw Error('eventGroups required');
 const games=new Map(),snapshots=new Map(),ranges=new Map(),order=['development','validation','untouched'];
 let untouched=0;
 for(const group of c.eventGroups){
  for(const name of ['sport','eventKey'])requireText(group[name],`eventGroups.${name}`);
  if(!order.includes(group.partition))throw Error('partition must be development, validation or untouched');
  const key=JSON.stringify([group.sport,group.eventKey]);if(games.has(key))throw Error('canonical game must occur once with all repeated snapshots');games.set(key,group.partition);
  const time=utc(group.startsAt,'eventGroups.startsAt');
  if(!Array.isArray(group.snapshots)||!group.snapshots.length)throw Error('snapshot inventory required');
  for(const snapshot of group.snapshots){requireText(snapshot,'snapshot');if(snapshots.has(snapshot))throw Error('snapshot identity repeated across event groups');snapshots.set(snapshot,key);}
  if(group.outcomeKnownAt!=null)utc(group.outcomeKnownAt,'outcomeKnownAt');
  if(group.partition==='untouched'){
   untouched++;
   if(time<start||time<=freeze||group.previouslyExamined!==false||group.outcomeKnownAt!=null||c.previouslyExaminedHoldouts.includes(group.holdoutId))throw Error('untouched requires future events, no known outcomes and no previously examined holdout');
  }
  const range=ranges.get(group.partition)??[time,time];ranges.set(group.partition,[Math.min(range[0],time),Math.max(range[1],time)]);
 }
 if(!untouched)throw Error('untouched future event group required');
 let previous=-Infinity;for(const partition of order){const range=ranges.get(partition);if(range){if(range[0]<=previous)throw Error('event-group chronology overlaps partitions');previous=range[1];}}
 const protocol={...c,schemaVersion:1,frozenAt,modelHash:hash(c.modelSource),formulaHash:hash(c.formulaSource),status:'FROZEN_NOT_VALIDATED',promotionAuthorized:false};
 protocol.protocolHash=hash(JSON.stringify(protocol));
 writeFileSync(outputPath,JSON.stringify(protocol,null,2)+'\n',{flag:'wx',mode:0o444});
 return protocol;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==4)throw Error('Usage: node scripts/performance/freeze-experiment.mjs config.json new-protocol.json');
 const protocol=freezeExperiment(JSON.parse(readFileSync(process.argv[2],'utf8')),process.argv[3]);
 console.log(`Frozen ${protocol.experimentId}: ${protocol.protocolHash}; no promotion authorized.`);
}
