import {displayPlayerName} from './ui-format.js';

const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export const playerKey=row=>text(row?.eventID)&&text(row?.playerID)&&Number.isFinite(Date.parse(row?.startsAt))?JSON.stringify([row.eventID,Date.parse(row.startsAt),row.playerID]):null;
export const scopeOf=row=>text(row.marketScope??row.market_scope??row.periodID??row.period)??'game';
let quoteNames=new Map(),repaint=()=>{};

// Reuse event-bound metadata already requested by nba.html. Display names and
// matchup labels never participate in probability, price or approval checks.
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
   if(!candidates.has(key))candidates.set(key,[]);
   candidates.get(key).push({name,away:text(event.matchup?.away?.name),home:text(event.matchup?.home?.name)});
  }
 }
 quoteNames=new Map([...candidates].filter(([,rows])=>new Set(rows.map(r=>r.name)).size===1).map(([key,rows])=>[key,{...rows[0],observedAt:body.generatedAt}]));
 repaint();return quoteNames.size;
}

export function isCurrentPlay(row,data,now=Date.now()){
 const stamp=Date.parse(data?.generatedAt),issued=Date.parse(row?.issuedAt),expires=Date.parse(row?.validUntil),start=Date.parse(row?.startsAt);
 const probability=value=>finite(value)&&value>=0&&value<=1;
 const current=value=>typeof value==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now&&now-Date.parse(value)<600000;
 const prices=[row?.odds,row?.oppositeOdds].every(value=>finite(value)&&Math.abs(value)>=100);
 const implied=odds=>odds>0?100/(odds+100):-odds/(-odds+100);
 // Preserve the publisher's approval, ten-minute paired-price/forecast window
 // and 30-second verification requirement. Display cleanup never clears bets.
 const pairMatches=prices&&probability(row?.marketProbability)&&Math.abs(row.marketProbability-implied(row.odds)/(implied(row.odds)+implied(row.oppositeOdds)))<1e-6;
 return data?.contract==='nba-reviewed-live-v1'&&row?.contract==='nba-reviewed-live-v1'&&row.status==='PLAY'&&row.productionEligible===true&&row.productionWeight===1&&Boolean(text(row.approvalId))&&(row.reasons===undefined||(Array.isArray(row.reasons)&&row.reasons.length===0))&&Number.isFinite(stamp)&&stamp<=now&&now-stamp<30000&&issued<=now&&now-issued<600000&&expires>now&&start>now&&probability(row.modelProbability)&&pairMatches&&[row.forecastAt,row.quoteAt,row.oppositeQuoteAt].every(current)&&Date.parse(row.forecastAt)<start&&row.available!==false;
}
function quoteKey(row){
 const side=text(row.side)?.toUpperCase(),scope=row.marketScope??row.market_scope??row.periodID??row.period??null;
 if(!playerKey(row)||!text(row.market)||!['OVER','UNDER'].includes(side)||!finite(row.line)||row.line<0||!text(row.book)||(scope!==null&&!text(scope)))return null;
 // Price is an observation, not selection identity. A price update must replace
 // the old snapshot rather than create another apparent play.
 return JSON.stringify([row.sport??'NBA',row.eventID,Date.parse(row.startsAt),row.playerID,row.market,scopeOf(row),side,row.line,row.book]);
}
const decisionSignature=row=>JSON.stringify([row.status,row.available,row.odds,row.oppositeOdds,row.productionEligible,row.productionWeight,row.approvalId,row.forecastAt,row.validUntil,row.quoteAt,row.oppositeQuoteAt,row.modelProbability,row.marketProbability,row.reasons]);
export function groupLiveDecisions(data,now=Date.now()){
 const grouped=new Map(),rows=Array.isArray(data?.decisions)?data.decisions:[];
 for(const [index,row] of rows.entries()){
  if(!row||typeof row!=='object'||Array.isArray(row))continue;
  const exact=quoteKey(row),key=exact??'unverified:'+index;
  if(!grouped.has(key))grouped.set(key,{key,exact:Boolean(exact),rows:[],latest:[],current:new Set(),conflicting:false,seen:new Set()});
  const group=grouped.get(key),signature=JSON.stringify(row);
  if(!group.seen.has(signature)){group.seen.add(signature);group.rows.push(row);}
 }
 for(const group of grouped.values()){
  delete group.seen;
  const models=new Map();
  for(const [index,row] of group.rows.entries()){
   const key=text(row.modelHash)?JSON.stringify([row.modelHash,row.validationProtocol??null]):'unknown:'+index;
   if(!models.has(key))models.set(key,[]);models.get(key).push(row);
  }
  const quoteTimes=group.rows.map(row=>Date.parse(row.quoteAt)).filter(at=>Number.isFinite(at));
  const newestQuote=quoteTimes.length?Math.max(...quoteTimes):NaN;
  const newestPrices=group.rows.filter(row=>Date.parse(row.quoteAt)===newestQuote);
  if(new Set(newestPrices.map(row=>JSON.stringify([row.odds,row.oppositeOdds,row.available===false]))).size>1)group.conflicting=true;
  for(const [model,records] of models){
   const stamps=records.map(row=>Date.parse(row.issuedAt));
   if(model.startsWith('unknown:')||stamps.some(at=>!Number.isFinite(at))){group.latest.push(...records);continue;}
   const latest=records.filter((_,index)=>stamps[index]===Math.max(...stamps));group.latest.push(...latest);
   if(new Set(latest.map(decisionSignature)).size>1){group.conflicting=true;continue;}
   if(group.exact&&latest.every(row=>Date.parse(row.quoteAt)===newestQuote&&isCurrentPlay(row,data,now)))for(const row of latest)group.current.add(row);
  }
  if(group.conflicting)group.current.clear();
  group.latest.sort((a,b)=>(Date.parse(b.issuedAt)||0)-(Date.parse(a.issuedAt)||0));
  // A later model run cannot make its older price outrank a new withdrawal.
  group.representative=[...newestPrices].sort((a,b)=>Number(b.available===false)-Number(a.available===false)||(Date.parse(b.issuedAt)||0)-(Date.parse(a.issuedAt)||0))[0]??group.latest[0]??group.rows[0];
  const verified=Date.parse(data?.generatedAt)<=now&&now-Date.parse(data?.generatedAt)<30000;
  const active=group.latest.filter(row=>Date.parse(row.issuedAt)<=now&&Date.parse(row.validUntil)>now&&Date.parse(row.startsAt)>now);
  group.status=group.current.size?'BUY':group.exact&&!group.conflicting&&verified&&active.length&&active.every(row=>row.status==='PASS')?'AVOID':'UNVERIFIED';
 }
 return [...grouped.values()].sort((a,b)=>Number(b.current.size>0)-Number(a.current.size>0));
}

export function groupLiveCards(groups){
 const cards=new Map();
 for(const group of groups){
  const row=group.representative??group.rows[0];
  const key=group.exact?JSON.stringify([row.sport??'NBA',row.eventID,Date.parse(row.startsAt),row.playerID,row.market,scopeOf(row)]):group.key;
  if(!cards.has(key))cards.set(key,{key,row,selections:[]});
  cards.get(key).selections.push(group);
 }
 return [...cards.values()];
}
export function livePlayerName(rows){
 const row=rows[0],lookup=quoteNames.get(playerKey(row));
 const supplied=new Set(rows.map(r=>displayPlayerName(r.playerName,r.playerID)).filter(r=>r.source==='supplied').map(r=>r.name));
 const names=new Set([...supplied,...(lookup?[lookup.name]:[])]);
 return {...displayPlayerName(names.size===1?[...names][0]:null,row.playerID),lookup,conflicting:names.size>1};
}

// Keep pure grouping/clearance importable for regression tests. Browser rendering
// (including the shared deep-dive.js disclosure) is loaded once on actual pages.
if(typeof document!=='undefined'){
 import('./nba-live-view.js').then(({mountLiveBoard})=>{repaint=mountLiveBoard({groupLiveDecisions,groupLiveCards,livePlayerName,scopeOf});});
}
