import {protectedSportsGameOddsFetch,optimizeSportsGameOddsObjectLimit} from './provider-protection.js';
import {bookCoverage,bookmakerIds} from './bookmakers.js';
import {PROP_BOOKS,platformType,assessPropQuote} from '../prop-price-checks.js';
import {canonicalBookmaker} from '../book-catalog.js';
const MARKET_SCOPE={NBA:['points','rebounds','assists'],NFL:['passing_yards','passing_touchdowns','rushing_yards','receiving_receptions','receiving_yards']},PAGE_SIZE=16,MAX_PAGES=2;
const number=value=>{
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(typeof value!=='string'||!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))return null;
 const n=Number(value);return Number.isFinite(n)?n:null;
};
function researchCoverage(books,quotes,now){
 const coverage=bookCoverage({requestedBooks:books,quotes,now});
 return {...coverage,books:coverage.books.map(row=>{
  const lines=quotes.filter(q=>q.book===row.id&&q.price.available===true&&Number.isFinite(q.price.line));
  return {...row,availableQuoteSides:lines.length,freshQuoteSides:lines.filter(q=>q.price.priceCheck.freshness==='CURRENT').length,comparablePriceSides:lines.filter(q=>q.price.priceCheck.status==='COMPARABLE').length};
 }),availabilityBasis:'Provider line availability; comparablePriceSides is separate from line freshness.'};
}

function normalizeEvent(e,now,books,league,markets){
 const startsAt=e?.status?.startsAt;
 if(e?.leagueID!==league||e.type!=='match'||!e.eventID||!(Date.parse(startsAt)>now)||['started','live','completed','finalized','cancelled','canceled','ended'].some(k=>e.status?.[k]))return null;
 const teams=[e.teams?.home?.teamID,e.teams?.away?.teamID];
 if(!teams.every(t=>typeof t==='string'&&t.endsWith('_'+league))||teams[0]===teams[1])return null;
 const props=new Map();
 for(const o of Object.values(e.odds??{})){
  if(!o)continue;
  const playerID=o.playerID||o.statEntityID,side=o.sideID,market=o.statID,player=e.players?.[playerID];
  if(typeof playerID!=='string'||!playerID.endsWith('_'+league)||player?.playerID!==playerID||!teams.includes(player.teamID)||!markets.includes(market)||!['over','under'].includes(side)||o.periodID!=='game'||o.betTypeID!=='ou'||o.oddID!==`${market}-${playerID}-game-ou-${side}`)continue;
  const entries=Object.entries(o.byBookmaker??{}),counts=new Map();
  for(const [id] of entries){const book=canonicalBookmaker(id);counts.set(book,(counts.get(book)||0)+1);}
  for(const [native,b] of entries){
   const book=canonicalBookmaker(native);
   if(!book||counts.get(book)!==1||(books.length&&!books.includes(book)))continue;
   const line=number(b?.overUnder);
   if(!b||b.available!==true||line===null||line<0)continue;
   const key=JSON.stringify([playerID,market,line]),type=platformType(book),nativeOdds=number(b.odds);
   if(!props.has(key))props.set(key,{playerID,playerName:player.name||playerID,statID:market,identityStatus:'PROVIDER_ROSTER_MATCHED'});
   const prop=props.get(key);prop[side]??={books:{}};
   prop[side].books[book]={line,odds:type==='sportsbook'?nativeOdds:null,indicativeOdds:type==='sportsbook'?null:nativeOdds,available:true,updatedAt:b.lastUpdatedAt??null,platformType:type};
  }
 }
 if(!props.size)return null;
 const eventID=league==='NBA'?'sgo:'+e.eventID:e.eventID;
 return {eventID,provider:'SportsGameOdds',startsAt,matchup:{home:{name:e.teams.home.names?.long??e.teams.home.names?.medium??null},away:{name:e.teams.away.names?.long??e.teams.away.names?.medium??null}},players:[...props.values()].map(prop=>{
  const teamId=e.players[prop.playerID].teamID;
  return {prop,explanationBinding:{contract:'sgo-event-roster-v1',eventID,playerID:prop.playerID,startsAt,teamId,opponentTeamId:teams.find(t=>t!==teamId)}};
 })};
}

export async function researchPropsResponse({now=null,key=process.env.SPORTS_ODDS_API_KEY||process.env.Sports_Game_Odds_API||'',fetchPage=protectedSportsGameOddsFetch,requestedBooks=[],league='NBA',optimize=optimizeSportsGameOddsObjectLimit}={}){
 const clock=()=>now??Date.now();
 const books=bookmakerIds(requestedBooks),unsupported=books.filter(b=>platformType(b)==='unknown');
 const markets=MARKET_SCOPE[league];
 if(!markets)return {status:400,body:{error:'UNSUPPORTED_RESEARCH_LEAGUE',productionEligible:false,productionWeight:0}};
 const empty={contract:league.toLowerCase()+'-multibook-research-v1',events:[],...(league==='NFL'?{candidates:[]}:{}),productionEligible:false,productionWeight:0};
 if(unsupported.length)return {status:400,body:{...empty,error:'UNSUPPORTED_RESEARCH_BOOK',unsupportedRequested:unsupported}};
 const unavailable=()=>({status:503,body:{...empty,status:'UNAVAILABLE',reason:league+'_RESEARCH_QUOTES_UNAVAILABLE',bookCoverage:{...bookCoverage({requestedBooks:books,now:clock()}),configured:books}}});
 if(!key)return unavailable();
 let objectPolicy;
 try{objectPolicy=await optimize({apiKey:key,requestedLimit:PAGE_SIZE,defaultLimit:PAGE_SIZE,priority:'background',fanout:MAX_PAGES});}catch{return unavailable();}
 if(objectPolicy.blocked)return {status:429,body:{...empty,status:'UNAVAILABLE',reason:league+'_RESEARCH_OBJECT_QUOTA_EXHAUSTED',providerFailures:[{objectBudgetBlocked:true}]}};
 const pageSize=Math.max(1,Math.min(PAGE_SIZE,Math.floor(objectPolicy.effectiveLimit)||PAGE_SIZE));
 const bucket=Math.floor(clock()/3600000)*3600000;
 const params={leagueID:league,type:'match',oddIDs:markets.flatMap(m=>['over','under'].map(s=>`${m}-PLAYER_ID-game-ou-${s}`)).join(','),...(books.length?{bookmakerID:books.join(',')}:{}),oddsAvailable:'true',finalized:'false',includeAltLines:'false',startsAfter:new Date(bucket).toISOString(),startsBefore:new Date(bucket+48*3600000).toISOString(),limit:String(pageSize)};
 const raw=new Map(),times=[],reasons=[],seenCursors=new Set();let cursor=null,pagesFetched=0,eventsComplete=false;
 for(let i=0;i<MAX_PAGES;i++){
  try{
   const result=await fetchPage({url:'https://api.sportsgameodds.com/v2/events?'+new URLSearchParams({...params,...(cursor?{cursor}:{})}),apiKey:key,consumer:league.toLowerCase()+'-research-quotes',priority:'background',freshMs:60000,staleMs:300000,timeoutMs:8000,objectPolicy});
   const checkedAt=clock();
   if(result.payload?.success!==true||!Array.isArray(result.payload.data)||result.payload.data.length>pageSize||!Number.isFinite(result.fetchedAt)||result.fetchedAt>checkedAt||checkedAt-result.fetchedAt>300000)throw Error('Invalid provider response');
   pagesFetched++;times.push(result.fetchedAt);
   for(const e of result.payload.data)if(e?.eventID&&!raw.has(e.eventID))raw.set(e.eventID,e);
   const next=result.payload.nextCursor;
   if(!next){eventsComplete=true;break;}
   if(typeof next!=='string'||seenCursors.has(next)){reasons.push('INVALID_CURSOR');break;}
   seenCursors.add(next);cursor=next;if(i===MAX_PAGES-1)reasons.push('PAGE_LIMIT_REACHED');
  }catch{if(!pagesFetched)return unavailable();reasons.push('PAGE_UNAVAILABLE');break;}
 }
 const evaluatedAt=clock(),generatedAt=new Date(Math.min(...times)).toISOString(),events=[...raw.values()].map(e=>normalizeEvent(e,evaluatedAt,books,league,markets)).filter(Boolean),quotes=[];
 for(const e of events)for(const p of e.players)for(const side of ['over','under'])for(const [book,price] of Object.entries(p.prop[side]?.books??{})){
  price.priceCheck=assessPropQuote({book,quote:price,opposite:p.prop[side==='over'?'under':'over']?.books?.[book],generatedAt,now:evaluatedAt});quotes.push({book,price});
 }
 const configured=bookmakerIds([...books,...PROP_BOOKS,...quotes.map(q=>q.book)]);
 return {status:200,body:{...empty,events,generatedAt,source:'SportsGameOdds',scope:league+' all-book research; main lines only; 48-hour window. Frozen validation collection unchanged.',partialCoverage:true,coverage:{pagesFetched,eventsComplete,reasons,returnedEvents:events.length,providerEvents:raw.size,bookmakers:books.length?books:'account-entitled bookmakers',markets},bookCoverage:{...researchCoverage(books,quotes,evaluatedAt),configured,scope:'Returned research lines only. The displayed list includes monitored platforms and observed books; missing lines do not establish missing entitlement. DFS and exchange execution terms remain separate.'}}};
}
