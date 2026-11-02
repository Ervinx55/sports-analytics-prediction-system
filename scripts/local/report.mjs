/** File-openable report: no network, credentials, or local server required. */
export function offlineReport(template,report){
 const json=JSON.stringify(report).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
 return template.replace('<script>','<script id="snapshot" type="application/json">'+json+'</script><script>')
  .replace("const r=await fetch('/api/status');","const r={ok:true,json:async()=>JSON.parse(document.getElementById('snapshot').textContent)};")
  .replace('Refresh saved results','Reload report file')
  .replace("el('refresh').onclick=refresh;refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);","el('refresh').onclick=()=>location.reload();refresh();")
  .replace('This page reads local data only; refreshing it does not request new provider data.','Offline snapshot. Reload this file after a collection cycle to see updated results.');
}
