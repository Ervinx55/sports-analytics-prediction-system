const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const probability = value => numeric(value) !== null && value >= 0 && value <= 1 ? value : null;
const text = value => typeof value === 'string' ? value : '';
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
export function normalizeResearch(data, sport, now = Date.now()) {
 if (!data || data.error || !['NBA','NFL'].includes(sport) || !Array.isArray(sport === 'NBA' ? data.events : data.candidates)) throw Error('Research response unavailable or malformed.');
 if(sport==='NFL'&&Array.isArray(data.events)){
  const quotes=normalizeResearch(data,'NBA',now);
  const key=r=>JSON.stringify([r.eventID,r.playerID||r.player,r.marketType,r.side.toUpperCase(),r.line,r.book,r.odds]);
  const estimates=normalizeResearch({...data,events:undefined},'NFL',now);
  const index=new Map(estimates.map(r=>[key(r),r]));
  return quotes.map(q=>{const estimate=index.get(key(q));const id=JSON.parse(q.id);id[0]='NFL';return {...q,id:JSON.stringify(id),sport:'NFL',model:estimate?.model??null,market:q.market,status:estimate?'SHADOW':'QUOTE ONLY',reason:estimate?.reason||'No independent estimate is available for this exact quote. Player context remains unverified.'};});
 }
 const rows=[];
 const add = row => {
  if (!Number.isFinite(Date.parse(row.startsAt)) || Date.parse(row.startsAt) <= now) return;
  row.id=JSON.stringify([sport,row.eventID,row.playerID||row.player,row.marketType,row.side,row.line,row.book]);
  row.sport=sport;row.generatedAt=data.generatedAt;row.freshness=quoteFreshness(row.updatedAt,data.generatedAt,now);
  row.odds=numeric(row.odds);if(row.odds!==null&&Math.abs(row.odds)<100)row.odds=null;
  rows.push(row);
 };
 if(sport==='NBA')for(const event of data.events){
  if(!event||!Array.isArray(event.players))continue;
  for(const player of event.players){const prop=player?.prop;if(!prop)continue;
   for(const side of ['over','under']){
    const books=prop[side]?.books;if(!books||typeof books!=='object'||Array.isArray(books))continue;
    for(const [book,quote] of Object.entries(books)){if(!quote||typeof quote!=='object'||quote.available===false)continue;
     add({context:player.context||player.opportunity?.context||null,position:text(player.opportunity?.player?.position),eventID:text(event.eventID),startsAt:event.startsAt,playerID:text(prop.playerID),player:text(prop.playerName)||'Player unavailable',marketType:text(prop.statID)||text(prop.marketName)||'Unknown market',side:side.toUpperCase(),line:numeric(quote.line),book,odds:quote.odds,updatedAt:quote.updatedAt,away:text(event.matchup?.away?.name),home:text(event.matchup?.home?.name),provider:text(event.provider)||text(data.oddsProvider),identityStatus:text(prop.identityStatus),verifiedTeam:text(prop.verifiedTeam),espnPlayerID:text(prop.espnPlayerID),model:null,oppositeUpdatedAt:prop[side==='over'?'under':'over']?.books?.[book]?.updatedAt??null,market:pairedMarket(quote,prop[side==='over'?'under':'over']?.books?.[book],data.generatedAt,now),status:'QUOTE ONLY',reason:prop.identityStatus==='ROSTER_MATCHED'?'Player matches a current ESPN roster for this matchup. Injury availability and player prediction remain unverified. No play is cleared.':'Player prediction, identity and availability are not validated. No PLAY/PASS decision is available from this quote.',quoteState:text(quote.quoteState)});
    }
   }
  }
 } else for(const row of data.candidates){if(!row||typeof row!=='object')continue;
  add({eventID:text(row.eventID),startsAt:row.startsAt,playerID:text(row.playerID),player:text(row.playerName)||'Player unavailable',marketType:text(row.statID)||text(row.marketType)||'Unknown market',side:text(row.side).toUpperCase(),line:numeric(row.line),book:text(row.bestBook)||text(row.book)||'Unavailable',odds:row.bestOdds??row.odds,updatedAt:row.updatedAt,away:text(row.away),home:text(row.home),provider:text(data.oddsProvider),model:probability(row.rawIndependentProbability),market:probability(row.marketFairProbability),status:'SHADOW',reason:text(row.reason)||'Independent estimate is for research. Production influence has not been earned; live injury adjustments are unavailable.',quoteState:text(row.quoteState)});
 }
 return rows;
}
export function filterResearch(rows,{query='',book='',market='',freshness=''}={}) {
 const needle=query.trim().toLowerCase();
 return rows.filter(r=>(!book||r.book===book)&&(!market||r.marketType===market)&&(!freshness||r.freshness===freshness)&&(!needle||[r.player,r.away,r.home,r.marketType,r.side,r.line,r.book].join(' ').replaceAll('_',' ').toLowerCase().includes(needle)));
}

export function refreshResearchRow(row, now=Date.now()) {
 const freshness=quoteFreshness(row.updatedAt,row.generatedAt,now);
 return {...row,freshness,market:freshness==='CURRENT'&&quoteFreshness(row.oppositeUpdatedAt,row.generatedAt,now)==='CURRENT'?row.market:null};
}
