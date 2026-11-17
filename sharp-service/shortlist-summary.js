import {canonicalBookmaker} from './book-catalog.js';

const text=value=>typeof value==='string'?value.trim():'';

// Structural counts only: no probabilities, stakes, accounts or placed tickets.
export function summarizeShortlist(rows,now=Date.now()) {
 const selections=new Map(),games=new Map(),quotes=new Set(),observations=new Set();
 let excludedCount=0,unidentifiedCount=0;
 for(const row of rows){
  if(row?.id&&observations.has(row.id))continue;
  if(row?.id)observations.add(row.id);
  const starts=Date.parse(row?.startsAt);
  if(Number.isFinite(starts)&&starts<=now){excludedCount++;continue;}
  const sport=text(row?.sport),provider=text(row?.provider),kind=row?.kind||'props';
  // NBA prop research prefixes SGO IDs; the game board retains the raw SGO ID.
  const eventID=provider==='SportsGameOdds'?text(row?.eventID).replace(/^sgo:/,''):text(row?.eventID);
  const participant=text(row?.participant)||text(row?.playerID)||text(row?.player);
  const marketType=text(row?.marketType),side=text(row?.side).toUpperCase();
  const period=text(row?.period)||(kind==='props'?'game':''),book=canonicalBookmaker(row?.book);
  const line=row?.line,hasLine=typeof line==='number'&&Number.isFinite(line);
  if(!Number.isFinite(starts)||!sport||!eventID||!participant||participant==='Player unavailable'||!marketType||marketType==='Unknown market'||!side||!['game','reg'].includes(period)||!book||(!hasLine&&!['moneyline','threeWay'].includes(marketType))){unidentifiedCount++;continue;}
  const gameKey=JSON.stringify([sport,provider,eventID,starts]);
  const selectionKey=JSON.stringify([gameKey,kind,participant,marketType,period,row.outcomeStructure||'ou',side,hasLine?line:null]);
  const quoteKey=JSON.stringify([selectionKey,book]);
  if(quotes.has(quoteKey))continue;
  quotes.add(quoteKey);
  if(!selections.has(selectionKey))selections.set(selectionKey,{sport,eventID,player:row.player,marketType,period,side,line:hasLine?line:null,away:row.away,home:row.home,books:[]});
  selections.get(selectionKey).books.push(book);
  if(!games.has(gameKey))games.set(gameKey,{sport,eventID,away:row.away,home:row.home,selections:new Set()});
  games.get(gameKey).selections.add(selectionKey);
 }
 return {
  quoteCount:quotes.size,selectionCount:selections.size,gameCount:games.size,excludedCount,unidentifiedCount,
  repeatedSelections:[...selections.values()].filter(selection=>selection.books.length>1),
  sharedGames:[...games.values()].filter(game=>game.selections.size>1).map(({selections,...game})=>({...game,selectionCount:selections.size}))
 };
}
