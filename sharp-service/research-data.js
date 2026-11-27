import {assessPropQuote,platformType} from './prop-price-checks.js';
import {latestResearchObservations,researchQuoteKey} from './research-observations.js';
export {latestResearchObservations,researchQuoteKey} from './research-observations.js';
import {assessGameQuote} from './research-comparison.js';
import {displayPlayerName} from './ui-format.js';
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const probability = value => numeric(value) !== null && value >= 0 && value <= 1 ? value : null;
const text = value => typeof value === 'string' ? value.trim() : '';
export function quoteFreshness(stamp, generatedAt, now = Date.now()) {
 const times = [stamp, generatedAt].map(v => typeof v === 'string' ? Date.parse(v) : NaN);
 if (times.some(t => !Number.isFinite(t) || t > now + 60_000)) return 'UNKNOWN';
 return times.some(t => now - t > 10 * 60_000) ? 'STALE' : 'CURRENT';
}
function pairedMarket(quote, opposite, generatedAt, now) {
 const usable=q=>q&&q.available!==false&&numeric(q.line)!==null&&numeric(q.odds)!==null&&Math.abs(q.odds)>=100&&quoteFreshness(q.updatedAt,generatedAt,now)==='CURRENT';
 if(!usable(quote)||!usable(opposite)||quote.line!==opposite.line)return null;
 const implied=o=>o>0?100/(o+100):-o/(-o+100);
 const a=implied(quote.odds),b=implied(opposite.odds);
 return a/(a+b);
}
function subject(row){return text(row.playerID)||text(row.participant)||(!['Player unavailable','Player name unavailable','Unknown player','Name unavailable'].includes(row.player)?text(row.player):'');}
export function groupResearchRows(rows) {
 const groups=new Map();
 for(const [index,row] of rows.entries()){
  const who=row.kind==='games'?'game':subject(row),start=Date.parse(row.startsAt);
  const key=who&&row.eventID&&Number.isFinite(start)?JSON.stringify([row.sport,row.kind||'props',row.provider||'',row.eventID,start,who,row.marketType,row.period||'game',row.outcomeStructure||'ou']):'unidentified:'+index;
  if(!groups.has(key))groups.set(key,{key,rows:[],player:row.player,eventID:row.eventID,startsAt:row.startsAt,marketType:row.marketType,period:row.period||'game',kind:row.kind||'props'});
  groups.get(key).rows.push(row);
 }
 return [...groups.values()];
}
export function sortResearchGroups(groups,sort='time') {
 const best=(group,key)=>{const values=group.rows.filter(row=>row.available!==false&&!row.quoteConflict).map(row=>key==='gap'?probability(row.model)!==null&&probability(row.market)!==null?row.model-row.market:null:key==='ev'?numeric(row.expectedValue):probability(row[key])).filter(value=>value!==null);return values.length?Math.max(...values):null;};
 return [...groups].sort((a,b)=>{
  if(['model','market','gap','ev'].includes(sort)){const av=best(a,sort),bv=best(b,sort);if(av===null&&bv!==null)return 1;if(bv===null&&av!==null)return -1;if(av!==bv)return bv-av;}
  return Date.parse(a.startsAt)-Date.parse(b.startsAt)||String(a.player).localeCompare(String(b.player))||String(a.marketType).localeCompare(String(b.marketType));
 });
}
export function normalizeResearch(data, sport, now = Date.now()) {
 if (!data || data.error || !['NBA','NFL'].includes(sport) || !Array.isArray(sport === 'NBA' ? data.events : data.candidates)) throw Error('Research response unavailable or malformed.');
 if(sport==='NFL'&&Array.isArray(data.events)){
  const quotes=normalizeResearch(data,'NBA',now);
  const key=r=>JSON.stringify([r.provider||'',r.eventID,Date.parse(r.startsAt),r.playerID||r.player,r.marketType,r.period||'game',r.side.toUpperCase(),r.line,r.book,r.odds]);
  const estimates=normalizeResearch({...data,events:undefined},'NFL',now);
  const index=new Map(estimates.map(r=>[key(r),r]));
  return quotes.map(q=>{const estimate=q.available!==false&&!q.quoteConflict?index.get(key(q)):null;const id=JSON.parse(q.id);id[0]='NFL';return {...q,id:JSON.stringify(id),sport:'NFL',model:estimate?.model??null,market:q.market,status:q.available===false?'UNAVAILABLE':estimate?'SHADOW':'QUOTE ONLY',reason:q.available===false?q.reason:estimate?.reason||'No independent estimate is available for this exact quote. Player context remains unverified.'};});
 }
 const rows=[];
 const add = row => {
  if (!Number.isFinite(Date.parse(row.startsAt)) || Date.parse(row.startsAt) <= now) return;
  row.sport=sport;row.generatedAt=data.generatedAt;row.freshness=row.priceCheck?.freshness??quoteFreshness(row.updatedAt,data.generatedAt,now);
  row.id=JSON.stringify([sport,row.provider||'',row.eventID,Date.parse(row.startsAt),subject(row)||'unidentified:'+rows.length,row.marketType,row.period||'game',row.side,row.line,row.book]);
  row.odds=numeric(row.odds);if(row.odds!==null&&Math.abs(row.odds)<100)row.odds=null;
  rows.push(row);
 };
 if(sport==='NBA')for(const event of data.events){
  if(!event||!Array.isArray(event.players))continue;
  for(const player of event.players){const prop=player?.prop;if(!prop)continue;
   const propReadiness=player.propReadiness?.contract==='nba-prop-readiness-v1'?player.propReadiness:null;
   const name=displayPlayerName(prop.playerName,prop.playerID);
   for(const side of ['over','under']){
    const books=prop[side]?.books;if(!books||typeof books!=='object'||Array.isArray(books))continue;
    for(const [book,quote] of Object.entries(books)){if(!quote||typeof quote!=='object')continue;
     const type=platformType(book),opposite=prop[side==='over'?'under':'over']?.books?.[book];
     const priceCheck=['nba-multibook-research-v1','nfl-multibook-research-v1'].includes(data.contract)?assessPropQuote({book,quote,opposite,generatedAt:data.generatedAt,now}):null;
     const observation=q=>q?{line:q.line,odds:q.odds,available:q.available,updatedAt:q.updatedAt}:null;
     add({platformType:type,available:quote.available,priceCheck,priceQuote:observation(quote),oppositeQuote:observation(opposite),context:player.context||player.opportunity?.context||null,propReadiness,position:text(player.context?.position)||text(player.opportunity?.player?.position),eventID:text(event.eventID),startsAt:event.startsAt,playerID:text(prop.playerID),player:name.name,nameSource:name.source,marketType:text(prop.statID)||text(prop.marketName)||'Unknown market',period:text(prop.marketScope||prop.market_scope||prop.period||prop.periodID||player.period)||'game',side:side.toUpperCase(),line:numeric(quote.line),book,odds:['dfs','exchange'].includes(type)?null:quote.odds,indicativeOdds:['dfs','exchange'].includes(type)?numeric(quote.indicativeOdds??quote.odds):null,updatedAt:quote.updatedAt,away:text(event.matchup?.away?.name),home:text(event.matchup?.home?.name),provider:text(event.provider)||text(data.oddsProvider)||text(data.source),identityStatus:text(prop.identityStatus),verifiedTeam:text(prop.verifiedTeam),espnPlayerID:text(prop.espnPlayerID),model:null,oppositeUpdatedAt:opposite?.updatedAt??null,market:['dfs','exchange'].includes(type)?null:priceCheck?priceCheck.marketProbability:pairedMarket(quote,opposite,data.generatedAt,now),status:'QUOTE ONLY',reason:text(propReadiness?.summary)||(prop.identityStatus==='ROSTER_MATCHED'?'Player matches a current ESPN roster for this matchup. Injury availability and player prediction remain unverified. No play is cleared.':'Player prediction, identity and availability are not validated. No PLAY/PASS decision is available from this quote.'),quoteState:text(quote.quoteState)});
    }
   }
  }
 } else for(const row of data.candidates){if(!row||typeof row!=='object')continue;
  const name=displayPlayerName(row.playerName,row.playerID);
  add({eventID:text(row.eventID),startsAt:row.startsAt,playerID:text(row.playerID),player:name.name,nameSource:name.source,marketType:text(row.statID)||text(row.marketType)||'Unknown market',period:text(row.period||row.periodID)||'game',side:text(row.side).toUpperCase(),line:numeric(row.line),book:text(row.bestBook)||text(row.book)||'Unavailable',available:row.available,odds:row.bestOdds??row.odds,updatedAt:row.updatedAt,away:text(row.away),home:text(row.home),provider:text(data.oddsProvider)||text(data.source),model:probability(row.rawIndependentProbability),market:probability(row.marketFairProbability),status:'SHADOW',reason:text(row.reason)||'Independent estimate is for research. Production influence has not been earned; live injury adjustments are unavailable.',quoteState:text(row.quoteState)});
 }
 const latest=latestResearchObservations(rows,now);
 if(sport!=='NBA')return latest;
 const index=new Map(latest.map(row=>[researchQuoteKey(row),row]).filter(([key])=>key!==null));
 // Rebuild each comparison from the latest opposite observation too; an older
 // paired quote must not survive a more recent withdrawal on the other side.
 return latest.map(row=>{
  if(!row.priceQuote)return row;
  const opposite=index.get(researchQuoteKey({...row,side:row.side==='OVER'?'UNDER':'OVER'}));
  const oppositeQuote=opposite?.priceQuote??null;
  const priceCheck=row.priceCheck?assessPropQuote({book:row.book,quote:row.priceQuote,opposite:oppositeQuote,generatedAt:row.generatedAt,now}):null;
  const market=row.available===false||row.quoteConflict||['dfs','exchange'].includes(row.platformType)?null:priceCheck?priceCheck.marketProbability:pairedMarket(row.priceQuote,oppositeQuote,row.generatedAt,now);
  return {...row,oppositeQuote,oppositeUpdatedAt:oppositeQuote?.updatedAt??null,priceCheck,market};
 });
}
export function filterResearch(rows,{query='',book='',market='',freshness='',side='',game='',status=''}={}) {
 const needle=query.trim().toLowerCase();
 return rows.filter(r=>(!book||r.book===book)&&(!market||r.marketType===market)&&(!freshness||r.freshness===freshness)&&(!side||r.side===side)&&(!game||r.eventID===game)&&(!status||(status==='UNVERIFIED'?r.available===false||r.model===null:r.status===status))&&(!needle||[r.player,r.playerID,r.away,r.home,r.cfbForecast?.homeName,r.cfbForecast?.awayName,r.marketType,r.side,r.line,r.book].join(' ').replaceAll('_',' ').toLowerCase().includes(needle)));
}
export function refreshResearchRow(row, now=Date.now()) {
 if(row.available===false||row.quoteConflict)return {...row,model:null,market:null,status:'UNAVAILABLE',priceQuote:row.priceQuote?{...row.priceQuote,available:false}:null};
 if(row.kind==='games'){const priceCheck=assessGameQuote(row,now);const age=now-Date.parse(row.cfbForecast?.generatedAt);const expired=row.cfbForecast&&(!Number.isFinite(age)||age<0||age>30*60000);return {...row,...(expired?{model:null,cfbForecast:null,status:'QUOTE ONLY',reason:'CFB forecast expired; refresh the research board.'}:{}),priceCheck,freshness:priceCheck.freshness,market:priceCheck.marketProbability};}
 if(row.priceCheck){const priceCheck=assessPropQuote({book:row.book,quote:row.priceQuote,opposite:row.oppositeQuote,generatedAt:row.generatedAt,now});return {...row,priceCheck,freshness:priceCheck.freshness,market:priceCheck.marketProbability};}
 const freshness=quoteFreshness(row.updatedAt,row.generatedAt,now);
 return {...row,freshness,market:freshness==='CURRENT'&&quoteFreshness(row.oppositeUpdatedAt,row.generatedAt,now)==='CURRENT'?row.market:null};
}
