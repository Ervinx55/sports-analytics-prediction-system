import {americanOddsToProbability,removeVigTwoWay,priceAmerican} from './edge-vnext.js';

const SHARPS=[['pinnacle',60],['circa',25],['bookmakereu',15]];
const EXECUTION_BOOKS=['draftkings','fanduel','betmgm','caesars','bet365'];
const MAX_AGE_MS=600000,MAX_PAIR_SKEW_MS=120000,MAX_START_SKEW_MS=900000;
const aliases={NY:'NYK',WSH:'WAS',GS:'GSW',SA:'SAS',NO:'NOP',UTAH:'UTA',PHO:'PHX'};
const team=x=>aliases[String(x||'').toUpperCase()]||String(x||'').toUpperCase();
function fresh(q,now){
 const updated=Date.parse(q?.updatedAt);
 return q?.available===true&&americanOddsToProbability(Number(q.odds))!==null&&
  Number.isFinite(updated)&&updated<=now&&now-updated<=MAX_AGE_MS;
}
function best(books,now){
 return EXECUTION_BOOKS.flatMap(book=>fresh(books?.[book],now)?[{book,odds:Number(books[book].odds),updatedAt:books[book].updatedAt}]:[])
  .sort((a,b)=>b.odds-a.odds)[0]||null;
}
function fairOdds(p){return typeof p==='number'&&p>0&&p<1?(p>=.5?-100*p/(1-p):100*(1-p)/p):null;}
function marketEvidence(event,now){
 const ml=event.markets?.moneyline,home=ml?.home?.books,away=ml?.away?.books;
 const referenceBooks=[];
 for(const [book,weight] of SHARPS){
  const h=home?.[book],a=away?.[book];
  if(!fresh(h,now)||!fresh(a,now)||Math.abs(Date.parse(h.updatedAt)-Date.parse(a.updatedAt))>MAX_PAIR_SKEW_MS)continue;
  const pair=removeVigTwoWay(Number(h.odds),Number(a.odds));
  if(!pair||pair.overround<0||pair.overround>.15)continue;
  referenceBooks.push({book,weight,homeOdds:Number(h.odds),awayOdds:Number(a.odds),homeFairProbability:pair.a,
   homeUpdatedAt:h.updatedAt,awayUpdatedAt:a.updatedAt});
 }
 const denominator=referenceBooks.reduce((s,b)=>s+b.weight,0);
 const p=denominator?referenceBooks.reduce((s,b)=>s+b.weight*b.homeFairProbability,0)/denominator:null;
 return {eventID:event.eventID,homeFairProbability:p,awayFairProbability:p===null?null:1-p,
  homeFairOdds:fairOdds(p),awayFairOdds:fairOdds(p===null?null:1-p),referenceBooks,
  referenceStatus:referenceBooks.length>1?'SHARP_CONSENSUS':referenceBooks.length?'SINGLE_SHARP_REFERENCE':'UNAVAILABLE',
  method:'Two-sided proportional no-vig; Pinnacle/Circa/BookMaker weights 60/25/15, renormalized over fresh pairs. Weights are a research convention.',
  homeBest:best(home,now),awayBest:best(away,now)};
}

// Odds are attached AFTER fitting. Never turn a market price into an independent forecast.
export function attachNbaMarketEvidence(report,board){
 const now=Date.parse(report.generatedAt),fetched=Date.parse(board?.fetchedAt);
 const healthy=Array.isArray(board?.events)&&Number.isFinite(fetched)&&fetched<=now&&now-fetched<=MAX_AGE_MS;
 const events=healthy?board.events.filter(e=>e?.league==='NBA'&&e.eventID&&Date.parse(e.startsAt)>now&&
  !['started','live','completed','finalized','cancelled','postponed'].some(k=>e.status?.[k])&&
  !['PP','CANCELLED','POSTPONED'].includes(String(e.status?.display||'').toUpperCase())):[];
 const rows=(report.rows||[]).map(row=>{
  const matches=events.filter(e=>team(e.matchup?.home?.short)===team(row.home)&&team(e.matchup?.away?.short)===team(row.away)&&
   Math.abs(Date.parse(e.startsAt)-Date.parse(row.startsAt))<=MAX_START_SKEW_MS);
  const reasons=row.reasons.filter(r=>!['NO_BOOK_QUOTE','BOOK_QUOTES_NOT_REQUESTED'].includes(r));
  if(matches.length!==1)return {...row,market:null,reasons:[...reasons,!healthy?'QUOTE_SOURCE_UNAVAILABLE':matches.length?'AMBIGUOUS_MARKET_EVENT':'NO_MATCHING_MARKET_EVENT']};
  const market=marketEvidence(matches[0],now);
  if(!market.referenceBooks.length)reasons.push('NO_FRESH_SHARP_PAIR');
  else if(market.referenceBooks.length===1)reasons.push('SINGLE_SHARP_REFERENCE');
  if(!market.homeBest&&!market.awayBest)reasons.push('NO_FRESH_EXECUTION_QUOTE');
  return {...row,market,reasons};
 });
 const winners=rows.filter(r=>typeof r.homeWinProbability==='number').map(r=>({eventId:r.eventId,startsAt:r.startsAt,
  team:r.homeWinProbability>=.5?r.home:r.away,probability:Math.max(r.homeWinProbability,r.awayWinProbability),
  status:'RESEARCH_ONLY',reasons:r.reasons})).sort((a,b)=>b.probability-a.probability);
 const value=rows.flatMap(r=>['home','away'].flatMap(side=>{
  const p=r[side+'WinProbability'],quote=r.market?.[side+'Best'];
  if(typeof p!=='number'||!quote)return [];
  const fair=r.market[side+'FairProbability'];
  return [{eventId:r.eventId,startsAt:r.startsAt,selection:r[side],side,book:quote.book,odds:quote.odds,quoteUpdatedAt:quote.updatedAt,
   modelProbability:p,marketFairProbability:fair,modelExpectedReturn:priceAmerican({winProbability:p,odds:quote.odds}).netEVPerDollar,
   marketExpectedReturn:fair===null?null:priceAmerican({winProbability:fair,odds:quote.odds}).netEVPerDollar,
   status:'RESEARCH_ONLY',reasons:r.reasons}];
 })).sort((a,b)=>b.modelExpectedReturn-a.modelExpectedReturn);
 const reasonCounts={};for(const r of rows)for(const reason of new Set(r.reasons))reasonCounts[reason]=(reasonCounts[reason]||0)+1;
 return {...report,rows,rankings:{winners,value},evaluationSummary:{games:rows.length,matchedGames:rows.filter(r=>r.market).length,
  gamesWithSharpPairs:rows.filter(r=>r.market?.referenceBooks.length).length,pricedSides:value.length,reasonCounts},
  quoteSource:{status:healthy?'OBSERVED':'UNAVAILABLE',fetchedAt:healthy?board.fetchedAt:null},productionEligible:false,automaticBuyEnabled:false};
}
