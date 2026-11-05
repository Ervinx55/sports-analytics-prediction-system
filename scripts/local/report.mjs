/** File-openable report: no network, credentials, or local server required. */
export function trackerHealth(report,now=Date.now(),snapshot=false){
 const process=report.process??{},run=report.lastRun??{};
 if(process.stopping)return 'Stopped - restart collection when ready';
 const stamp=Date.parse(run.finishedAt??run.startedAt);
 if(!Number.isFinite(stamp))return 'Not started - no collection recorded';
 if(now-stamp>30*60000)return 'Stale - no recent collection; check the tracker';
 if(snapshot)return 'Snapshot only - live worker status is not checked';
 if(process.running)return 'Collecting now';
 if(run.state==='FAILED'||run.state==='PARTIAL')return 'Needs attention - last collection had source errors';
 return process.nextRunAt?'Waiting for next collection':'Idle - no next collection scheduled';
}
export function liveReport(template){return template.replace('/* TRACKER_HEALTH */',trackerHealth.toString());}
export function offlineReport(template,report){
 const json=JSON.stringify(report).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
 return liveReport(template).replace('<script>','<script id="snapshot" type="application/json">'+json+'</script><script>')
  .replace("const r=await fetch('/api/status');","const r={ok:true,json:async()=>JSON.parse(document.getElementById('snapshot').textContent)};")
  .replace('Refresh saved results','Reload report file')
  .replace("el('refresh').onclick=refresh;refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);","el('refresh').onclick=()=>location.reload();refresh();")
  .replace('This page reads local data only; refreshing it does not request new provider data.','Offline snapshot. Reload this file after a collection cycle to see updated results.');
}
