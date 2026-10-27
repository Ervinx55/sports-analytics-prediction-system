import {normalizeResearch} from './research-data.js';
export function createResearchLoader({fetchImpl=fetch,onChange=()=>{},now=Date.now}={}){
 let state={sport:'NBA',status:'idle',rows:[],message:''},sequence=0,controller;
 return {get state(){return state;},async load(sport){
  if(!['NBA','NFL'].includes(sport))throw Error('Unsupported sport');
  const current=++sequence;controller?.abort();const request=new AbortController();controller=request;
  state={sport,status:'loading',rows:[],message:'Loading current research…'};onChange(state);
  const timer=setTimeout(()=>request.abort(),45000);
  try{const response=await fetchImpl(`/api/${sport==='NBA'?'nbaprops':'nflprops'}`,{signal:request.signal,cache:'no-store'});const data=await response.json();
   if(current!==sequence)return;
   if(!response.ok && response.status===429 && Array.isArray(data?.providerFailures) && data.providerFailures.some(f=>f?.objectBudgetBlocked===true)){
    state={sport,status:'error',rows:[],message:'Provider quota is exhausted. Live prop quotes are unavailable until quota resets or another configured provider supplies data. Repeated refreshes will not restore the exhausted quota.'};return;
   }
   if(!response.ok||request.signal.aborted)throw Error('Unavailable');
   state={sport,status:'ready',rows:normalizeResearch(data,sport,now()),generatedAt:data.generatedAt,provider:data.oddsProvider,message:''};
  }catch{if(current!==sequence)return;state={sport,status:'error',rows:[],message:'Research unavailable. The provider request failed or timed out. Refresh to retry.'};}
  finally{clearTimeout(timer);if(current===sequence)onChange(state);}
 }};
}
