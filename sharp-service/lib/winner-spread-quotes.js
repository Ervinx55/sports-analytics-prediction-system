// Provider IDs and per-book `spread` field match api/board.js and archived SGO
// responses. These are price observations, never a margin/cover model.
export const WINNER_SPREAD_ODD_IDS=Object.freeze(['points-home-game-sp-home','points-away-game-sp-away']);
const time=value=>typeof value==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())?Number(value):NaN;
const implied=value=>Number.isInteger(value)&&Math.abs(value)>=100&&Math.abs(value)<=100000?(value>0?100/(100+value):-value/(100-value)):null;
const https=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
export function collectWinnerSpreadQuotes({event,raw,source,books=[],issuedAt}={}){
 const result={purpose:'PRICE_EVIDENCE_ONLY',coverProbabilityAvailable:false,productionEligible:false,pairedPriceEligible:false,pairs:[],matchingQuotes:0,rejectedQuotes:0,oneSidedBooks:0,unavailableBooks:0,reasons:[]};
 const reject=reason=>{if(!result.reasons.includes(reason))result.reasons.push(reason);};
 const now=time(issuedAt),fetched=time(source?.fetched_at),start=time(event?.startsAt);
 if(!['NBA','NFL'].includes(event?.sport)||!event?.eventID||event.identityVerified!==true||event.status!=='SCHEDULED'||raw?.eventID!==event.sourceIds?.sgo||!event.sourceIds?.sgo||raw.leagueID!==event.sport||raw.type!=='match'||time(raw.status?.startsAt)!==start||['started','live','completed','finalized','cancelled','canceled'].some(k=>raw.status?.[k]===true)){
  reject('SPREAD_EVENT_IDENTITY_UNVERIFIED');return result;
 }
 if(!Number.isFinite(now)||!Number.isFinite(fetched)||!Number.isFinite(start)||fetched>now||now-fetched>300000||now>=start||fetched>=start||!/^[a-f0-9]{64}$/i.test(source?.source_hash??'')||!https(source?.source_url)){
  reject('SPREAD_SOURCE_RECEIPT_INVALID');return result;
 }
 const markets=WINNER_SPREAD_ODD_IDS.map(id=>raw.odds?.[id]);
 if(markets.some((m,i)=>m&&((m.oddID!==undefined&&m.oddID!==WINNER_SPREAD_ODD_IDS[i])||(m.opposingOddID!==undefined&&m.opposingOddID!==WINNER_SPREAD_ODD_IDS[1-i])||['periodID','statID','betTypeID','statEntityID','sideID'].some(k=>m[k]!==undefined&&m[k]!==({periodID:'game',statID:'points',betTypeID:'sp',statEntityID:i?'away':'home',sideID:i?'away':'home'})[k])||['started','ended','cancelled','canceled'].some(k=>m[k]===true)))){
  reject('SPREAD_MARKET_IDENTITY_OR_STATUS_INVALID');return result;
 }
 for(const book of [...new Set(books)].filter(b=>typeof b==='string'&&/^[a-z0-9_-]{1,60}$/.test(b)).sort().slice(0,20)){
  const h=markets[0]?.byBookmaker?.[book],a=markets[1]?.byBookmaker?.[book];
  if(h?.available!==true||a?.available!==true){if((h?.available===true)!==(a?.available===true)){result.oneSidedBooks++;reject('SPREAD_ONE_SIDED_BOOK');}else result.unavailableBooks++;continue;}
  result.matchingQuotes++;
  const homeLine=number(h.spread),awayLine=number(a.spread),homeOdds=number(h.odds),awayOdds=number(a.odds),hu=time(h.lastUpdatedAt),au=time(a.lastUpdatedAt);
  let reason;
  if(![homeLine,awayLine].every(x=>Number.isFinite(x)&&Number.isInteger(x*2))||homeLine!==-awayLine)reason='SPREAD_LINE_INVALID_OR_NOT_OPPOSITE';
  else if(![hu,au].every(t=>Number.isFinite(t)&&t<=fetched&&now-t<=300000)||Math.abs(hu-au)>120000)reason='SPREAD_STALE_FUTURE_OR_UNPAIRED';
  else {const hp=implied(homeOdds),ap=implied(awayOdds);if(hp===null||ap===null||hp+ap<1||hp+ap>1.15)reason='SPREAD_INVALID_PRICE_OR_OVERROUND';}
  if(reason){result.rejectedQuotes++;reject(reason);continue;}
  result.pairs.push({eventID:event.eventID,sourceEventId:raw.eventID,book,market:'SPREAD',period:'FULL_GAME',homeOddID:WINNER_SPREAD_ODD_IDS[0],awayOddID:WINNER_SPREAD_ODD_IDS[1],homeLine,awayLine,homeOdds,awayOdds,homeUpdatedAt:h.lastUpdatedAt,awayUpdatedAt:a.lastUpdatedAt,fetchedAt:source.fetched_at,sourceUrl:source.source_url,sourceHash:source.source_hash});
 }
 result.pairedPriceEligible=result.pairs.length>0;
 if(!result.pairs.length&&!result.reasons.length)reject('SPREAD_AVAILABLE_BOOK_PAIR_MISSING');
 return result;
}
