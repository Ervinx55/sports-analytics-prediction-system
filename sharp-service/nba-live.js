import {appendDeepDive,preserveDeepDives} from './deep-dive.js';
const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const playerKey=row=>text(row?.eventID)&&text(row?.playerID)&&Number.isFinite(Date.parse(row?.startsAt))?JSON.stringify([row.eventID,Date.parse(row.startsAt),row.playerID]):null;
let quoteNames=new Map(),repaint=()=>{};

// Names only, from the default quote request that nba.html already made.
// Nothing in this index participates in probability, approval or price checks.
export function setNbaQuoteNames(body,now=Date.now()){
 const candidates=new Map(),at=Date.parse(body?.generatedAt);
 if(body?.source==='SportsGameOdds'&&Number.isFinite(at)&&at<=now&&Array.isArray(body.events)&&body.events.length<=32){
  let records=0;
  for(const event of body.events)for(const player of Array.isArray(event?.players)?event.players:[]){
   if(++records>5000){candidates.clear();break;}
   const prop=player?.prop,binding=player?.explanationBinding,key=playerKey({...event,playerID:prop?.playerID}),name=text(prop?.playerName);
   if(event.provider!=='SportsGameOdds'||Date.parse(event.startsAt)<=now||!key||!name||name===prop.playerID||prop.identityStatus!=='PROVIDER_ROSTER_MATCHED'||
    (player.propReadiness&&player.propReadiness.identityStatus!=='PROVIDER_ROSTER_MATCHED')||binding?.contract!=='sgo-event-roster-v1'||binding.eventID!==event.eventID||binding.playerID!==prop.playerID||Date.parse(binding.startsAt)!==Date.parse(event.startsAt)||
    ![binding.teamId,binding.opponentTeamId].every(id=>typeof id==='string'&&id.endsWith('_NBA'))||binding.teamId===binding.opponentTeamId)continue;
   if(!candidates.has(key))candidates.set(key,new Set());candidates.get(key).add(name);
  }
 }
 quoteNames=new Map([...candidates].filter(([,names])=>names.size===1).map(([key,names])=>[key,{name:[...names][0],observedAt:body.generatedAt}]));
 repaint();return quoteNames.size;
}

export function isCurrentPlay(row,data,now=Date.now()){
 const stamp=Date.parse(data?.generatedAt),issued=Date.parse(row?.issuedAt),expires=Date.parse(row?.validUntil),start=Date.parse(row?.startsAt);
 const probability=value=>finite(value)&&value>=0&&value<=1;
 const current=value=>typeof value==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now&&now-Date.parse(value)<600000;
 const prices=[row?.odds,row?.oppositeOdds].every(value=>finite(value)&&Math.abs(value)>=100);
 const implied=odds=>odds>0?100/(odds+100):-odds/(-odds+100);
 // Recheck the supplied publisher contract, including its ten-minute price /
 // forecast window and 1e-6 paired-price tolerance. Never fill in missing odds
 // or probabilities, or treat this consistency check as model approval.
 const pairMatches=prices&&probability(row?.marketProbability)&&Math.abs(row.marketProbability-implied(row.odds)/(implied(row.odds)+implied(row.oppositeOdds)))<1e-6;
 return data?.contract==='nba-reviewed-live-v1'&&row?.contract==='nba-reviewed-live-v1'&&row.status==='PLAY'&&row.productionEligible===true&&row.productionWeight===1&&Boolean(text(row.approvalId))&&(row.reasons===undefined||(Array.isArray(row.reasons)&&row.reasons.length===0))&&Number.isFinite(stamp)&&stamp<=now&&now-stamp<30000&&issued<=now&&now-issued<600000&&expires>now&&start>now&&probability(row.modelProbability)&&pairMatches&&[row.forecastAt,row.quoteAt,row.oppositeQuoteAt].every(current)&&Date.parse(row.forecastAt)<start;
}
function quoteKey(row){
 const scope=row.marketScope??row.market_scope??null,side=text(row.side)?.toUpperCase();
 if(!playerKey(row)||!text(row.market)||!['OVER','UNDER'].includes(side)||!finite(row.line)||row.line<0||!text(row.book)||!finite(row.odds)||Math.abs(row.odds)<100||(scope!==null&&!text(scope)))return null;
 return JSON.stringify([row.eventID,Date.parse(row.startsAt),row.playerID,row.market,scope,side,row.line,row.book,row.odds]);
}
export function groupLiveDecisions(data,now=Date.now()){
 const grouped=new Map(),rows=Array.isArray(data?.decisions)?data.decisions:[];
 for(const [index,row] of rows.entries()){
  if(!row||typeof row!=='object')continue;
  const exact=quoteKey(row),key=exact??'unverified:'+index;
  if(!grouped.has(key))grouped.set(key,{key,exact:Boolean(exact),rows:[],latest:[],current:new Set(),conflicting:false});
  grouped.get(key).rows.push(row);
 }
 for(const group of grouped.values()){
  const models=new Map();
  for(const row of group.rows){const key=text(row.modelHash);if(!models.has(key))models.set(key,[]);models.get(key).push(row);}
  for(const [model,records] of models){
   const stamps=records.map(row=>Date.parse(row.issuedAt));
   if(!model||stamps.some(at=>!Number.isFinite(at))){group.latest.push(...records);continue;}
   const latest=records.filter((_,index)=>stamps[index]===Math.max(...stamps));group.latest.push(...latest);
   // A tie with contradictory decision facts cannot be resolved by row order.
   const signatures=new Set(latest.map(row=>JSON.stringify([row.status,row.productionEligible,row.productionWeight,row.approvalId,row.forecastAt,row.validUntil,row.quoteAt,row.oppositeQuoteAt,row.oppositeOdds,row.modelProbability,row.marketProbability,row.reasons])));
   if(signatures.size>1){group.conflicting=true;continue;}
   if(group.exact&&latest.every(row=>isCurrentPlay(row,data,now)))for(const row of latest)group.current.add(row);
  }
  if(group.conflicting)group.current.clear();
 }
 return [...grouped.values()].sort((a,b)=>Number(b.current.size>0)-Number(a.current.size>0));
}
if(typeof document!=='undefined'){
 const section=document.createElement('section');section.className='notice';section.setAttribute('aria-label','NBA prop decisions');
 const title=document.createElement('h2');title.textContent='NBA prop decisions';section.append(title);
 const status=document.createElement('p');status.setAttribute('role','status');section.append(status);
 const list=document.createElement('div');list.className='cards';section.append(list);(document.querySelector('main')||document.querySelector('.app')||document.body).prepend(section);
 let data=null,controller=null;const expanded=new Set();
 const percent=x=>finite(x)&&x>=0&&x<=1?(100*x).toFixed(1)+'%':'Unavailable';
 const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'Not recorded';
 const add=(parent,tag,value)=>{const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;};
 const modelName=row=>({'nba-minutes-paired-2026-11-10-v1':'Minutes model','nba-prospective-bilateral-2026-11-09-v4':'Baseline model'}[row.validationProtocol]||'Model '+(text(row.modelHash)?.slice(0,12)||'identity unavailable'));
 function render(){
  const active=document.activeElement,focused=active?.parentElement?.hasAttribute?.('data-nba-evaluation')&&list.contains(active)?active.parentElement.getAttribute('data-nba-evaluation'):null;
  for(const element of list.querySelectorAll?.('[data-nba-evaluation]')??[]){const key=element.getAttribute('data-nba-evaluation');if(element.open)expanded.add(key);else expanded.delete(key);}
  preserveDeepDives(list);list.replaceChildren();const rows=data?.decisions??[],groups=groupLiveDecisions(data),buys=groups.filter(group=>group.current.size>0),shown=groups.slice(0,20);
  status.textContent=!data?'Live decision verification unavailable. No BUY cleared.':`${buys.length} BUY · ${groups.length-buys.length} AVOID · ${groups.length} returned quote selections from ${rows.length} model evaluation records. Showing ${shown.length} selections. Service clearance is rechecked every 15 seconds; research estimates do not authorize a bet.`;
  if(data&&!rows.length)status.textContent='No live model evaluation records were returned. No BUY cleared.';
  for(const group of shown){
   const r=group.rows[0],clear=group.current.size>0,lookup=quoteNames.get(playerKey(r));
   const suppliedNames=new Set(group.rows.map(row=>text(row.playerName)).filter(name=>name&&name!==r.playerID)),allNames=new Set([...suppliedNames,...(lookup?[lookup.name]:[])]);
   const playerName=allNames.size===1?[...allNames][0]:null;
   const card=document.createElement('article');card.className='card';
   add(card,'h3',(clear?'BUY — cleared: ':'AVOID — not cleared: ')+(playerName||'Player name unavailable'));
   add(card,'p',`Provider player ID: ${text(r.playerID)||'Unavailable'} · Event: ${text(r.eventID)||'Unavailable'} · Starts ${date(r.startsAt)}`);
   add(card,'p',`${text(r.side)||'Side unavailable'} ${finite(r.line)?r.line:'Line unavailable'} ${text(r.market)||'Market unavailable'} · ${text(r.book)||'Book unavailable'} · odds ${finite(r.odds)&&Math.abs(r.odds)>=100?(r.odds>0?'+':'')+r.odds:'Unavailable'}`);
   if(playerName&&suppliedNames.size===0)add(card,'p',`Name source: SportsGameOdds event roster observed ${date(lookup.observedAt)}. Name matching does not establish player availability.`);
   const explanation=clear?'The service returned a current approval-backed PLAY for this exact quote. Recheck the price before acting.':group.conflicting?'Conflicting model records prevent current clearance. Research evaluations are retained below.':'No current production clearance. '+[...new Set(group.latest.map(row=>text(row.reason)).filter(Boolean))].join(' ');
   add(card,'p',explanation);
   for(const record of group.rows){
    const current=group.current.has(record),key=JSON.stringify([group.key,record.modelHash,record.decisionId,record.issuedAt]);
    const detail=document.createElement('details');detail.setAttribute('data-nba-evaluation',key);detail.open=expanded.has(key);card.append(detail);
    add(detail,'summary',`${current?'Cleared evaluation':'Research evaluation'} · ${modelName(record)} · service ${text(record.status)||'status unavailable'}`);
    add(detail,'p',`${current?'Approved model estimate':'Research estimate (no current production clearance)'}: ${percent(record.modelProbability)} · Recorded market no-vig estimate: ${percent(record.marketProbability)}`);
    add(detail,'p',`Service decision status: ${text(record.status)||'Unavailable'} · Decision recorded: ${date(record.issuedAt)} · Valid until ${date(record.validUntil)}`);
    add(detail,'p',`Model identifier: ${text(record.modelHash)||'Unavailable'} · Protocol: ${text(record.validationProtocol)||'Unavailable'}`);
    if(text(record.reason))add(detail,'p',record.reason);
    appendDeepDive(detail,record,{scope:'nba-live:'+key,presentation:{title:current?'PLAY — cleared':'NOT CLEARED — research evaluation',reason:current?explanation:'Research estimate only; no current production clearance. '+(record.reason||'')}});
   }
   list.append(card);
  }
  if(focused)for(const detail of list.querySelectorAll('[data-nba-evaluation]'))if(detail.getAttribute('data-nba-evaluation')===focused){detail.querySelector('summary')?.focus({preventScroll:true});break;}
 }
 async function refresh(){controller?.abort();const current=new AbortController();controller=current;const timer=setTimeout(()=>current.abort(),12000);
  try{const r=await fetch('/api/dashboard?nbaLive=1',{cache:'no-store',signal:current.signal});const b=await r.json();if(!r.ok||b.contract!=='nba-reviewed-live-v1'||!Array.isArray(b.decisions))throw Error('Unavailable');if(controller===current)data=b;}
  catch{if(controller===current)data=null;}finally{clearTimeout(timer);if(controller===current)render();}
 }
 repaint=render;refresh();setInterval(refresh,15000);setInterval(render,1000);
}
