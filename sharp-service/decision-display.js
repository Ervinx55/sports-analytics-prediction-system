export function decisionPresentation(row={}, data={}, now=Date.now()) {
 const valid=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=now?v:null;
 const issuedAt=valid(row.issuedAt)||valid(row.decisionAt);
 const evaluatedAt=valid(row.forecastAt)||valid(data.forecastAt);
 const fresh=evaluatedAt!==null&&now-Date.parse(evaluatedAt)<=600000;
 const cleared=row.status==='PLAY'&&row.productionEligible===true&&data.productionEligible!==false&&row.productionWeight>0&&fresh;
 const kind=cleared?'play':row.status==='PASS'?'pass':'unavailable';
 return {kind,issuedAt,evaluatedAt,
 title:cleared?'PLAY — cleared':kind==='pass'?'PASS — do not play':'NOT CLEARED — do not play',
 reason:cleared?'Explicit production clearance. Check the exact book, line and current price.':kind==='pass'?'The production model passed on this market. A research signal is not permission to play.':'No production clearance is available for this market.',
 stale:evaluatedAt!==null&&!fresh};
}
export function decisionTime(value) {
 return value?new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(value)):'Not recorded';
}
export function appendDecision(parent,row,data) {
 const d=decisionPresentation(row,data);
 const box=document.createElement('section');box.className='decision-callout decision-'+d.kind;
 for(const [tag,text] of [['strong',d.title],['p',d.reason],['p','Decision recorded: '+decisionTime(d.issuedAt)],['p','Model evaluated: '+decisionTime(d.evaluatedAt)+(d.stale?' (STALE)':'')]]) {
 const node=document.createElement(tag);node.textContent=text;box.append(node);
 } parent.append(box);
}
