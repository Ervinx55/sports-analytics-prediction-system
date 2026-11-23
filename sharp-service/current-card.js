const finite=value=>typeof value==='number'&&Number.isFinite(value);
const probability=value=>finite(value)&&value>=0&&value<=1?value:null;

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
 const current=rows.filter(row=>{
  const start=Date.parse(row.starts_at),captured=Date.parse(row.captured_at);
  return String(row.sport??card.sport??'').toUpperCase()===sport&&Number.isFinite(start)&&start>now
   &&Number.isFinite(captured)&&captured<=now&&captured<start;
 }).map(row=>{
  if(row.status!=='PLAY')return row;
  const minutes=(Date.parse(row.starts_at)-now)/60000;
  const marketTargetMinutes=minutes<=20?2:minutes<=90?5:minutes<=360?15:30;
  const stale=now-Date.parse(row.captured_at)>marketTargetMinutes*2*60000||row.freshness?.hardStale===true;
  const disabled=card.productionEligible===false||card.productionWeight===0||row.productionEligible===false||row.productionWeight===0;
  if(!stale&&!disabled&&probability(row.model_probability)!==null)return row;
  return {...row,recordedStatus:row.status,status:'PASS',reason:stale?'Decision evidence has expired; a fresh evaluation is required.':disabled?'Production use is disabled for this decision.':'A valid model probability is missing for this decision.'};
 });
 const plays=rankByWinProbability(current.filter(row=>row.status==='PLAY'
  &&row.productionEligible!==false&&row.productionWeight!==0
  &&probability(row.model_probability)!==null));
 const pending=current.filter(row=>row.status==='PENDING'),passes=current.filter(row=>row.status==='PASS');
 return {...card,[kind]:current,plays,pending,passes,
  summary:{...card.summary,[kind==='props'?'gradedProps':'markets']:current.length,play:plays.length,pending:pending.length,pass:passes.length},
  availability:'AVAILABLE',excludedFromCurrent:rows.length-current.length,rankingBasis:'MODEL_WIN_PROBABILITY'};
}

export function sportPropCard(sport) {
 return {availability:'USE_SPORT_RESEARCH',sport,
  reason:`The legacy graded prop card covers MLB. Open ${sport} research for that sport's quotes and verified decision status.`,
  researchUrl:sport==='NBA'?'/nba.html':sport==='NFL'?'/nfl.html':'/research.html',
  summary:{gradedProps:null,play:null,pending:null,pass:null},props:[],plays:[],pending:[],passes:[],recentResults:[]};
}
