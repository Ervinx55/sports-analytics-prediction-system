const finite=value=>typeof value==='number'&&Number.isFinite(value);
const probability=value=>finite(value)&&value>=0&&value<=1?value:null;
const present=value=>value!==null&&value!==undefined&&String(value).trim()!=='';
const first=(...values)=>values.find(present);
const normalized=value=>present(value)?String(value).trim().toLowerCase():null;
const exactLine=value=>finite(value)?value:typeof value==='string'&&/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())?Number(value):null;

// A current selection is an exact wager, not a database observation or a label.
// Keep distinct model evaluations separate, and fail open for display when a
// partial identity cannot safely prove that two rows describe the same wager.
function selectionKey(row={},card={},index=0,includeModel=true) {
 const sport=normalized(first(row.sport,card.sport));
 const event=first(row.event_id,row.eventID);
 const start=Date.parse(first(row.starts_at,row.startsAt));
 const player=first(row.player_id,row.playerID);
 const team=first(row.team_id,row.teamID,row.teamId,row.selection_id);
 const market=normalized(first(row.stat_id,row.statID,row.market_type,row.marketType,typeof row.market==='string'?row.market:null));
 const side=normalized(first(row.side,row.market_side,row.side_key));
 const book=normalized(first(row.book,row.best_book,row.bookmaker));
 const rawLine=first(row.market_line,row.line);
 const line=exactLine(rawLine);
 const period=normalized(first(row.period,row.game_period,row.periodID));
 const model=[row.modelHash,row.model_hash,row.validationProtocol,row.validation_protocol,row.model_version,row.modelVersion].map(value=>value??null);
 const identity=[sport,event??null,Number.isFinite(start)?start:null,player??null,team??null,market,period,side,line,book];
 if(includeModel)identity.push(model);
 const entityKnown=player||team||['moneyline','spread','total','runline','run_line'].includes(market);
 const complete=sport&&event&&Number.isFinite(start)&&market&&side&&book&&entityKnown
  &&(market==='moneyline'||line!==null);
 return JSON.stringify(complete?identity:[...identity,'partial',first(row.id,row.identity,row.observation_id)??`row:${index}`]);
}
export function currentSelectionKey(row={},card={},index=0) {return selectionKey(row,card,index);}

const quoteUnavailable=row=>row.available===false||row.quoteAvailable===false||row.marketAvailable===false;
const modelDisabled=row=>row.productionEligible===false||row.productionWeight===0;
const withheld=row=>quoteUnavailable(row)||modelDisabled(row);
const restrictionRank=row=>withheld(row)?3:row.status==='PLAY'?0:row.status==='PENDING'?1:2;
const quotePrice=row=>exactLine(first(row.best_odds,row.odds));
const quoteFacts=row=>JSON.stringify([quoteUnavailable(row),quotePrice(row)]);
const decisionFacts=row=>JSON.stringify([row.status,row.model_probability??null,row.market_fair_probability??null,
 row.edge_pct_points??null,row.ev_pct??null,exactLine(row.playable_threshold),modelDisabled(row),
 present(first(row.valid_until,row.validUntil))?Date.parse(first(row.valid_until,row.validUntil)):'none',row.freshness?.hardStale===true,quoteFacts(row)]);
function observeLatest(groups,key,row,timestamp){
 const previous=groups.get(key);
 if(!previous||timestamp>previous.timestamp)groups.set(key,{timestamp,rows:[row]});
 else if(timestamp===previous.timestamp)previous.rows.push(row);
}
export function latestCurrentSelections(rows=[],card={}) {
 const latest=new Map(),quotes=new Map(),quoteKeys=new Map();
 for(const [index,row] of rows.entries()){
  const key=currentSelectionKey(row,card,index),quoteKey=selectionKey(row,card,index,false),timestamp=Date.parse(row.captured_at);
  quoteKeys.set(key,quoteKey);
  observeLatest(latest,key,row,timestamp);observeLatest(quotes,quoteKey,row,timestamp);
 }
 return [...latest].map(([key,group])=>{
  const chosen=group.rows.reduce((a,b)=>restrictionRank(b)>restrictionRank(a)
   ||restrictionRank(b)===restrictionRank(a)&&String(b.id??'').localeCompare(String(a.id??''))>0?b:a);
  const quote=quotes.get(quoteKeys.get(key));
  // Models may disagree on probability. A withdrawn or contradictory current
  // price is shared by every evaluation of this exact sportsbook selection.
  const observationConflict=new Set(group.rows.map(decisionFacts)).size>1||new Set(quote.rows.map(quoteFacts)).size>1;
  const latestQuoteUnavailable=quote.rows.some(quoteUnavailable);
  const priceSuperseded=quote.timestamp>group.timestamp&&quote.rows.some(row=>quotePrice(row)!==quotePrice(chosen));
  return observationConflict||latestQuoteUnavailable||priceSuperseded?{...chosen,observationConflict:observationConflict||chosen.observationConflict===true,latestQuoteUnavailable,priceSuperseded,
   latestQuoteCapturedAt:Number.isFinite(quote.timestamp)?new Date(quote.timestamp).toISOString():null}:chosen;
 });
}

// Ranking changes order only. It never promotes a pending or rejected decision.
export function rankByWinProbability(rows=[]) {
 return [...rows].sort((a,b)=>(probability(b.model_probability)??-1)-(probability(a.model_probability)??-1)
  || (finite(b.ev_pct)?b.ev_pct:-Infinity)-(finite(a.ev_pct)?a.ev_pct:-Infinity)
  || String(a.id??a.market_label??a.label??'').localeCompare(String(b.id??b.market_label??b.label??'')));
}

export function currentDecisionCard(card,{sport,kind='markets',now=Date.now(),available=true}={}) {
 const empty={summary:{[kind==='props'?'gradedProps':'markets']:null,play:null,pending:null,pass:null},[kind]:[],plays:[],pending:[],passes:[],recentResults:[]};
 const unavailable=()=>({...empty,availability:'UNAVAILABLE',reason:'Current decisions are unavailable. A failed source is not a verified zero-play slate.'});
 if(!available||!card||typeof card!=='object'||Array.isArray(card)||card.error)return unavailable();
 if(!Array.isArray(card[kind])&&!['plays','pending','passes'].some(key=>Array.isArray(card[key])))return unavailable();
 if([kind,'plays','pending','passes'].some(key=>card[key]!==undefined&&!Array.isArray(card[key])))return unavailable();
 const rows=Array.isArray(card[kind])?card[kind]:[...(card.plays??[]),...(card.pending??[]),...(card.passes??[])];
 if(rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))return unavailable();
 const timed=rows.filter(row=>{
  const start=Date.parse(row.starts_at),captured=Date.parse(row.captured_at);
  return String(row.sport??card.sport??'').toUpperCase()===sport&&Number.isFinite(start)&&start>now
   &&Number.isFinite(captured)&&captured<=now&&captured<start;
 });
 const latest=latestCurrentSelections(timed,card);
 const current=latest.map(row=>{
  if(row.status!=='PLAY')return row;
  const minutes=(Date.parse(row.starts_at)-now)/60000;
  const marketTargetMinutes=minutes<=20?2:minutes<=90?5:minutes<=360?15:30;
  const expiry=first(row.valid_until,row.validUntil);
  const expired=present(expiry)&&(!Number.isFinite(Date.parse(expiry))||Date.parse(expiry)<=now);
  const stale=expired||now-Date.parse(row.captured_at)>marketTargetMinutes*2*60000||row.freshness?.hardStale===true;
  const disabled=card.productionEligible===false||card.productionWeight===0||row.productionEligible===false||row.productionWeight===0;
  const unavailableQuote=quoteUnavailable(row)||row.latestQuoteUnavailable===true;
  const conflicted=row.observationConflict===true;
  const superseded=row.priceSuperseded===true;
  if(!stale&&!disabled&&!unavailableQuote&&!conflicted&&!superseded&&probability(row.model_probability)!==null)return row;
  return {...row,recordedStatus:row.status,status:'PASS',reason:unavailableQuote?'The latest market observation is unavailable; a fresh quote is required.':conflicted?'Conflicting current observations prevent a verified decision; a fresh evaluation is required.':superseded?'The market price changed after this evaluation; a fresh decision is required.':stale?'Decision evidence has expired; a fresh evaluation is required.':disabled?'Production use is disabled for this decision.':'A valid model probability is missing for this decision.'};
 });
 const plays=rankByWinProbability(current.filter(row=>row.status==='PLAY'
  &&row.productionEligible!==false&&row.productionWeight!==0
  &&probability(row.model_probability)!==null));
 const pending=current.filter(row=>row.status==='PENDING'),passes=current.filter(row=>row.status==='PASS');
 return {...card,[kind]:current,plays,pending,passes,
  summary:{...card.summary,[kind==='props'?'gradedProps':'markets']:current.length,play:plays.length,pending:pending.length,pass:passes.length},
  availability:'AVAILABLE',excludedFromCurrent:rows.length-current.length,supersededObservations:timed.length-latest.length,rankingBasis:'MODEL_WIN_PROBABILITY'};
}

export function sportPropCard(sport) {
 return {availability:'USE_SPORT_RESEARCH',sport,
  reason:`The legacy graded prop card covers MLB. Open ${sport} research for that sport's quotes and verified decision status.`,
  researchUrl:sport==='NBA'?'/nba.html':sport==='NFL'?'/nfl.html':'/research.html',
  summary:{gradedProps:null,play:null,pending:null,pass:null},props:[],plays:[],pending:[],passes:[],recentResults:[]};
}
