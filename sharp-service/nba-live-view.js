import {appendDeepDive,preserveDeepDives} from './deep-dive.js';
import {formatCentralTime,formatProbability,formatNumber,shortReason} from './ui-format.js';
import {bookLabel} from './prop-price-checks.js';

const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const label=value=>String(value??'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const odds=value=>finite(value)&&Math.abs(value)>=100?(value>0?'+':'')+value:'N/A';
const agreed=(rows,key)=>{const values=rows.map(row=>row[key]);return values.length&&values.every(value=>finite(value)&&value===values[0])?values[0]:null;};
const clearanceFingerprint=groups=>JSON.stringify(groups.map(group=>[group.key,group.status,[...group.current].map(row=>[row.modelHash,row.validationProtocol,row.decisionId,row.issuedAt,row.validUntil])]));

export function mountLiveBoard({groupLiveDecisions,groupLiveCards,livePlayerName,scopeOf}){
 const add=(parent,tag,value,className)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=value;if(className)node.className=className;parent.append(node);return node;};
 const section=document.createElement('section');section.id='nba-live-decisions';section.className='live-board';section.setAttribute('aria-label','NBA prop decisions');
 const head=add(section,'div',undefined,'section-head');add(head,'h2','Reviewed player decisions');
 add(section,'p','BUY requires current approval. Expired or unverified decisions do not clear a play.','board-note');
 const status=add(section,'p','','status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const updated=add(section,'p','','board-updated');
 const searchLabel=add(section,'label','Player or game','board-search');const search=add(searchLabel,'input');search.type='search';search.placeholder='Search players or teams';search.setAttribute('aria-label','Search NBA decisions');
 const filters=add(section,'details',undefined,'board-filter-options');const filterSummary=add(filters,'summary','Filters & sort');
 const controls=add(filters,'div',undefined,'board-filters');
 const select=(title,options)=>{const parent=add(controls,'label',title),node=add(parent,'select');for(const [value,title] of options){const option=add(node,'option',title);option.value=value;}return node;};
 const state=select('Status',[['','All statuses'],['BUY','BUY'],['AVOID','AVOID'],['UNVERIFIED','Unverified']]);
 const side=select('Side',[['','Both sides'],['OVER','Over'],['UNDER','Under']]);
 const market=select('Market',[['','All markets']]),book=select('Book',[['','All books']]);
 const sort=select('Sort',[['start','Game time'],['name','Player name'],['model','Model probability'],['market','Market probability'],['ev','Expected value'],['edge','Model–market gap']]);
 const list=add(section,'div',undefined,'cards live-cards');
 const more=add(section,'button','Show more players','more-markets');more.type='button';more.hidden=true;
 const mount=document.querySelector('[data-nba-live-mount]');
 if(mount)mount.append(section);else (document.querySelector('main')||document.querySelector('.app')||document.body).append(section);
 let data=null,controller=null,shown=20,lastFingerprint='',lastSuccess=null;const expanded=new Set();
 const modelName=row=>({'nba-minutes-paired-2026-11-10-v1':'Minutes model','nba-prospective-bilateral-2026-11-09-v4':'Baseline model'}[row.validationProtocol]||'Model '+(text(row.modelHash)?.slice(0,12)||'identity unavailable'));
 function populate(){
  for(const [node,key,title,format] of [[market,'market','All markets',label],[book,'book','All books',bookLabel]]){
   const previous=node.value;node.replaceChildren();const first=add(node,'option',title);first.value='';
   for(const value of [...new Set((data?.decisions??[]).map(row=>text(row[key])).filter(Boolean))].sort()){const option=add(node,'option',format(value));option.value=value;}
   node.value=[...(node.options??node.children)].some(option=>option.value===previous)?previous:'';
  }
 }
 function disclosure(parent,title,key){const node=add(parent,'details');node.setAttribute('data-live-detail',key);node.open=expanded.has(key);add(node,'summary',title);return node;}
 function selection(parent,group){
  const row=group.representative,clear=group.current.size>0;
  const selection=add(parent,'div',undefined,'prop-selection');
  const head=add(selection,'div',undefined,'selection-head');add(head,'strong',`${label(row.side)} ${finite(row.line)?row.line:'N/A'}`);
  add(head,'span',group.status,'badge '+(clear?'good':group.status==='AVOID'?'pass':'neutral'));
  add(selection,'p',`${bookLabel(row.book)} · ${row.available===false?'Unavailable':group.conflicting?'Price needs verification':(group.status==='UNVERIFIED'?'Recorded ':'')+odds(row.odds)}`,'quote-price');
  const primary=clear?[...group.current]:group.latest;
  const model=group.conflicting||row.available===false?null:agreed(primary,'modelProbability'),fair=group.conflicting||row.available===false?null:agreed(primary,'marketProbability');
  const metrics=add(selection,'div',undefined,'compare');
  for(const [title,value] of [[clear?'Model':'Research model',formatProbability(model)],[group.status==='UNVERIFIED'?'Recorded market':'Market',formatProbability(fair)],['Difference',model!==null&&fair!==null&&model>=0&&model<=1&&fair>=0&&fair<=1?formatNumber((model-fair)*100,{suffix:' pp'}):'N/A']]){
   const cell=add(metrics,'div');add(cell,'small',title);add(cell,'strong',value);
  }
  const reason=clear?'Current approval for this exact quote':group.conflicting?'Conflicting records — verification needed':group.status==='UNVERIFIED'?'Decision expired or not verified':shortReason(group.latest.flatMap(r=>Array.isArray(r.reasons)?r.reasons:[]),'No current production clearance');
  add(selection,'p',reason,'selection-reason');
  const details=disclosure(selection,`Details · ${group.latest.length} model evaluation${group.latest.length===1?'':'s'}`,group.key);
  add(details,'p',`Provider player ID: ${text(row.playerID)||'N/A'} · Event: ${text(row.eventID)||'N/A'}`,'meta technical-id');
  add(details,'p',`Price observed: ${formatCentralTime(row.quoteAt,{seconds:true})} · Opposite price: ${odds(row.oppositeOdds)} · ${formatCentralTime(row.oppositeQuoteAt,{seconds:true})}`,'meta');
  for(const record of group.latest){
   const current=group.current.has(record),key=JSON.stringify([group.key,record.modelHash,record.decisionId,record.issuedAt]);
   const detail=add(details,'details');detail.setAttribute('data-nba-evaluation',key);detail.open=expanded.has(key);
   add(detail,'summary',`${current?'Cleared':'Research'} evaluation · ${modelName(record)} · service ${text(record.status)||'N/A'}`);
   add(detail,'p',`${current?'Approved model estimate':'Research estimate (no current production clearance)'}: ${formatProbability(record.modelProbability)} · Recorded market no-vig estimate: ${formatProbability(record.marketProbability)}`);
   if(finite(record.ev))add(detail,'p',`Recorded EV: ${formatNumber(record.ev*100,{suffix:'%'})}`);
   add(detail,'p',`Service decision status: ${text(record.status)||'N/A'} · Decision recorded: ${formatCentralTime(record.issuedAt,{seconds:true})} · Valid until ${formatCentralTime(record.validUntil,{seconds:true})}`);
   add(detail,'p',`Model identifier: ${text(record.modelHash)||'N/A'} · Protocol: ${text(record.validationProtocol)||'N/A'}`,'technical-id');
   if(text(record.reason))add(detail,'p',record.reason);
   appendDeepDive(detail,record,{scope:'nba-live:'+key,presentation:{title:current?'BUY — cleared':'NOT CLEARED — research evaluation',reason:current?reason:'Research estimate only; no current production clearance. '+(record.reason||'')}});
  }
  const history=group.rows.filter(row=>!group.latest.includes(row));
  if(history.length){
   const historyBox=disclosure(details,`History · ${history.length} older observation${history.length===1?'':'s'}`,group.key+':history');
   for(const record of history){const item=add(historyBox,'details');add(item,'summary',`${modelName(record)} · ${formatCentralTime(record.issuedAt)}`);add(item,'p',`Historical ${record.status==='PLAY'?'BUY (expired)':text(record.status)||'N/A'} · ${odds(record.odds)} · model ${formatProbability(record.modelProbability)}`);if(record.reason)add(item,'p',record.reason);appendDeepDive(item,record,{scope:'nba-history:'+group.key+record.decisionId,presentation:{title:'HISTORICAL — not current',reason:record.reason||'Previous evaluation retained for review.'}});}
  }
 }
 function render(){
  for(const element of list.querySelectorAll('[data-live-detail], [data-nba-evaluation]')){const key=element.getAttribute('data-live-detail')??element.getAttribute('data-nba-evaluation');if(element.open)expanded.add(key);else expanded.delete(key);}
  const active=document.activeElement,focusKey=list.contains?.(active)?active?.parentElement?.getAttribute?.('data-live-detail')??active?.parentElement?.getAttribute?.('data-nba-evaluation'):null;
  preserveDeepDives(list);list.replaceChildren();
  const all=groupLiveDecisions(data),query=search.value?.trim().toLowerCase()??'';
  const filtered=all.filter(group=>{
   const row=group.representative,name=livePlayerName(group.rows);
   return (!state.value||group.status===state.value)&&(!side.value||String(row.side).toUpperCase()===side.value)&&(!market.value||row.market===market.value)&&(!book.value||row.book===book.value)&&(!query||[name.name,name.lookup?.away,name.lookup?.home,row.playerID,row.market].join(' ').toLowerCase().includes(query));
  });
  const cards=groupLiveCards(filtered),allCards=groupLiveCards(all);
  const value=card=>{const key=({model:'modelProbability',market:'marketProbability',ev:'ev'})[sort.value];const values=card.selections.filter(g=>!g.conflicting&&g.representative.available!==false).map(g=>{const rows=g.current.size?[...g.current]:g.latest;if(sort.value==='edge'){const model=agreed(rows,'modelProbability'),market=agreed(rows,'marketProbability');return finite(model)&&finite(market)&&model>=0&&model<=1&&market>=0&&market<=1?model-market:null;}return agreed(rows,key);}).filter(v=>finite(v)&&(!['model','market'].includes(sort.value)||(v>=0&&v<=1)));return values.length?Math.max(...values):-Infinity;};
  cards.sort((a,b)=>sort.value==='name'?livePlayerName(a.selections.flatMap(g=>g.rows)).name.localeCompare(livePlayerName(b.selections.flatMap(g=>g.rows)).name):sort.value!=='start'?(value(b)-value(a)||String(a.key).localeCompare(b.key)):(Date.parse(a.row.startsAt)||Infinity)-(Date.parse(b.row.startsAt)||Infinity)||String(a.key).localeCompare(b.key));
  const buys=all.filter(g=>g.status==='BUY').length;
  status.textContent=!data?`Live decisions unavailable. No current BUY can be verified.`:`${buys} BUY · ${allCards.length} player markets · ${all.length} unique selections`;
  updated.textContent=data?`Updated ${formatCentralTime(data.generatedAt,{seconds:true})}`:lastSuccess?'Last successful refresh '+formatCentralTime(lastSuccess):'';
  const activeFilters=[state,side,market,book].filter(node=>node.value).length;
  filterSummary.textContent=`Filters & sort${activeFilters?' · '+activeFilters+' active':''}${query||activeFilters?' · '+cards.length+' matched markets':''}`;
  if(data&&!all.length)status.textContent='No live model evaluation records were returned. No BUY cleared.';
  for(const cardGroup of cards.slice(0,shown)){
   const rows=cardGroup.selections.flatMap(g=>g.rows),name=livePlayerName(rows),row=cardGroup.row;
   const article=add(list,'article',undefined,'card prop-card');article.setAttribute('data-player-market',cardGroup.key);
   add(article,'h3',name.name,'player-name');
   add(article,'p',`${name.lookup?.away&&name.lookup?.home?name.lookup.away+' @ '+name.lookup.home+' · ':''}${formatCentralTime(row.startsAt)}`,'meta game-meta');
   add(article,'p',`${label(row.market)}${scopeOf(row)!=='game'?' · '+label(scopeOf(row)):''}`,'market-title');
   const ordered=[...cardGroup.selections].sort((a,b)=>Number(b.status==='BUY')-Number(a.status==='BUY')||a.representative.line-b.representative.line||String(a.representative.side).localeCompare(String(b.representative.side))||String(a.representative.book).localeCompare(String(b.representative.book)));
   for(const group of ordered.slice(0,2))selection(article,group);
   if(ordered.length>2){const extra=disclosure(article,`${ordered.length-2} more selections · books & alternate lines`,cardGroup.key+':extra');for(const group of ordered.slice(2))selection(extra,group);}
   const identity=disclosure(article,'Player identity & source',cardGroup.key+':identity');
   add(identity,'p',name.source==='provider-id'?'Display name formatted from provider ID; roster identity is unverified.':name.source==='supplied'?'Name from the supplied event records. Name matching does not establish player availability.':'Player name unavailable.');
   if(name.conflicting)add(identity,'p','Conflicting supplied names; formatted ID is shown for display only.');
   add(identity,'p',`Provider player ID: ${text(row.playerID)||'N/A'} · Event: ${text(row.eventID)||'N/A'}`,'technical-id');
   add(identity,'p',`${rows.length} model evaluation records retained; ${cardGroup.selections.length} unique selections.`,'meta');
  }
  if(!cards.length)add(list,'p',data?'No player markets match these filters.':'Try refreshing the page to reconnect.','empty');
  more.hidden=shown>=cards.length;more.textContent=`Show more players · ${Math.min(shown,cards.length)} of ${cards.length}`;
  if(focusKey)for(const detail of list.querySelectorAll('[data-live-detail], [data-nba-evaluation]'))if((detail.getAttribute('data-live-detail')??detail.getAttribute('data-nba-evaluation'))===focusKey){detail.querySelector('summary')?.focus({preventScroll:true});break;}
  lastFingerprint=clearanceFingerprint(all);
 }
 async function refresh(){
  controller?.abort();const current=new AbortController();controller=current;const timer=setTimeout(()=>current.abort(),12000);
  try{const response=await fetch('/api/dashboard?nbaLive=1',{cache:'no-store',signal:current.signal});const body=await response.json();if(!response.ok||body.contract!=='nba-reviewed-live-v1'||!Array.isArray(body.decisions))throw Error('Unavailable');if(controller===current){data=body;lastSuccess=body.generatedAt;populate();}}
  catch{if(controller===current)data=null;}finally{clearTimeout(timer);if(controller===current)render();}
 }
 for(const control of [search,state,side,market,book,sort])control.addEventListener('input',()=>{shown=20;render();});
 more.addEventListener('click',()=>{shown+=20;render();});
 refresh();setInterval(refresh,15000);
 // Only a change in clearance triggers a repaint between refreshes. A user's
 // reading, keyboard focus and typing are no longer interrupted every second.
 setInterval(()=>{if(clearanceFingerprint(groupLiveDecisions(data))!==lastFingerprint)render();},1000);
 return render;
}
