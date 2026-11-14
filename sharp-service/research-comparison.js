import {platformType,canonicalBookmaker} from './book-catalog.js';
import {researchFreshness,assessPropQuote} from './prop-price-checks.js';
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(v.trim())?Number(v):null;
const implied=o=>o>0?100/(o+100):-o/(-o+100);
const shapes={moneyline:{bet:'ml',sides:['home','away']},spread:{bet:'sp',sides:['home','away']},total:{bet:'ou',sides:['over','under']},threeWay:{bet:'ml3way',sides:['home','away','draw']}};
const validPrice=q=>q?.available===true&&typeof q.odds==='number'&&Number.isFinite(q.odds)&&Math.abs(q.odds)>=100;
export function assessGameQuote(row,now=Date.now()){
 const q=row.priceQuote,freshness=researchFreshness(q?.updatedAt,row.generatedAt,now),reasons=[];
 const result={platformType:platformType(row.book),freshness,marketProbability:null,breakEvenProbability:null,productionEligible:false,status:'NOT_COMPARABLE',reasons};
 if(result.platformType!=='sportsbook')reasons.push('Platform payout or execution terms are not verified sportsbook prices.');
 if(freshness!=='CURRENT')reasons.push('Quote or provider fetch time is stale, missing, invalid, or in the future.');
 if(!validPrice(q))reasons.push('Available American price is missing.');
 if(!['game','reg'].includes(row.period))reasons.push('Provider market period is unverified; these quotes cannot enter an exact-market comparison.');
 const shape=shapes[row.marketType],pair=row.outcomeQuotes||[];
 if(!shape||pair.length!==shape.sides.length||!shape.sides.every(s=>pair.some(p=>p.side===s&&p.period===row.period&&validPrice(p)&&researchFreshness(p.updatedAt,row.generatedAt,now)==='CURRENT')))reasons.push('Fresh same-book prices for every exact outcome and period are required.');
 if(row.marketType==='spread'&&(!pair.every(p=>number(p.line)!==null)||pair.reduce((sum,p)=>sum+p.line,0)!==0))reasons.push('Opposing spread lines must be exact negatives.');
 if(row.marketType==='total'&&(!pair.every(p=>number(p.line)!==null&&p.line>=0&&p.line===row.line)))reasons.push('Opposing total lines must match exactly.');
 if(['spread','total'].includes(row.marketType)&&Number.isInteger(row.line))reasons.push('This integer line can push; an unconditional chance requires push modeling.');
 if(row.marketType==='moneyline'&&(row.period==='reg'||row.league==='NFL'||row.sportID==='SOCCER'))reasons.push('A draw or tie can affect this two-way market; an unconditional chance requires settlement and push modeling.');
 if(reasons.length)return {...result,summary:reasons[0]};
 return {...result,status:'COMPARABLE',marketProbability:implied(q.odds)/pair.reduce((sum,p)=>sum+implied(p.odds),0),breakEvenProbability:implied(q.odds),summary:'Fresh complete same-book outcome prices for this exact line and period. Research only.'};
}
export function normalizeGameResearch(data,league,now=Date.now()){
 if(!data||data.error||!Array.isArray(data.events))throw Error('Game research unavailable.');
 const rows=[];
 for(const event of data.events){
  if(event?.league!==league||!event.eventID||!(Date.parse(event.startsAt)>now)||['started','live','completed','finalized','cancelled','canceled','ended'].some(k=>event.status?.[k]))continue;
  const home=event.matchup?.home,away=event.matchup?.away;
  const fallback=['SharpAPI','The Odds API'].includes(event.provider);
  if(!home?.name||!away?.name||home.name===away.name||(!fallback&&(!home.id||!away.id||home.id===away.id)))continue;
  const observation=data.providerObservations?.find(p=>p.league===league);
  for(const [marketType,shape] of Object.entries(shapes)){
   const market=event.markets?.[marketType];if(!market)continue;
   const parsed=new Map();
   for(const side of shape.sides){
    const raw=market[side],entity=side==='draw'||marketType==='total'?'all':side;
    if(!raw)continue;
    const prefix=`points-${entity}-`,suffix=`-${shape.bet}-${side}`,odd=raw?.oddID;
    let period;
    if(fallback&&odd==null)period='unverified';
    else {
     if(typeof odd!=='string'||!odd.startsWith(prefix)||!odd.endsWith(suffix))continue;
     period=odd.slice(prefix.length,-suffix.length);if(!['game','reg'].includes(period))continue;
    }
    const books=new Map(),duplicates=new Set();
    for(const [native,q] of Object.entries(raw.books??{})){
     const book=canonicalBookmaker(native);if(!book||!q)continue;
     if(books.has(book)){duplicates.add(book);continue;}
     const line=['spread','total'].includes(marketType)?number(q.line):null;
     books.set(book,{side,period,line,odds:number(q.odds),available:q.available,updatedAt:q.updatedAt});
    }
    for(const book of duplicates)books.delete(book);
    parsed.set(side,books);
   }
   for(const [side,books] of parsed)for(const [book,q] of books){
    if(q.available!==true)continue;
    const type=platformType(book),outcomeQuotes=shape.sides.map(s=>parsed.get(s)?.get(book)).filter(Boolean);
    const player=side==='home'?home.name:side==='away'?away.name:side==='draw'?'Draw':'Game total';
    const row={kind:'games',sport:league,sportID:event.sport,league,eventID:String(event.eventID),startsAt:event.startsAt,player,playerID:'',participant:side==='home'?home.id:side==='away'?away.id:side,away:away.name,home:home.name,marketType,period:q.period,outcomeStructure:shape.bet,side:side.toUpperCase(),line:q.line,book,platformType:type,odds:type==='sportsbook'?q.odds:null,indicativeOdds:type==='sportsbook'?null:q.odds,updatedAt:q.updatedAt,generatedAt:observation?.fetchedAt??null,provider:observation?.provider??data.source,priceQuote:q,outcomeQuotes,model:null,status:'QUOTE ONLY',reason:'Game quote comparison only. Use the cleared plays page for model decisions.',productionEligible:false};
    row.id=JSON.stringify(['games',league,row.eventID,marketType,row.period,row.side,row.line,book]);
    row.homeID=home.id;row.awayID=away.id;
    row.priceCheck=assessGameQuote(row,now);row.market=row.priceCheck.marketProbability;row.freshness=row.priceCheck.freshness;rows.push(row);
   }
  }
 }
 return rows;
}
const median=values=>{const a=[...values].sort((a,b)=>a-b),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
// Counts are distinct sources, not statistically independent samples. No model or EV calculation.
export function compareResearchPrices(rows,now=Date.now()){
 const groups=new Map(),out=new Map(),sharp=new Set(['pinnacle','circa','bookmakereu']);
 for(const row of rows){
  const key=JSON.stringify([row.kind||'props',row.sport,row.eventID,row.participant||row.playerID||row.player,row.marketType,row.period||'game',row.outcomeStructure||'ou',row.side,row.line]);
  const group=groups.get(key)||[];group.push(row);groups.set(key,group);
 }
 for(const group of groups.values()){
  const eligible=new Map(),duplicates=new Set();
  for(const row of group){
   const check=row.kind==='games'?assessGameQuote(row,now):assessPropQuote({book:row.book,quote:row.priceQuote,opposite:row.oppositeQuote,generatedAt:row.generatedAt,now});
   if(check.status!=='COMPARABLE'||!(Date.parse(row.startsAt)>now))continue;
   const book=canonicalBookmaker(row.book);
   if(eligible.has(book)){const previous=eligible.get(book);if(previous.odds!==row.odds||previous.probability!==check.marketProbability)duplicates.add(book);continue;}
   eligible.set(book,{odds:row.odds,probability:check.marketProbability});
  }
  for(const book of duplicates)eligible.delete(book);
  const bestOdds=eligible.size?Math.max(...[...eligible.values()].map(q=>q.odds)):null;
  for(const row of group){
   const target=canonicalBookmaker(row.book),others=[...eligible].filter(([b])=>b!==target),sharpOthers=others.filter(([b])=>sharp.has(b));
   const reference=sharpOthers.length>=2?sharpOthers:others.length>=3?others:[];
   const isEligible=eligible.has(target);
   out.set(row.id,{best:isEligible&&eligible.size>=2&&row.odds===bestOdds,bestOdds,eligibleBooks:eligible.size,referenceProbability:isEligible&&reference.length?median(reference.map(([,q])=>q.probability)):null,referenceBooks:isEligible?reference.map(([b])=>b):[],referenceKind:sharpOthers.length>=2?'sharp':'broader',productionEligible:false});
  }
 }
 return out;
}
