import {appendDeepDive} from './deep-dive.js';
export function decisionPresentation(row={}, data={}, now=Date.now()) {
 const valid=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=now?v:null;
 const issuedAt=valid(row.issuedAt)||valid(row.decisionAt);
 const evaluatedAt=valid(row.forecastAt)||valid(data.forecastAt);
 const fresh=evaluatedAt!==null&&now-Date.parse(evaluatedAt)<=600000;
 const cleared=row.status==='PLAY'&&row.productionEligible===true&&data.productionEligible!==false&&row.productionWeight>0&&fresh;
 const disabled=row.productionEligible===false||data.productionEligible===false||row.productionWeight===0;
 const sourceReason=typeof row.reason==='string'&&row.reason.trim()?row.reason.trim():null;
 const kind=cleared?'play':row.status==='PASS'?'pass':'unavailable';
 return {kind,issuedAt,evaluatedAt,sourceReason,
 title:cleared?'PLAY — cleared':kind==='pass'?'PASS — do not play':'NOT CLEARED — do not play',
 reason:cleared?'Explicit production clearance. Check the exact book, line and current price.':disabled?'Production use is disabled for this model. '+(row.shadowStatus==='PLAY'?'The research threshold is met, but this is not a cleared bet.':'A research estimate cannot authorize a bet.'):kind==='pass'?'The production model passed on this market. A research signal is not permission to play.':'No production clearance is available for this market.',
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
 }
 if(d.sourceReason&&d.kind!=='play'){const reason=document.createElement('p');reason.textContent='Model reason: '+d.sourceReason;box.append(reason);}
 parent.append(box);
 appendDeepDive(parent,row,{presentation:d,scope:"nba-team"});
}
