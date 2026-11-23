// Portable pure collector shared by Node and the hosted scheduler. No credentials,
// filesystem, or model changes. It preserves price evidence, not PLAY approval.
const SPORTSBOOKS=new Set('1xbet 888sport ballybet barstool betvictor bet365 betanysports betclic betfairsportsbook betfred betmgm betonline betparx betrsportsbook betrivers betsafe betsson betus betway bluebet bodog bookmakereu boombet bovada boylesports caesars casumo circa coolbet coral draftkings espnbet everygame fanatics fanduel fliff fourwinds foxbet grosvenor gtbets hardrockbet ladbrokes leovegas livescorebet lowvig marathonbet mrgreen mybookie neds nordicbet northstarbets paddypower pinnacle playup pointsbet primesports si skybet sportsbet sportsbetting_ag stake sugarhouse superbook suprabets tab tabtouch thescorebet tipico topsport unibet virginbet williamhill windcreek wynnbet'.split(' '));
const MARKETS=new Set(['passing_yards','passing_touchdowns','rushing_yards','receiving_receptions','receiving_yards']);
const probability=x=>Number.isFinite(x)&&x>=0&&x<=1?x:null;
const validOdds=x=>Number.isFinite(x)&&Math.abs(x)>=100;
const implied=o=>o<0?-o/(-o+100):100/(o+100);
export function captureNflPrices(payload,{receivedAt,maxAgeMs=300000}={}){
  const received=Date.parse(receivedAt||'');
  if(!Number.isFinite(received)) throw new Error('Valid receipt timestamp required');
  if(!Number.isFinite(maxAgeMs)||maxAgeMs<=0) throw new Error('Valid finite freshness limit required');
  const generated=Date.parse(payload?.generatedAt||'');
  const rejected={};const reject=reason=>{rejected[reason]=(rejected[reason]||0)+1;};
  const records=[];
  if(payload?.league!=='NFL'||!Array.isArray(payload.events)) return {records,rejected:{INVALID_PAYLOAD:1}};
  if(!['SportsGameOdds','SharpAPI','The Odds API'].includes(payload.oddsProvider)) return {records,rejected:{UNVERIFIED_SOURCE:1}};
  if(!Number.isFinite(generated)||generated>received||received-generated>maxAgeMs||payload?.sourceHealth?.provider?.servedStale===true) return {records,rejected:{STALE_RESPONSE:1}};
  const seen=new Set();
  for(const event of payload.events){
    const start=Date.parse(event.startsAt||'');
    if(!event.eventID||!Number.isFinite(start)||start<=received){reject('NOT_PREGAME');continue;}
    for(const player of event.players||[]){
      const prop=player.prop||{};
      if(!prop.playerID||!MARKETS.has(prop.statID)){reject('MISSING_IDENTITY_OR_MARKET');continue;}
      if(['over','under'].some(side=>prop[side]?.side!==side||prop[side]?.oddID!==`${prop.statID}-${prop.playerID}-game-ou-${side}`)){
        reject('UNVERIFIED_MARKET_IDENTITY');continue;
      }
      const books=new Set([...Object.keys(prop.over?.books||{}),...Object.keys(prop.under?.books||{})]);
      for(const book of books){
        if(!SPORTSBOOKS.has(book)){reject('PAYOUT_OR_EXCHANGE_CHECK_REQUIRED');continue;}
        const over=prop.over?.books?.[book],under=prop.under?.books?.[book];
        if(!over||!under){reject('MISSING_OPPOSITE_SIDE');continue;}
        if(over.available!==true||under.available!==true){reject('UNAVAILABLE_QUOTE');continue;}
        if(!Number.isFinite(over.line)||!Number.isFinite(under.line)||over.line!==under.line||!validOdds(over.odds)||!validOdds(under.odds)){reject('INVALID_PRICE_OR_LINE');continue;}
        const stamps=[over.updatedAt,under.updatedAt].map(x=>Date.parse(x||''));
        if(stamps.some(t=>!Number.isFinite(t)||t>received||received-t>maxAgeMs||t>=start)){reject('STALE_OR_UNDATED_SIDE');continue;}
        const key=JSON.stringify([event.eventID,prop.playerID,prop.statID,book,over.line,over.odds,under.odds,over.updatedAt,under.updatedAt,payload.version,payload.generatedAt]);
        if(seen.has(key)) continue;seen.add(key);
        const candidates=player.candidates||payload.candidates||[];
        const estimate=candidates.find(c=>(!c.eventID||c.eventID===event.eventID)&&c.playerID===prop.playerID&&c.statID===prop.statID&&c.book===book&&c.line===over.line&&c.side==='over'&&c.odds===over.odds);
        const total=implied(over.odds)+implied(under.odds);
        records.push({schemaVersion:'nfl-exact-price-pair-v1',identity:key,sport:'NFL',eventID:event.eventID,playerID:prop.playerID,playerName:prop.playerName||null,
          market:prop.statID,period:'game',book,line:over.line,overOdds:over.odds,underOdds:under.odds,
          overOddID:prop.over.oddID,underOddID:prop.under.oddID,
          overUpdatedAt:over.updatedAt,underUpdatedAt:under.updatedAt,startsAt:event.startsAt,
          receivedAt,forecastPublishedAt:payload.generatedAt,source:payload.oddsProvider||null,
          modelVersion:payload.version||null,modelHash:null,
          marketOverProbability:implied(over.odds)/total,marketUnderProbability:implied(under.odds)/total,
          baselineOverProbability:probability(estimate?.rawIndependentProbability),
          quoteEligible:true,validationEligible:false,
          validationBlocker:'Exact source model hash and new prospective protocol must be registered separately; price capture alone is not model validation.',
          productionEligible:false,productionWeight:0});
      }
    }
  }
  return {records,rejected,receivedAt,freshnessLimitMs:maxAgeMs};
}
