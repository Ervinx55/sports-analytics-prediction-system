// Source reconciliation shared by explanation and scenario analysis.
// This verifies recorded player identities and archived totals; it predicts nothing.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const minutes=x=>typeof x==='string'&&/^\d+:[0-5]\d$/.test(x)?Number(x.split(':')[0])+Number(x.split(':')[1])/60:NaN;
const before=(x,t)=>Number.isFinite(Date.parse(x))&&Date.parse(x)<=t;
const positions=new Set(['G','F','C','G-F','F-G','F-C','C-F','PG','SG','SF','PF']);
function officialRow(original,p,s){
 const a=s.backupEvidence?.officialBilateralAdjudication;
 if(!a)return original;
 let url;try{url=new URL(a.source);}catch{return original;}
 if(url.protocol!=='https:'||url.hostname!=='www.nba.com'||!/^\d{10}$/.test(a.officialGameID)||!url.pathname.includes('/'+a.officialGameID+'/')||![a.sourceSha256,a.sourceFingerprint,a.contract].every(x=>/^[a-f0-9]{64}$/.test(x))||a.originalProvidersPreserved!==true||'sgo:'+a.eventID!==s.id||a.bdlGameID!==s.backupEvidence.bdlGameID||Date.parse(a.startsAt)!==Date.parse(s.startsAt)||![a.home,a.away].includes(p.teamId))return original;
 const rows=(a.corrections||[]).filter(c=>c.provider==='BALLDONTLIE'&&c.playerID===original.player.id);
 const x={...original},seen=new Set();
 for(const c of rows){
  if(c.teamID!==p.teamId)return null;
  for(const [field,pair] of Object.entries(c.fields||{})){
   if(!['min','pts','reb','ast','fga','fta','turnover'].includes(field))continue;
   if(seen.has(field)||!Array.isArray(pair)||pair.length!==2||original[field]!==pair[0])return null;
   if(field==='min'?!finite(minutes(pair[1])):!Number.isInteger(pair[1])||pair[1]<0)return null;
   seen.add(field);x[field]=pair[1];
  }
 }
 return x;
}
export function verifiedArchivedPlayers(item,cutoff){
 const s=item.summary,b=s.backupEvidence,r=item.raw;
 if(!b||!r||r.id!==b.bdlGameID||r.status!=='Final'||!b.sourceSha256||b.sourceSha256!==item.archiveSha256||!before(b.retrievedAt,cutoff))return [];
 const raw=[...(r.home_team?.players||[]).map(p=>({...p,archiveSide:'home_team'})),...(r.visitor_team?.players||[]).map(p=>({...p,archiveSide:'visitor_team'}))];
 return (s.players||[]).flatMap(p=>{
  let mappings=(b.playerCrosswalk||[]).filter(x=>x.sgoPlayerID===p.id&&x.teamId===p.teamId);
  // Accepted backup summaries preserve provider-native IDs for players absent
  // from SGO's roster. Their numeric identity is already exact, not a name alias.
  if(!mappings.length&&s.sourceContract==='sgo-nba-bdl-backup-v1'&&/^bdl:[1-9]\d*$/.test(p.id)){
   const id=Number(p.id.slice(4)),rows=raw.filter(x=>x.player?.id===id);
   if(!Number.isSafeInteger(id)||rows.length!==1)return [];
   const side=rows[0].archiveSide;
   const anchors=(b.playerCrosswalk||[]).filter(c=>raw.some(x=>x.archiveSide===side&&x.player?.id===c.bdlPlayerID)&&s.players.some(x=>x.id===c.sgoPlayerID&&x.teamId===c.teamId));
   if(!anchors.length||anchors.some(c=>c.teamId!==p.teamId)||s.players.some(x=>x.id!==p.id&&(b.playerCrosswalk||[]).some(c=>c.sgoPlayerID===x.id&&c.bdlPlayerID===id)))return [];
   mappings=[{bdlPlayerID:id}];
  }
  if(mappings.length!==1)return [];
  const rows=raw.filter(x=>x.player?.id===mappings[0].bdlPlayerID);
  if(rows.length!==1)return [];
  const x=officialRow(rows[0],p,s);if(!x)return [];
  const m=minutes(x.min);
  if(!finite(m)||!finite(p.minutes)||Math.abs(p.minutes*60-Math.round(p.minutes*60))>1e-6||Math.abs(Math.round(m*60)-Math.round(p.minutes*60))>1||x.pts!==p.points||x.reb!==p.rebounds||x.ast!==p.assists)return [];
  return [{...p,archiveSide:x.archiveSide,position:positions.has(x.player.position)?x.player.position:null,fga:x.fga,fta:x.fta,tov:x.turnover}];
 });
}
