import {canonicalBookmaker} from './book-catalog.js';
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const text=value=>typeof value==='string'?value.trim():'';
function subject(row){return text(row.playerID)||text(row.participant)||(!['Player unavailable','Player name unavailable','Unknown player','Name unavailable'].includes(row.player)?text(row.player):'');}
// Price changes are observations of the same selection. Period and start time
// remain part of identity; similar names or lines in another game cannot merge.
export function researchQuoteKey(row) {
 if(!text(row?.sport)||!text(row?.eventID)||!Number.isFinite(Date.parse(row?.startsAt))||!subject(row)||!text(row?.marketType)||!text(row?.side)||!text(row?.book))return null;
 if(numeric(row.line)===null&&!['moneyline','threeWay'].includes(row.marketType))return null;
 return JSON.stringify([row.sport,row.kind||'props',row.provider||'',row.eventID,Date.parse(row.startsAt),subject(row),row.marketType,row.period||'game',row.outcomeStructure||'ou',row.side.toUpperCase(),row.line,canonicalBookmaker(row.book)||row.book]);
}
export function latestResearchObservations(rows,now=Date.now()) {
 const groups=new Map();
 for(const [index,row] of rows.entries()){
  if(!row||typeof row!=='object')continue;
  const key=researchQuoteKey(row)||'unidentified:'+index;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
 }
 return [...groups.values()].map(records=>{
  const stamps=records.map(row=>Date.parse(row.updatedAt));
  const valid=stamps.filter(stamp=>Number.isFinite(stamp)&&stamp<=now);
  const latest=valid.length?Math.max(...valid):null;
  const current=latest===null?records:records.filter((row,index)=>stamps[index]===latest);
  const signature=row=>JSON.stringify([row.available??row.priceQuote?.available,row.odds,row.line,row.model,row.market,row.status,row.priceQuote,row.oppositeQuote]);
  const uncertain=records.length>1&&stamps.some(stamp=>!Number.isFinite(stamp)||stamp>now);
  const conflicting=uncertain||new Set(current.map(signature)).size>1;
  const chosen=current.find(row=>row.available===false||row.priceQuote?.available===false)||current[0];
  const history=records.filter(row=>row!==chosen).flatMap(row=>[row,...(row.observationHistory||[])]);
  const base={...chosen,observationHistory:[...(chosen.observationHistory||[]),...history],quoteConflict:conflicting||chosen.quoteConflict===true};
  if(base.quoteConflict)return {...base,available:false,model:null,market:null,status:'UNAVAILABLE',priceQuote:base.priceQuote?{...base.priceQuote,available:false}:null,reason:'Conflicting quote observations. Refresh to verify the current price.'};
  if(base.available===false||base.priceQuote?.available===false)return {...base,available:false,model:null,market:null,status:'UNAVAILABLE',reason:'The latest observation marks this quote unavailable.'};
  return base;
 });
}
