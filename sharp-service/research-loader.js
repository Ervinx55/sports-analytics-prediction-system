import {normalizeResearch} from './research-data.js';
import {normalizeGameResearch} from './research-comparison.js';
import {researchFreshness} from './prop-price-checks.js';
export function createResearchLoader({fetchImpl=fetch,onChange=()=>{},now=Date.now}={}){
 let state={sport:'NBA',kind:'props',status:'idle',rows:[],message:''},sequence=0,controller;
 return {get state(){return state;},async load(sport,kind='props'){
  if(!['props','games'].includes(kind)||(kind==='props'?!['NBA','NFL'].includes(sport):!(/^[A-Z0-9][A-Z0-9_-]{0,39}$/).test(sport)))throw Error('Unsupported sport or view');
  const current=++sequence;controller?.abort();const request=new AbortController();controller=request;
  state={sport,kind,status:'loading',rows:[],message:'Loading current research…'};onChange(state);
  const timer=setTimeout(()=>request.abort(),45000);
  const get=async(url,signal=request.signal)=>{const response=await fetchImpl(url,{signal,cache:'no-store'});return {response,data:await response.json()};};
  let estimateController,estimateTimer,abortEstimate;
  try{
   const bucket=Math.floor(now()/3600000)*3600000;
   const gameParams=new URLSearchParams({view:'research',leagues:sport,limit:'16',startsAfter:new Date(bucket).toISOString(),startsBefore:new Date(bucket+48*3600000).toISOString()});
   const quoteRequest=get(kind==='games'?'/api/board?'+gameParams:`/api/${sport==='NBA'?'nba':'nfl'}props?view=research`);
   let modelRequest=Promise.resolve(null);
   if(kind==='props'&&sport==='NFL'){
    estimateController=new AbortController();abortEstimate=()=>estimateController.abort();request.signal.addEventListener('abort',abortEstimate,{once:true});
    estimateTimer=setTimeout(abortEstimate,40000);
    modelRequest=get('/api/nflprops?view=estimates',estimateController.signal).catch(()=>null);
   }
   const quoteResult=await quoteRequest;
   if(current!==sequence)return;
   const {response,data}=quoteResult;
   if(!response.ok&&response.status===429&&Array.isArray(data?.providerFailures)&&data.providerFailures.some(f=>f?.objectBudgetBlocked===true)){
    state={sport,kind,status:'error',rows:[],message:'Provider quota is exhausted. Live quotes are unavailable until quota resets or another configured provider supplies data. Repeated refreshes will not restore the exhausted quota.'};return;
   }
   if(!response.ok||request.signal.aborted)throw Error('Unavailable');
   const identity=data.sourceHealth?.playerIdentity,count=v=>Number.isSafeInteger(v)&&v>=0?v:0;
   let message=identity?count(identity.matched)+' roster-matched market records; '+count(identity.excluded)+' withheld for roster mismatch or ambiguity; '+count(identity.unverified)+' unverified. ':'';
   if(data.coverage?.eventsComplete===false||data.providerObservations?.some(p=>p.eventsComplete===false))message+='Partial provider coverage: some games could not be collected in this bounded refresh. ';
   if(kind==='games'&&data.unavailableLeagues?.some(p=>p.league===sport))throw Error('League unavailable');
   const ready=message=>{
    const rows=kind==='games'?normalizeGameResearch(data,sport,now()):normalizeResearch(data,sport,now());
    const bookCoverage=kind==='games'?{...data.bookCoverage,configured:[...new Set(rows.map(r=>r.book))].sort()}:data.bookCoverage??null;
    state={sport,kind,status:'ready',rows,generatedAt:data.generatedAt||data.fetchedAt,provider:data.oddsProvider||data.source,bookCoverage,message};
   };
   if(kind==='props'&&sport==='NFL'){
    data.candidates=[];
    ready(message+'Quotes loaded. Frozen NFL estimates are loading… ');onChange(state);
    const modelResult=await modelRequest;
    if(current!==sequence)return;
    const model=modelResult?.data;
    const usable=modelResult?.response.ok&&Array.isArray(model?.candidates)&&model.oddsProvider===data.source&&researchFreshness(model.generatedAt,model.generatedAt,now())==='CURRENT';
    data.candidates=usable?model.candidates:[];
    if(!usable)message+='Frozen model estimates are unavailable; current quotes can still be researched. ';
   }
   ready(message);
  }catch{if(current!==sequence)return;state={sport,kind,status:'error',rows:[],message:'Research unavailable. The provider request failed or timed out. Refresh to retry.'};}
  finally{clearTimeout(timer);clearTimeout(estimateTimer);if(abortEstimate)request.signal.removeEventListener('abort',abortEstimate);estimateController?.abort();if(current===sequence)onChange(state);}
 }};
}
