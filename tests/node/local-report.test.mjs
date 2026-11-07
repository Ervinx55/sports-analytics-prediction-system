import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {offlineReport} from '../../scripts/local/report.mjs';
test('offline report embeds escaped data and makes no network fetch',()=>{
 const report=offlineReport(readFileSync(new URL('../../scripts/local/tracker.html',import.meta.url),'utf8'),{name:'</script><img src=x>'});
 assert.doesNotMatch(report,/fetch\('/);assert.doesNotMatch(report,/<img src=x>/);assert.match(report,/\\u003c/);assert.match(report,/application\/json/);assert.match(report,/location.reload/);
});
