export const PERFORMANCE_SPORTS=['MLB','NFL','NBA','CFB','NHL','TENNIS','SOCCER'];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const timestamp=value=>typeof value==='string'?Date.parse(value):NaN;
const lexical=(a,b)=>String(a)<String(b)?-1:String(a)>String(b)?1:0;
const ordered=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
function date(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)||!Number.isFinite(timestamp(value)))throw Error('Invalid date');
 const day=value.slice(0,10);if(new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw Error('Invalid date');
 return new Date(value).toISOString();
}
export function parsePerformanceFilters(input={},now=new Date()){
 const sport=input.sport?String(input.sport).toUpperCase():null,cohort=input.cohort||'ALL',kind=input.kind||'ALL';
 if(sport&&!PERFORMANCE_SPORTS.includes(sport))throw Error('Invalid sport');
 if(!['ALL','PLAY','SHADOW','PASS','LEGACY','DIAGNOSTIC'].includes(cohort)||!['ALL','TEAM','PROP'].includes(kind))throw Error('Invalid cohort or kind');
 const to=input.to?date(input.to):now.toISOString(),from=input.from?date(input.from):new Date(timestamp(to)-30*86400000).toISOString();
 if(timestamp(from)>=timestamp(to))throw Error('Invalid date interval');
 const cursor=String(input.cursor??'0'),limit=Number(input.limit??100);
 if(!/^\d+$/.test(cursor)||!Number.isSafeInteger(Number(cursor))||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Invalid pagination');
 for(const name of ['market','modelVersion'])if(input[name]!=null&&(typeof input[name]!=='string'||!input[name].trim()||input[name].length>200))throw Error('Invalid filter');
 return {sport,cohort,kind,from,to,market:input.market??null,modelVersion:input.modelVersion??null,cursor:Number(cursor),limit};
}
function matches(p,f){return (!f.sport||p.sport===f.sport)&&(!f.market||p.marketType===f.market)&&(!f.modelVersion||p.modelVersion===f.modelVersion)&&(!f.kind||f.kind==='ALL'||(f.kind==='PROP')===p.marketType?.startsWith('player_'))&&(!f.from||timestamp(p.capturedAt)>=timestamp(f.from))&&(!f.to||timestamp(p.capturedAt)<timestamp(f.to));}
const exactKey=p=>p.marketKey??JSON.stringify([p.sport,p.eventKey,p.playerKey,p.marketType,p.side,p.line,p.modelVersion,p.modelMode,p.marketScope]);
function eligible(p){return p.valid!==false&&p.modelAvailable===true&&!(p.eligibilityReasons?.length)&&timestamp(p.capturedAt)<timestamp(p.eligibilityStartsAt??p.startsAt)&&timestamp(p.quoteAt)<=timestamp(p.capturedAt);}
function portfolioKey(p){
 // Half hits and half total bases are equivalent only for the same saved scope and side.
 if(p.sport==='MLB'&&p.line===.5&&['player_hits','player_total_bases','player_batting_hits','player_batting_totalBases'].includes(p.marketType)){
  const rule=p.settlementRule?Object.fromEntries(Object.entries(p.settlementRule).filter(([key])=>key!=='book')):null;
  return JSON.stringify([p.sport,p.eventKey,p.playerKey,'half-hit',p.side,p.modelVersion,p.modelMode,ordered(p.marketScope??null),ordered(rule)]);
 }
 return exactKey(p);
}
export function selectCohort(predictions,decisions=[],settlements=[],filters={}){
 const cohort=filters.cohort??'ALL',latest=new Map(),byPrediction=new Map();
 for(const s of settlements)if(!latest.has(s.predictionId)||s.revision>latest.get(s.predictionId).revision)latest.set(s.predictionId,s);
 for(const d of decisions){const list=byPrediction.get(d.predictionId)??[];list.push(d);byPrediction.set(d.predictionId,list);}
 const selected=new Map();
 for(const p of predictions){
  if(!matches(p,filters))continue;
  const ds=byPrediction.get(p.id)??[];
  if(cohort==='DIAGNOSTIC'){if(!eligible(p))selected.set(p.id,{...p});continue;}
  if(!eligible(p))continue;
  let decision=null;
  if(cohort==='SHADOW'){if(p.modelMode!=='SHADOW')continue;}
  else if(cohort==='LEGACY'){decision=ds.filter(d=>d.legacyReconstructed).sort((a,b)=>timestamp(a.issuedAt)-timestamp(b.issuedAt)||lexical(a.id,b.id))[0];if(!decision)continue;}
  else {if(p.modelMode!=='LIVE')continue;
   if(cohort==='PLAY'){decision=ds.filter(d=>d.status==='PLAY'&&d.qualified&&d.firstIssued===true&&!d.legacyReconstructed&&timestamp(d.issuedAt)>=timestamp(p.capturedAt)&&timestamp(d.issuedAt)<timestamp(p.eligibilityStartsAt??p.startsAt)).sort((a,b)=>timestamp(a.issuedAt)-timestamp(b.issuedAt)||lexical(a.id,b.id))[0];if(!decision)continue;}
   if(cohort==='PASS'){decision=ds.filter(d=>d.status==='PASS'&&!d.legacyReconstructed&&timestamp(d.issuedAt)<timestamp(p.eligibilityStartsAt??p.startsAt)).sort((a,b)=>timestamp(b.issuedAt)-timestamp(a.issuedAt)||lexical(a.id,b.id))[0];if(!decision)continue;}
  }
  const row={...p,decisionId:decision?.id??null,issuedAt:decision?.issuedAt??null,legacyReconstructed:decision?.legacyReconstructed??false},key=cohort==='PLAY'?portfolioKey(p):exactKey(p),previous=selected.get(key);
  const earlier=cohort==='PLAY'||cohort==='LEGACY',a=timestamp(earlier?row.issuedAt:row.capturedAt),b=previous?timestamp(earlier?previous.issuedAt:previous.capturedAt):NaN;
  if(!previous||(earlier?a<b:a>b)||(a===b&&lexical(exactKey(row)+'|'+row.sourceKey,exactKey(previous)+'|'+previous.sourceKey)<0))selected.set(key,row);
 }
 return [...selected.values()].map(p=>{const s=latest.get(p.id);return {...p,outcome:s?.outcome??'UNRESOLVED',settlementRevision:s?.revision??null,settlementReason:s?.reason??null};}).sort((a,b)=>lexical(exactKey(a),exactKey(b))||lexical(a.id,b.id));
}
function pair(row){
 if(row.valid===false||!['WIN','LOSS'].includes(row.outcome)||!finite(row.modelProbability)||!finite(row.marketProbability))return null;
 let model=row.modelProbability,market=row.marketProbability;
 if(row.probabilityBasis==='UNCONDITIONAL'){
  if(!finite(row.pushProbability)||row.pushProbability<0||row.pushProbability>=1)return null;
  model/=1-row.pushProbability;
 }else if(row.probabilityBasis!=='CONDITIONAL_NO_PUSH')return null;
 // Saved marketProbability is the conditional no-push quote. Never silently transform it twice.
 if(model<0||model>1||market<0||market>1)return null;
 const y=row.outcome==='WIN'?1:0,loss=p=>-y*Math.log(Math.max(1e-6,Math.min(1-1e-6,p)))-(1-y)*Math.log(1-Math.max(1e-6,Math.min(1-1e-6,p)));
 return {row,model,market,y,modelBrier:(model-y)**2,marketBrier:(market-y)**2,modelLogLoss:loss(model),marketLogLoss:loss(market)};
}
function basic(rows){
 rows=rows.filter(r=>r.valid!==false);
 const counts={wins:0,losses:0,pushes:0,voids:0,unresolved:0};const names={WIN:'wins',LOSS:'losses',PUSH:'pushes',VOID:'voids',UNRESOLVED:'unresolved'};let pricedCount=0,profit=0;
 for(const r of rows){counts[names[r.outcome]??'unresolved']++;if(r.valid!==false&&['WIN','LOSS','PUSH'].includes(r.outcome)&&finite(r.odds)&&Math.abs(r.odds)>=100){pricedCount++;profit+=r.outcome==='LOSS'?-1:r.outcome==='PUSH'?0:r.odds>0?r.odds/100:100/-r.odds;}}
 const paired=rows.map(pair).filter(Boolean),binary=counts.wins+counts.losses;
 return {...counts,count:rows.length,winRate:binary?counts.wins/binary:null,distinctGames:new Set(rows.filter(r=>r.eventKey!=null).map(r=>JSON.stringify([r.sport,r.eventKey]))).size,pricedCount,hypotheticalUnitProfit:pricedCount?profit:null,hypotheticalRoi:pricedCount?profit/pricedCount:null,pairedCount:paired.length,modelBrier:mean(paired.map(p=>p.modelBrier)),marketBrier:mean(paired.map(p=>p.marketBrier)),modelLogLoss:mean(paired.map(p=>p.modelLogLoss)),marketLogLoss:mean(paired.map(p=>p.marketLogLoss))};
}
function uncertainty(pairs){
 const blocks=new Map();for(const p of pairs){const key=JSON.stringify([p.row.sport,p.row.eventKey]);const list=blocks.get(key)??[];list.push(p);blocks.set(key,list);}
 const games=[...blocks.entries()].sort((a,b)=>lexical(a[0],b[0])).map(([,list])=>({count:list.length,brier:list.reduce((a,p)=>a+p.modelBrier-p.marketBrier,0),log:list.reduce((a,p)=>a+p.modelLogLoss-p.marketLogLoss,0)})),metadata={method:'SEEDED_GAME_BLOCK_BOOTSTRAP',seed:20261006,resamples:2000,confidence:.95,games:games.length};
 if(games.length<2)return {...metadata,status:'INSUFFICIENT_GAMES',brierDifference:null,logLossDifference:null};
 let seed=metadata.seed;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},brier=[],log=[];
 for(let i=0;i<2000;i++){let n=0,b=0,l=0;for(let j=0;j<games.length;j++){const game=games[Math.floor(random()*games.length)];n+=game.count;b+=game.brier;l+=game.log;}brier.push(b/n);log.push(l/n);}
 const interval=v=>{v.sort((a,b)=>a-b);return [v[49],v[1949]];};return {...metadata,status:'AVAILABLE',brierDifference:interval(brier),logLossDifference:interval(log)};
}
export function summarizePerformance(rows,options={}){
 const paired=rows.map(pair).filter(Boolean),reliabilityBins=Array.from({length:10},(_,i)=>{const list=paired.filter(p=>Math.min(9,Math.floor(p.model*10))===i),market=paired.filter(p=>Math.min(9,Math.floor(p.market*10))===i);return {lower:i/10,upper:(i+1)/10,count:list.length,meanModelProbability:mean(list.map(p=>p.model)),meanMarketProbability:mean(list.map(p=>p.market)),observedWinRate:mean(list.map(p=>p.y)),model:{count:list.length,meanProbability:mean(list.map(p=>p.model)),observedWinRate:mean(list.map(p=>p.y))},market:{count:market.length,meanProbability:mean(market.map(p=>p.market)),observedWinRate:mean(market.map(p=>p.y))}};});
 const grouped=new Map();for(const r of rows){const key=JSON.stringify([r.sport,r.marketType,r.modelVersion,r.modelMode]);const list=grouped.get(key)??[];list.push(r);grouped.set(key,list);}
 const offset=options.cursor??0,limit=options.limit??100;
 return {generatedAt:options.generatedAt??null,filters:options.filters??{},summary:basic(rows),groups:[...grouped.values()].map(list=>({sport:list[0].sport,market:list[0].marketType,modelVersion:list[0].modelVersion,modelMode:list[0].modelMode,...basic(list)})),reliabilityBins,uncertainty:uncertainty(paired),rows:rows.slice(offset,offset+limit).map(publicRow),nextCursor:offset+limit<rows.length?String(offset+limit):null,metadata:{portfolioDedupe:'PLAY half hits/total bases: same event/player/side/model/scope/settlement semantics and version, book binding ignored; earliest issuance then lexical exact market key',logLossClip:1e-6,roi:'HYPOTHETICAL_ONE_UNIT_AT_SAVED_AMERICAN_ODDS',marketProbabilityBasis:'CONDITIONAL_NO_PUSH',independentSkillEvidence:false,skillInterpretation:'Saved estimates may be market anchored; paired comparisons alone do not establish independent model skill',aggregation:'ALL_MATCHED_ROWS',actualWagerProfitAvailable:false},coverage:{selected:rows.length,paired:paired.length,missingPaired:rows.length-paired.length,complete:false,state:rows.length?'SAMPLES':'NO_SAMPLES'},warnings:[]};
}
export function publicRow(r){
 const result=Object.fromEntries(['id','sport','eventKey','playerKey','marketType','side','line','modelVersion','modelMode','modelAvailable','capturedAt','startsAt','issuedAt','odds','book','modelProbability','marketProbability','pushProbability','probabilityBasis','outcome','settlementRevision','legacyReconstructed','competitionKey','tour'].map(k=>[k,r[k]??null]));
 const token=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(v);
 result.eligibilityReasons=(r.eligibilityReasons??[]).filter(token);result.settlementReason=token(r.settlementReason)?r.settlementReason:null;
 result.marketScope=r.marketScope?Object.fromEntries(['period','unit','set','game'].map(k=>[k,r.marketScope[k]??null])):null;
 return result;
}
