import test from 'node:test';
import assert from 'node:assert/strict';
import {trackerHealth} from '../../scripts/local/report.mjs';
const now=Date.parse('2026-11-03T12:00:00Z');
const report={lastRun:{state:'COMPLETE',finishedAt:'2026-11-03T11:59:00Z'},process:{running:false,nextRunAt:'2026-11-03T12:14:00Z'}};
test('offline snapshots never claim a live worker',()=>{
 assert.match(trackerHealth(report,now,true),/Snapshot/);
 assert.match(trackerHealth(report,now+3600000,true),/Stale/);
});
test('stopped, collecting and failed worker states are explicit',()=>{
 assert.match(trackerHealth({...report,process:{stopping:true}},now),/Stopped/);
 assert.match(trackerHealth({...report,process:{running:true}},now),/Collecting/);
 assert.match(trackerHealth({...report,lastRun:{...report.lastRun,state:'FAILED'}},now),/attention/);
 assert.match(trackerHealth(report,now+3600000),/Stale/);
});
