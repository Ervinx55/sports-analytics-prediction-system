import {timingSafeEqual} from 'node:crypto';
import {protectedSportsGameOddsFetch,optimizeSportsGameOddsObjectLimit} from './provider-protection.js';
import {researchFreshness} from '../prop-price-checks.js';

const PAGE_SIZE=16,MAX_PAGES=2,MAX_AGE_MS=300000,WINDOW_MS=48*3600000;
const lineNumber=value=>{
 if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value.trim())))return null;
 const line=Number(value);return Number.isFinite(line)&&line>=0?line:null;
};
const emptyBody=()=>({contract:'nba-prizepicks-diagnostic-v1',book:'prizepicks',source:'SportsGameOdds',quotes:[],quoteCount:0,statCounts:{},complete:false,productionEligible:false,productionWeight:0});

// Accept the same provider event/roster bindings as NBA research, including
// newly introduced stat IDs. DFS line values are never single-pick odds.
export function normalizePrizePicks(events,{now=Date.now(),generatedAt=null,endsBefore=now+WINDOW_MS}={}){
 const quotes=[],counts=new Map(),seen=new Set();
 for(const event of Array.isArray(events)?events:[]){
  const startsAt=event?.status?.startsAt,start=Date.parse(startsAt);
  if(event?.leagueID!=='NBA'||event.type!=='match'||typeof event.eventID!=='string'||!event.eventID||
   !Number.isFinite(start)||start<=now||start>endsBefore||
   ['started','live','completed','finalized','cancelled','canceled','ended'].some(flag=>event.status?.[flag]))continue;
  const teams=[event.teams?.home?.teamID,event.teams?.away?.teamID];
  if(!teams.every(id=>typeof id==='string'&&id.endsWith('_NBA'))||teams[0]===teams[1])continue;
  for(const odd of Object.values(event.odds??{})){
   const playerID=odd?.playerID||odd?.statEntityID,player=event.players?.[playerID];
   const stat=odd?.statID,side=odd?.sideID,book=odd?.byBookmaker?.prizepicks;
   if(typeof playerID!=='string'||!playerID.endsWith('_NBA')||player?.playerID!==playerID||!teams.includes(player.teamID)||
    typeof stat!=='string'||!stat||stat.length>80||stat.trim()!==stat||!['over','under'].includes(side)||
    odd.periodID!=='game'||odd.betTypeID!=='ou'||odd.oddID!==`${stat}-${playerID}-game-ou-${side}`||book?.available!==true)continue;
   const line=lineNumber(book.overUnder);
   if(line===null)continue;
   const id=JSON.stringify([event.eventID,odd.oddID,line]);
   if(seen.has(id))continue;seen.add(id);
   counts.set(stat,(counts.get(stat)??0)+1);
   quotes.push({eventID:'sgo:'+event.eventID,startsAt,playerID,playerName:player.name||playerID,
    oddID:odd.oddID,stat,side,line,updatedAt:book.lastUpdatedAt??null,available:true,
    freshness:researchFreshness(book.lastUpdatedAt,generatedAt,now),
    source:'SportsGameOdds',book:'prizepicks',platformType:'dfs',odds:null,
    modelProbability:null,marketProbability:null,productionEligible:false,productionWeight:0});
  }
 }
 return {quotes,statCounts:Object.fromEntries(counts)};
}

function failure(error){
 const status=Number.isInteger(error?.status)?error.status:null;
 if(error?.objectBudgetBlocked===true)return {status:429,reason:'PRIZEPICKS_OBJECT_QUOTA_EXHAUSTED',objectBudgetBlocked:true};
 if(status===429)return {status,reason:'PRIZEPICKS_PROVIDER_RATE_LIMITED',budgetBlocked:error?.budgetBlocked===true};
 if(status===401||status===403)return {status:502,reason:'PRIZEPICKS_PROVIDER_ACCESS_DENIED',providerStatus:status};
 return {status:503,reason:'PRIZEPICKS_PROVIDER_UNAVAILABLE',...(status?{providerStatus:status}:{})};
}
const unavailable=error=>{
 const {status,...detail}=failure(error);
 return {status,body:{...emptyBody(),status:'UNAVAILABLE',reason:detail.reason,providerFailures:[detail]}};
};

export async function prizePicksDiagnosticResponse({now=null,
 key=process.env.SPORTS_ODDS_API_KEY||process.env.Sports_Game_Odds_API||'',
 fetchPage=protectedSportsGameOddsFetch,optimize=optimizeSportsGameOddsObjectLimit}={}){
 const clock=()=>now??Date.now();
 if(!key)return {status:503,body:{...emptyBody(),status:'UNAVAILABLE',reason:'PRIZEPICKS_PROVIDER_NOT_CONFIGURED'}};
 let objectPolicy;
 try{objectPolicy=await optimize({apiKey:key,requestedLimit:PAGE_SIZE,defaultLimit:PAGE_SIZE,priority:'background',fanout:MAX_PAGES});}
 catch{return unavailable();}
 if(objectPolicy?.blocked)return unavailable({objectBudgetBlocked:true});
 if(!Number.isFinite(objectPolicy?.effectiveLimit)||objectPolicy.effectiveLimit<1)return unavailable();
 const pageSize=Math.min(PAGE_SIZE,Math.floor(objectPolicy.effectiveLimit));
 const bucket=Math.floor(clock()/3600000)*3600000,endsBefore=bucket+WINDOW_MS;
 const params={leagueID:'NBA',bookmakerID:'prizepicks',type:'match',oddsAvailable:'true',finalized:'false',
  includeAltLines:'false',startsAfter:new Date(bucket).toISOString(),startsBefore:new Date(endsBefore).toISOString(),limit:String(pageSize)};
 const events=new Map(),times=[],reasons=[],seenCursors=new Set(),providerFailures=[],cacheStatuses=[];
 let cursor=null,pagesFetched=0,complete=false;
 for(let pageIndex=0;pageIndex<MAX_PAGES;pageIndex++){
  try{
   const result=await fetchPage({url:'https://api.sportsgameodds.com/v2/events?'+new URLSearchParams({...params,...(cursor?{cursor}:{})}),
    apiKey:key,consumer:'nba-prizepicks-diagnostic',priority:'background',freshMs:60000,staleMs:MAX_AGE_MS,timeoutMs:8000,objectPolicy});
   if([401,403].includes(result?.upstreamError?.status))return unavailable(result.upstreamError);
   const checkedAt=clock();
   if(result?.payload?.success!==true||!Array.isArray(result.payload.data)||result.payload.data.length>pageSize||
    !Number.isFinite(result.fetchedAt)||result.fetchedAt>checkedAt||checkedAt-result.fetchedAt>MAX_AGE_MS)throw Error('Invalid provider response');
   pagesFetched++;times.push(result.fetchedAt);cacheStatuses.push(result.cacheStatus??null);
   if(result.upstreamError)providerFailures.push({...failure(result.upstreamError),reason:'PROVIDER_REFRESH_FAILED'});
   for(const event of result.payload.data)if(typeof event?.eventID==='string'&&!events.has(event.eventID))events.set(event.eventID,event);
   const next=result.payload.nextCursor;
   if(next===null||next===undefined||next===''){complete=true;cursor=null;break;}
   if(typeof next!=='string'||next.length>2048||seenCursors.has(next)){reasons.push('INVALID_CURSOR');break;}
   cursor=next;seenCursors.add(next);
   if(pageIndex===MAX_PAGES-1)reasons.push('PAGE_LIMIT_REACHED');
  }catch(error){
   if(!pagesFetched||[401,403].includes(error?.status))return unavailable(error);
   reasons.push('PAGE_UNAVAILABLE');providerFailures.push(failure(error));break;
  }
 }
 const checkedAt=clock(),fetchedAt=new Date(Math.min(...times)).toISOString();
 const normalized=normalizePrizePicks([...events.values()],{now:checkedAt,generatedAt:fetchedAt,endsBefore});
 const {quotes}=normalized;
 return {status:200,body:{...emptyBody(),...normalized,
  status:quotes.length?(providerFailures.length?'PROVIDER_DEGRADED':complete?'QUOTES_AVAILABLE':'PARTIAL_QUOTES'):'NO_QUOTES_RETURNED',
  quoteCount:quotes.length,fetchedAt,generatedAt:fetchedAt,checkedAt:new Date(checkedAt).toISOString(),complete,
  partialCoverage:true,coverage:{pagesFetched,eventsComplete:complete,reasons,providerEvents:events.size,
   returnedEvents:new Set(quotes.map(quote=>quote.eventID)).size,bookmakers:['prizepicks'],markets:Object.keys(normalized.statCounts)},
  sourceHealth:{freshQuoteSides:quotes.filter(quote=>quote.freshness==='CURRENT').length,
   staleQuoteSides:quotes.filter(quote=>quote.freshness==='STALE').length,unknownTimeQuoteSides:quotes.filter(quote=>quote.freshness==='UNKNOWN').length},
  cache:{statuses:cacheStatuses,fetchedAt},providerFailures,
  scope:'NBA main-line PrizePicks props returned by the existing SportsGameOdds account; next 48 hours; at most 32 provider events. Missing quotes do not establish missing entitlement.',
  note:'Entry payouts, settlement rules and player predictions are unverified. No prop play is cleared.'}};
}

export async function prizePicksDiagnosticHandler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'GET required'});}
 const token=process.env.SHARP_MONITOR_TOKEN,supplied=req.headers?.['x-monitor-token'];
 if(!token)return res.status(503).json({...emptyBody(),status:'UNAVAILABLE',reason:'MONITOR_AUTH_UNAVAILABLE'});
 if(typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))
  return res.status(401).json({error:'Unauthorized',productionEligible:false,productionWeight:0});
 const {status,body}=await prizePicksDiagnosticResponse();
 return res.status(status).json(body);
}
