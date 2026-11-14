// Research diagnostics only. Never authorizes a play or supplies a model probability.
import {bookLabel,platformType} from './book-catalog.js';
export {bookLabel,platformType} from './book-catalog.js';
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
export const PROP_BOOKS=['pinnacle','circa','bookmakereu','draftkings','bovada','prizepicks','underdog','kalshi'];
export function researchFreshness(stamp,generatedAt,now=Date.now()){
 const times=[stamp,generatedAt].map(v=>typeof v==='string'?Date.parse(v):NaN);
 if(times.some(t=>!Number.isFinite(t)||t>now))return 'UNKNOWN';
 return times.some(t=>now-t>300000)?'STALE':'CURRENT';
}
export function assessPropQuote({book,quote,opposite,generatedAt,now=Date.now()}){
 const type=platformType(book),freshness=researchFreshness(quote?.updatedAt,generatedAt,now),reasons=[];
 if(quote?.available!==true)reasons.push('Quote availability is not confirmed.');
 if(freshness!=='CURRENT')reasons.push(freshness==='STALE'?'Quote is over five minutes old.':'Quote update time is missing, invalid, or in the future.');
 if(num(quote?.line)===null||quote.line<0)reasons.push('Exact prop line is missing.');
 const result={platformType:type,freshness,marketProbability:null,breakEvenProbability:null,productionEligible:false,reasons,status:'NOT_COMPARABLE'};
 if(type==='dfs'){
  reasons.push('Actual entry payout table and entry type are required.','Pick multipliers, promotions and correlation adjustments must match the submitted entry.','Check tie, DNP, reboot and void rules; indicative odds are not an executable single-pick price.');
  return {...result,status:'TERMS_MISSING',summary:'Line available for research; entry payout is not verified.'};
 }
 if(type==='exchange'){
  reasons.push('Exact '+bookLabel(book)+' contract and outcome mapping are missing.','Executable ask, order-book depth and quantity are unverified.','Contract fees and settlement rules are unverified.');
  return {...result,status:'TERMS_MISSING',summary:'Indicative contract quote only; execution cost is not verified.'};
 }
 if(type!=='sportsbook')return {...result,summary:'Platform price format is unverified.'};
 const validPrice=q=>num(q?.odds)!==null&&Math.abs(q.odds)>=100;
 if(!validPrice(quote))reasons.push('Valid American price is missing.');
 const oppositeReady=opposite?.available===true&&validPrice(opposite)&&opposite.line===quote?.line&&researchFreshness(opposite.updatedAt,generatedAt,now)==='CURRENT';
 if(!oppositeReady)reasons.push('Fresh opposite-side price at this exact book and line is missing.');
 if(Number.isInteger(quote?.line))reasons.push('This integer line can push; an unconditional win probability requires push modeling.');
 if(reasons.length)return {...result,summary:reasons[0]};
 const implied=o=>o>0?100/(o+100):-o/(-o+100),a=implied(quote.odds),b=implied(opposite.odds);
 return {...result,status:'COMPARABLE',marketProbability:a/(a+b),breakEvenProbability:a,summary:'Fresh same-book opposing prices at the same line. Price comparison only; no play is cleared.'};
}

export function checkDfsPayout({book,mode,stake,picks,multipliers,termsReviewed}){
 const incomplete={status:'INCOMPLETE',netReturns:[],allHitBreakEven:null,expectedValue:null,productionEligible:false,summary:'Enter the complete cash-return schedule and confirm the worksheet assumptions.'};
 if(platformType(book)!=='dfs'||!['all_or_nothing','flex'].includes(mode)||num(stake)===null||stake<=0||stake>1000000||!Number.isInteger(picks)||picks<2||picks>8||!Array.isArray(multipliers)||multipliers.length!==picks+1||multipliers.some(m=>num(m)===null||m<0||m>1000000)||termsReviewed!==true)return incomplete;
 if(mode==='all_or_nothing'&&(multipliers.slice(0,-1).some(m=>m!==0)||multipliers.at(-1)<=1))return incomplete;
 return {status:'USER_ENTERED',netReturns:multipliers.map(m=>stake*(m-1)),allHitBreakEven:mode==='all_or_nothing'?1/multipliers.at(-1):null,expectedValue:null,productionEligible:false,summary:'Entered terms only, not provider verified. Applies only when every pick settles win/loss and payouts depend solely on the number of correct picks. Joint outcome probabilities are unavailable; no expected profit or play approval is calculated.'};
}
