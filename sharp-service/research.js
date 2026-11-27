import {currentCfbForecasts} from './cfb-research.js';
import {appendTeamScoring} from './team-scoring-view.js';
import {appendDeepDive,preserveDeepDives} from './deep-dive.js';

import {filterResearch,refreshResearchRow,latestResearchObservations,groupResearchRows,sortResearchGroups} from './research-data.js';
import {formatCentralTime,formatProbability,displayPlayerName,shortReason} from './ui-format.js';
import {applyPlayerPortrait} from './player-portraits.js';

import {createResearchLoader} from './research-loader.js';

import {bookLabel,platformType} from './prop-price-checks.js';

import {appendDfsWorksheet} from './dfs-payout-worksheet.js';

import {compareResearchPrices} from './research-comparison.js';

import {summarizeShortlist} from './shortlist-summary.js';
const $=id=>document.getElementById(id);

const add=(parent,tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;parent.append(node);return node;};

const label=value=>String(value??'').replaceAll('_',' ');

const pct=formatProbability;

const date=formatCentralTime;

const centralClock=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'});
const centralDay=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric'});
const centralCalendar=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'numeric',day:'numeric'});
function tipoff(value,now=Date.now()){
 if(date(value)==='N/A')return 'N/A';
 const at=new Date(value),time=centralClock.format(at)+' CT';
 return centralCalendar.format(at)===centralCalendar.format(now)?time:centralDay.format(at)+' · '+time;
}

function icon(parent,name,className){const node=add(parent,'img',undefined,className);node.src='/assets/icons/'+name+'.svg';node.alt='';node.setAttribute('aria-hidden','true');node.width=20;node.height=20;return node;}

const odds=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)>=100?`${value>0?'+':''}${value}`:'N/A';

const priceLabel=row=>row.available===false?'Quote unavailable':row.platformType==='dfs'?'Entry payout required':row.platformType==='exchange'?'Executable contract price unverified':odds(row.odds);

const difference=row=>[row.model,row.market].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1)?`${((row.model-row.market)*100).toFixed(1)} pp`:'N/A';

function withinOpenDisclosures(node,root){for(let parent=node.parentElement;parent&&parent!==root;parent=parent.parentElement)if(parent.hidden||(parent.tagName==='DETAILS'&&!parent.open))return false;return true;}

const saved=new Map(),expandedGroups=new Set(),viewedQuotes=new Set();let shortlist=false,shown=24,selected=null;

const loader=createResearchLoader({onChange:state=>{

 if(state.status==='loading'){$('detail').close();selected=null;}else populate();

 render();

 if(state.status==='ready'&&selected&&$('detail').open){selected=state.rows.find(row=>row.id===selected.id)||selected;drawDetail();}

}});

function button(parent,text,handler){const node=add(parent,'button',text);node.type='button';node.onclick=handler;return node;}

function current(row){return refreshResearchRow(row);}

function liveRows(){return latestResearchObservations(loader.state.rows).map(current);}
function savedCurrent(row,live){
 const latest=live.get(row.id);if(latest)return latest;
 if(row.sport===loader.state.sport&&(row.kind||'props')===loader.state.kind&&loader.state.status==='ready')return {...row,available:false,model:null,market:null,status:'UNAVAILABLE',reason:'This saved quote is no longer present in the current response.',priceQuote:row.priceQuote?{...row.priceQuote,available:false}:null};
 return row;
}
function sourceRows(){const rows=liveRows(),live=new Map(rows.map(r=>[r.id,r]));return (shortlist?[...saved.values()].filter(r=>r.sport===loader.state.sport&&(r.kind||'props')===loader.state.kind).map(r=>savedCurrent(r,live)):rows).map(current).filter(r=>Date.parse(r.startsAt)>Date.now());}
function comparisonIndex(){return compareResearchPrices(liveRows());}
function appendComparison(parent,row,comparison){

 const block=add(parent,'div',undefined,'price-comparison');

 if(!comparison||comparison.eligibleBooks<2){add(block,'strong',comparison?.eligibleBooks===1?'Only one comparable book':'Price comparison unavailable');add(block,'p','Needs fresh, complete sportsbook prices for this exact selection.');return;}

 add(block,'strong',comparison.best?'BEST OBSERVED PRICE':'Compare the exact price');

 add(block,'p',`${comparison.eligibleBooks} comparable books · best observed ${odds(comparison.bestOdds)}`);

 add(block,'p',comparison.referenceProbability===null?'Market reference needs more other-book coverage.':`Market reference: ${pct(comparison.referenceProbability)} · ${comparison.referenceBooks.length} other ${comparison.referenceKind==='sharp'?'sharp ':''}books`);

 add(block,'small','Verify your account access and current price. This is a market comparison, not a forecast or a cleared play.');

}

function populate(){for(const [id,key,title] of [['book','book','All platforms'],['market','marketType','All markets'],['game','eventID','All games']]){const select=$(id),previous=select.value;select.replaceChildren();const first=add(select,'option',title);first.value='';const rows=sourceRows(),configured=id==='book'?(loader.state.bookCoverage?.configured??[]):[];for(const value of [...new Set([...rows.map(r=>r[key]),...configured])].filter(Boolean).sort()){const row=rows.find(r=>r[key]===value);const name=id==='game'?`${row?.away||'Away'} @ ${row?.home||'Home'}`:id==='book'?bookLabel(value):label(value);const opt=add(select,'option',name);opt.value=value;}if([...select.options].some(o=>o.value===previous))select.value=previous;}}
function renderCoverage(state,rows){

 const target=$('platform-coverage'),expanded=target.querySelector('details')?.open||false;target.replaceChildren();

 const books=state.bookCoverage?.configured;if(!Array.isArray(books)||state.status!=='ready'){target.hidden=true;return;}target.hidden=false;

 add(target,'h2','Platform coverage & payout checks');add(target,'p','All account-entitled books are requested. This bounded refresh may not contain every market. A fresh line or complete price pair does not clear a play. Both validation models remain frozen.','muted');

 const details=add(target,'details');details.open=expanded;add(details,'summary',books.length+' monitored or observed platforms · view coverage');const grid=add(details,'div',undefined,'platform-grid');

 for(const book of books){const subset=rows.filter(r=>r.book===book),card=add(grid,'article',undefined,'platform-item');add(card,'h3',bookLabel(book));add(card,'strong',`${subset.length} observations · ${subset.filter(r=>r.freshness==='CURRENT'&&r.available!==false).length} fresh`);const type=platformType(book);add(card,'p',!subset.length?'No available '+state.sport+' '+(state.kind==='games'?'game':'prop')+' lines returned for this platform.':type==='dfs'?'Entry payout and pick rules still required.':type==='exchange'?'Contract identity, executable price, depth and fees still required.':`${subset.filter(r=>r.priceCheck?.status==='COMPARABLE').length} prices have a fresh matching opposite side.`);}

}

function renderShortlist(){
 const target=$('shortlist-review');target.replaceChildren();target.hidden=!saved.size;if(target.hidden)return;
 const live=new Map(liveRows().map(row=>[row.id,row]));
 const summary=summarizeShortlist([...saved.values()].map(row=>savedCurrent(row,live)));
 add(target,'h2','Shortlist overlap');
 add(target,'p',`${summary.quoteCount} upcoming quote${summary.quoteCount===1?'':'s'} · ${summary.selectionCount} selection${summary.selectionCount===1?'':'s'} across ${summary.gameCount} game${summary.gameCount===1?'':'s'}`);
 add(target,'p','Current page shortlist only, across all saved sports and views; not linked tickets or accounts. Filters do not change these counts.','muted');
 if(summary.repeatedSelections.length){
  add(target,'h3','Repeated selections across platforms');const list=add(target,'ul');
  for(const row of summary.repeatedSelections)add(list,'li',`${row.player} · ${label(row.marketType)} · ${row.side} ${row.line??''} · ${label(row.period)}: ${row.books.length} platforms (${row.books.map(bookLabel).join(', ')}). These quotes repeat one selection; they do not diversify it.`,'duplicate-selection');
  add(target,'p','Matching selection details do not verify identical platform settlement rules.','muted');
 }
 if(summary.sharedGames.length){
  add(target,'h3','Multiple selections from the same game');const list=add(target,'ul');
  for(const game of summary.sharedGames)add(list,'li',`${game.sport} · ${game.away||'Away unavailable'} @ ${game.home||'Home unavailable'}: ${game.selectionCount} selections share this game. One game can affect several selections.`,'shared-game');
 }
 if(summary.excludedCount)add(target,'p',`${summary.excludedCount} saved quotes have started and are excluded from these counts.`,'muted');
 if(summary.unidentifiedCount)add(target,'p',`${summary.unidentifiedCount} saved quotes have incomplete game or selection identity and are not counted. Overlap may be missing.`,'muted');
 add(target,'p','These are counts, not joint win probabilities or money at risk. Selections from different games are not proven independent.','muted');
}

function quoteOption(parent,row,comparisons){
 const option=add(parent,'article',undefined,'target-player-card quote-option');option.dataset.quoteId=row.id;
 const unavailable=row.available===false||row.quoteConflict;
 const meta=add(option,'div',undefined,'target-card-meta');
 const match=add(meta,'span',`${row.sport==='NCAAF'?'CFB':row.sport} · ${row.away||'Away unavailable'} vs ${row.home||'Home unavailable'} · ${tipoff(row.startsAt)}`,'target-card-game');match.title=date(row.startsAt);
 add(meta,'span',unavailable?'UNAVAILABLE':'NOT CLEARED','badge '+(unavailable?'unavailable':'neutral'));
 const identity=add(option,'div',undefined,'target-player-identity'+(row.kind==='games'?' is-game':''));
 if(row.kind!=='games'){const portrait=add(identity,'img',undefined,'target-player-portrait');applyPlayerPortrait(portrait,row.playerID);}
 const copy=add(identity,'div',undefined,'target-player-copy');
 const title=row.kind==='games'?`${row.away||'Away'} vs ${row.home||'Home'}`:displayPlayerName(row.player,row.playerID).name;
 add(copy,'h3',title,'player-name');
 const side=row.kind==='games'&&['HOME','AWAY'].includes(row.side)?row.player:label(row.side).toLowerCase().replace(/^./,c=>c.toUpperCase());
 add(copy,'p',`${side} ${row.line??(row.kind==='games'?'':'N/A')} ${label(row.marketType)}`.replace(/\s+/g,' ').trim(),'selection target-card-selection');
 add(copy,'p',`${bookLabel(row.book)} · ${unavailable?'Quote unavailable':priceLabel(row)}`,'quote target-card-book');
 const compare=add(option,'div',undefined,'comparison target-card-metrics');
 for(const [name,value,explanation] of [['Model',unavailable?'N/A':pct(row.model),'Experimental model chance; not approved for live plays'],['Market',unavailable?'N/A':pct(row.market),'Market-implied chance with margin removed (no vig)'],['Edge',unavailable?'N/A':difference(row),'Model minus market in percentage points; not expected profit']]){const cell=add(compare,'div');const heading=add(cell,'small',name);heading.title=explanation;add(cell,'strong',value);}
 add(option,'p',unavailable?(row.quoteConflict?'Conflicting observations; current price withheld.':'Latest quote unavailable.'):shortReason(row.reason,'Model approval and availability unverified.'),'target-card-reason');
 const research=add(option,'details',undefined,'target-research-details');research.dataset.researchGroup='quote:'+row.id;research.open=expandedGroups.has(research.dataset.researchGroup);
 const summary=add(research,'summary');summary.dataset.focusKey='research:'+row.id;add(summary,'span','Research & matchup details');icon(summary,'chevron-down','target-research-chevron');
 const content=add(research,'div',undefined,'target-research-content');
 if(row.reason)add(content,'p',row.reason,'research-decision-reason');
 add(content,'p',`${date(row.startsAt)} · ${label(row.period||'game')} · Quote observed ${date(row.updatedAt)}`,'quote-state');
 if(unavailable)add(content,'p',row.quoteConflict?'Conflicting observations · price withheld':'Latest quote unavailable','quote-state');
 else{
  const comparison=comparisons.get(row.id);
  if(comparison?.best){const detail=add(content,'details',undefined,'price-comparison');detail.dataset.researchGroup='compare:'+row.id;detail.open=expandedGroups.has(detail.dataset.researchGroup);const bestSummary=add(detail,'summary','Best observed price');bestSummary.dataset.focusKey='compare:'+row.id;add(detail,'p',`${comparison.eligibleBooks} comparable books · best observed ${odds(comparison.bestOdds)}`);add(detail,'p',comparison.referenceProbability===null?'Market reference needs more other-book coverage.':`Market reference: ${pct(comparison.referenceProbability)} · ${comparison.referenceBooks.length} other ${comparison.referenceKind==='sharp'?'sharp ':''}books`);}
  if(['dfs','exchange'].includes(row.platformType))add(content,'small',row.platformType==='dfs'?'Entry payout required · indicative odds are not a bet price.':'Executable contract price and fees unverified.','quote-state');
  else if(row.freshness!=='CURRENT')add(content,'small',`${row.freshness} quote · ${date(row.updatedAt)}`,'quote-state');
 }
 const actions=add(content,'div',undefined,'actions');
 const detail=button(actions,'Why isn’t this cleared?',()=>openDetail(row));detail.dataset.focusKey='detail:'+row.id;
 const save=button(actions,saved.has(row.id)?'Remove saved':'Shortlist +',()=>{if(saved.has(row.id))saved.delete(row.id);else if(row.available!==false&&!row.quoteConflict)saved.set(row.id,structuredClone(row));render();});save.dataset.focusKey='save:'+row.id;save.disabled=row.available===false&&!saved.has(row.id);save.setAttribute('title',`${saved.has(row.id)?'Remove saved':'Shortlist'} ${row.player} ${row.side} ${row.line??''} ${label(row.marketType)} at ${bookLabel(row.book)}`);
}
function render(){
 const state=loader.state,all=sourceRows(),comparisons=comparisonIndex();
 const rows=filterResearch(all,{query:$('query').value,book:$('book').value,market:$('market').value,freshness:$('freshness').value,side:$('side').value,game:$('game').value,status:$('research-status').value}).filter(row=>!$('best-prices').checked||comparisons.get(row.id)?.best);
 const allGroups=groupResearchRows(all),groups=sortResearchGroups(groupResearchRows(rows),$('sort').value);
 $('refresh').disabled=state.status==='loading';$('count').textContent=state.status==='ready'?allGroups.length:'—';$('modeled').textContent=state.status==='ready'?allGroups.filter(g=>g.rows.some(r=>r.model!==null&&r.available!==false)).length:'—';$('fresh').textContent=state.status==='ready'?allGroups.filter(g=>g.rows.some(r=>r.freshness==='CURRENT'&&r.available!==false)).length:'—';$('saved-count').textContent=saved.size;
 renderCfbSummary(state,all);renderShortlist();
 const isCfb=state.sport==='NCAAF'&&state.kind==='games';$('play-readiness').textContent=isCfb?'CFB predictions · research only':state.kind==='games'?'Game quotes · research only':'Player props · research only';for(const p of $('play-readiness').parentElement.querySelectorAll('p'))p.hidden=state.kind==='games';
 $('research-board').textContent=`${state.sport==='NCAAF'?'CFB':state.sport} ${state.kind==='games'?'Game Markets':'Player Props'}`;
 $('reviewed-props-link').href=state.sport==='NFL'?'/nfl.html':'/nba.html';
 const shell=document.querySelector('[data-edge-shell]');if(shell)shell.dataset.edgeSport=state.sport;
 $('shortlist-toggle').textContent=shortlist?'Back to board':'View shortlist';$('shortlist-toggle').setAttribute('aria-pressed',String(shortlist));
 for(const tab of document.querySelectorAll('[data-sport]')){tab.setAttribute('aria-pressed',String(tab.dataset.sport===state.sport));tab.hidden=state.kind==='props'&&!['NBA','NFL'].includes(tab.dataset.sport);}
 for(const tab of document.querySelectorAll('[data-kind]'))tab.setAttribute('aria-pressed',String(tab.dataset.kind===state.kind));$('other-league').hidden=state.kind!=='games';
 renderCoverage(state,liveRows().filter(r=>Date.parse(r.startsAt)>Date.now()));
 $('status').textContent=(state.message?`${state.message} `:'')+(state.status==='ready'||shortlist?`${groups.length} matching ${shortlist?'shortlisted':'research'} markets · ${rows.length} quote sides · ${state.sport} · Last refresh ${date(state.generatedAt)}`:'');
 const target=$('cards'),active=document.activeElement,focused=active?.dataset?.focusKey;
 const priorQuotes=target.querySelectorAll('.quote-option');
 // Retain the last visible reading position through the loader's empty state.
 // Closed ancestors do not qualify, even if a child disclosure retains `open`.
 if(priorQuotes.length){viewedQuotes.clear();for(const option of priorQuotes){const research=option.querySelector('.target-research-details');if(withinOpenDisclosures(option,target)&&(research?.open||option.contains(active)))viewedQuotes.add(option.dataset.quoteId);}}
 for(const detail of target.querySelectorAll('[data-research-group]')){if(detail.open)expandedGroups.add(detail.dataset.researchGroup);else expandedGroups.delete(detail.dataset.researchGroup);}
 preserveDeepDives(target);target.replaceChildren();$('more').hidden=groups.length<=shown;
 if(!groups.length){add(target,'div',state.status==='loading'&&!shortlist?'Fetching quotes and research estimates…':state.status==='error'&&!shortlist?'Quotes could not be loaded. This does not mean every market is AVOID.':shortlist?'No upcoming shortlisted markets match these filters. Shortlists are kept only for this page session.':all.length?'No markets match these filters.':'No upcoming quotes were returned. Coverage may be unavailable or outside the provider window.','empty');return;}
 for(const group of groups.slice(0,shown)){
  const sorted=[...group.rows].sort((a,b)=>(a.line??0)-(b.line??0)||bookLabel(a.book).localeCompare(bookLabel(b.book))||(['OVER','HOME'].includes(a.side)?0:1)-(['OVER','HOME'].includes(b.side)?0:1));
  const row=sorted[0],card=add(target,'details',undefined,'player-market-row research-market');card.dataset.marketKey=group.key;card.dataset.researchGroup='market:'+group.key;card.open=expandedGroups.has(card.dataset.researchGroup);
  const head=add(card,'summary',undefined,'player-row-summary');head.dataset.focusKey='market:'+group.key;
  const heading=add(head,'span',undefined,'player-row-copy'),title=row.kind==='games'?`${row.away||'Away'} @ ${row.home||'Home'}`:displayPlayerName(row.player,row.playerID).name;
  const name=add(heading,'span',title,'player-row-heading');name.setAttribute('role','heading');name.setAttribute('aria-level','3');
  add(heading,'span',label(row.marketType).replace(/\b\w/g,c=>c.toUpperCase())+(group.period!=='game'?' · '+label(group.period):''),'player-row-market');add(head,'span',row.kind==='games'?'Back to markets':'Back to players','player-row-back');icon(head,'chevron-right','player-row-chevron');
  const content=add(card,'div',undefined,'player-market-content');quoteOption(content,row,comparisons);
  if(sorted.length>1){const more=add(content,'details',undefined,'more-quotes');more.dataset.researchGroup='quotes:'+group.key;more.open=expandedGroups.has(more.dataset.researchGroup)||sorted.slice(1).some(quote=>viewedQuotes.has(quote.id));const summary=add(more,'summary',`${sorted.length-1} more quote${sorted.length===2?'':'s'} · books & alternate lines`);summary.dataset.focusKey='quotes:'+group.key;const lines=new Set(sorted.map(r=>r.line)),books=new Set(sorted.map(r=>r.book));add(more,'p',`${books.size} platform${books.size===1?'':'s'} · ${lines.size} line${lines.size===1?'':'s'} · ${row.kind==='games'?'All outcomes and alternate lines':'Over/Under and alternate lines'} grouped together`,'group-summary');const rest=add(more,'div',undefined,'group-quotes');for(const quote of sorted.slice(1))quoteOption(rest,quote,comparisons);}
 }
 if(focused)for(const action of target.querySelectorAll('[data-focus-key]'))if(action.dataset.focusKey===focused){action.focus({preventScroll:true});break;}
 $('more').textContent=`Show more · ${Math.min(shown,groups.length)} of ${groups.length} markets`;
}
function openDetail(row){selected=row;drawDetail();$('detail').showModal();}

function appendCfbExplanation(parent,f){
 const detail=add(parent,'details');add(detail,'summary','Why this winner estimate');
 const rating=n=>Number.isFinite(n)?n.toFixed(0):'unavailable';
 add(detail,'p',`${f.homeName} rating ${rating(f.homeRating)} versus ${f.awayName} rating ${rating(f.awayRating)}. ${f.neutralSite?'Neutral site; no home-field adjustment.':`Verified home venue; ${f.homeAdvantage} rating points for home field.`}`);
 add(detail,'p',`Ratings reflect past wins and opponent strength. Verified games in the last 18 months: home ${f.homeCount??'unavailable'}, away ${f.awayCount??'unavailable'}. Inputs through ${date(f.inputCutoff)}; latest included result ${date(f.latestResultAt)}.`);
 add(detail,'p',`No quarterback, injury, weather or separate defensive-efficiency adjustment. Model ${f.modelVersion}. Prospective testing and review must earn PLAY approval.`);
 return detail;
}
function renderCfbSummary(state,rows){

 const target=$('cfb-summary');target.replaceChildren();target.hidden=state.sport!=='NCAAF'||state.kind!=='games'||state.status!=='ready';if(target.hidden)return;

 add(target,'h2','CFB winner forecasts');

 const unique=currentCfbForecasts(state.cfbSummary?.forecastPayload).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||Math.max(b.homeProbability,b.awayProbability)-Math.max(a.homeProbability,a.awayProbability));
 const evaluated=state.cfbSummary?.evaluation?.holdout;

 add(target,'p',`${unique.length} games with independent estimates · research only, not cleared plays. ${evaluated?`Historical holdout: ${evaluated.n} games, ${(evaluated.accuracy*100).toFixed(1)}% winner accuracy, Brier ${evaluated.brier.toFixed(3)}. This does not establish a sportsbook edge.`:''}`,'muted');

 const tracked=state.cfbSummary?.prospective,coverage=state.cfbSummary?.coverage;
 if(tracked)add(target,'p',`Prospective tracking: ${tracked.captured??0} saved pregame forecasts · ${tracked.n??0} final results · ${coverage?.missedClosedCaptureWindows??0} missed capture windows · ${coverage?.pendingScopeGames??0} games still awaiting capture. This tracks predictions, not placed bets.`,'muted');
 if(!unique.length){add(target,'p','No current verified CFB forecast matches this quote refresh. Book comparisons remain below.');return;}

 const grid=add(target,'div',undefined,'cards');for(const f of unique){const card=add(grid,'article',undefined,'card');add(card,'h3',`${f.awayName} @ ${f.homeName}`);add(card,'p',date(f.startsAt),'match');add(card,'strong',`${f.homeName}: ${pct(f.homeProbability)} · ${f.awayName}: ${pct(f.awayProbability)}`);add(card,'p','Forecast '+date(f.generatedAt)+' · NOT CLEARED','muted');appendTeamScoring(card,f.teamScoringContext);appendCfbExplanation(card,f);if(rows.some(r=>r.eventID===f.eventID&&r.cfbForecast&&r.model!==null))button(card,'Compare prices',()=>{$('query').value=f.homeName;$('market').value='moneyline';shown=24;render();$('research-board').scrollIntoView({behavior:'smooth'});});else add(card,'p','Book comparison unavailable: '+(f.quoteComparisonEligible===false?'the provider kickoff conflicts with the verified schedule.':'no exact matching quotes in this refresh.'),'muted');if(f.scheduleVerification){const detail=add(card,'details');add(detail,'summary','Verified schedule and price restriction');add(detail,'p',f.scheduleVerification.explanation);add(detail,'p','Provider kickoff: '+date(f.providerStartsAt)+'. Verified schedule: '+date(f.startsAt)+'. Reviewed: '+date(f.scheduleVerification.reviewedAt));for(const url of f.scheduleVerification.sources||[]){if(typeof url==='string'&&url.startsWith('https://')){const link=add(detail,'a',new URL(url).hostname);link.href=url;link.target='_blank';link.rel='noopener noreferrer';add(detail,'br');}}}}
}

function drawDetail(){

 if(!selected)return;

 const expanded=$('detail-body').querySelector('details')?.open||false;

 const row=current(selected),context=row.context,body=$('detail-body');

 const priorWorksheet=body.querySelector('.payout-worksheet');
 if(row.available===false)selected=row;

 $('detail-title').textContent=row.player;preserveDeepDives(body);body.replaceChildren();

 const section=(heading,copy,className='detail-section')=>{const block=add(body,'section',undefined,className);add(block,'h3',heading);if(copy)add(block,'p',copy);return block;};

 const number=v=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(1):null;

 const unit=label(row.marketType).replace('receiving receptions','receptions');

 add(body,'p',row.kind==='games'?label(row.marketType)+' · '+row.side+' '+(row.line??'')+' · '+(row.period==='reg'?'Regulation':row.period==='game'?'Full game':'Period unverified'):(row.side==='OVER'?'More than':'Less than')+' '+(row.line??'?')+' '+unit,'selection');

 add(body,'p',bookLabel(row.book)+' · '+priceLabel(row)+' · '+date(row.startsAt),'muted');

 if(row.available===false)section('Quote unavailable',row.reason||'The latest observation is unavailable. An earlier price is not current.');
 section('NOT CLEARED — research only',row.model===null?'This line has no validated prediction attached. Platform checks and player availability still matter.':'The model is still being tested. Its estimated chance has not earned approval for live plays.','decision-summary');

 appendComparison(body,row,comparisonIndex().get(row.id));

 if(row.priceCheck){const block=section('Price and payout checks',row.priceCheck.summary);const list=add(block,'ul');for(const reason of row.priceCheck.reasons)add(list,'li',reason);}

 if(row.platformType==='dfs'&&row.available!==false){

  section('Why there is no book percentage','The provider’s indicative odds are not the payout for this DFS entry. Check the actual lineup type, every payout tier, pick multipliers, promotions, correlations and settlement rules. No 50% probability is inferred from +100.');

  if(priorWorksheet?.dataset.quoteId===row.id&&priorWorksheet.dataset.observedAt===row.generatedAt)body.append(priorWorksheet);

  else {appendDfsWorksheet(body,row);const sheet=body.querySelector('.payout-worksheet');sheet.dataset.quoteId=row.id;sheet.dataset.observedAt=row.generatedAt;}

 }else if(row.platformType==='exchange')section('Why the exchange cost is unverified','This provider record does not identify the exact contract and executable order book. Americanized indicative odds cannot substitute for an ask price, size, fees and settlement terms. No cost-based probability or expected profit is shown.');

 else section('What the percentages mean','Model chance: '+pct(row.model)+'. Market-implied chance (no vig): '+pct(row.market)+'. This market figure is not an independent forecast. It requires fresh, complete outcome prices from the exact book, market and line. Integer lines can push, so their unconditional percentage is withheld. A gap does not prove an advantage.');
 if(row.freshness!=='CURRENT')section('Quotes need refreshing',row.freshness==='STALE'?'These quotes exceed the freshness limit. The market comparison is hidden until fresh prices arrive.':'We cannot verify when these quotes were updated. The market comparison is hidden.');

 if(row.cfbForecast){appendTeamScoring(body,row.cfbForecast.teamScoringContext);appendCfbExplanation(body,row.cfbForecast);}
 if(row.kind==='games'){section('Game market rules','Compare only the same period, outcome structure and line. Regulation and full-game markets can settle differently. Provider prices do not confirm identical house rules, limits or account eligibility.');section('Sources and decision status','Source: '+(row.provider||'Unknown')+'. Quote updated '+date(row.updatedAt)+'. Provider fetched '+date(row.generatedAt)+(row.cfbForecast?'. Independent CFB research estimate attached; not approved for PLAY.':'. No game model is attached to these quotes; check the cleared team plays page for current decisions.'));section('Market reference','The reference excludes this book. It uses the median no-vig chance from at least two other sharp books, or at least three other sportsbooks. Books may share information; this is not a validated probability or a count of independent samples.');const technical=add(body,'details',undefined,'source-details');technical.open=expanded;add(technical,'summary','Source identity & quote history');add(technical,'p',`Event ID: ${row.eventID||'N/A'} · Period: ${row.period||'N/A'} · Quote observed ${date(row.updatedAt)}`);if(row.observationHistory?.length)for(const old of row.observationHistory)add(technical,'p',`Historical observation · ${date(old.updatedAt)} · ${bookLabel(old.book)} · ${old.side} ${old.line??''} · ${old.available===false?'unavailable':odds(old.odds)}`);else add(technical,'p','No older observations returned in this response.');return;}

 const evidence=[];

 const fact=(title,value,explanation,feature)=>{

  const block=add(body,'section',undefined,'context-fact');

  add(block,'h3',title);add(block,'strong',value??'Not enough data');

  add(block,'p',value===null?'We do not have enough verified history for this measure.':explanation);

  if(feature){const games=feature.gameCount??feature.sampleCount;add(block,'small','Based on '+(games??0)+' '+(feature.gameCount!=null?'games':context?.features&&title==='Opponent vs this position'?'player appearances':'games'));evidence.push({title,feature});}

 };

 if(context?.features){

  const f=context.features;

  fact('Recent player average',number(f.recentPlayerAverage?.value)===null?null:number(f.recentPlayerAverage.value)+' '+unit,'Average over the most recent available games, up to 5. This is history, not a prediction.',f.recentPlayerAverage);

  fact('Usual playing time',number(f.expectedMinutes?.value)===null?null:number(f.expectedMinutes.value)+' minutes','Average minutes played in the available sample, up to 10 games. Minutes for the next game are not confirmed.',f.expectedMinutes);

  fact('History-based estimate',number(context.baselineProjection)===null?null:number(context.baselineProjection)+' '+unit,'Uses past minutes and production per minute. It does not yet account for confirmed injuries or a validated matchup adjustment.');

  fact('Team recent results',number(f.winRate?.value)===null?null:Math.round(f.winRate.value*100)+'% wins','Win percentage in the available team sample. This is not the chance of winning the next game.',f.winRate);

  fact('Team scoring',number(f.offensiveRating?.value)===null?null:number(f.offensiveRating.value)+' points','Points scored per 100 estimated possessions. A possession is one team’s chance to score.',f.offensiveRating);

  fact('Team defense',number(f.defensiveRating?.value)===null?null:number(f.defensiveRating.value)+' points allowed','Points allowed per 100 estimated possessions. Lower means fewer points conceded in this sample; no league rank is verified.',f.defensiveRating);

  fact('Opponent defense',number(f.opponentDefensiveRating?.value)===null?null:number(f.opponentDefensiveRating.value)+' points allowed','Points conceded per 100 estimated possessions. Higher means this opponent allowed more scoring in the sample. No league rank or automatic PLAY boost is implied.',f.opponentDefensiveRating);

  fact('Opponent vs this position',number(f.defenseVsPosition?.value)===null?null:number(f.defenseVsPosition.value)+' '+unit,'Average allowed per opposing player appearance at this historical position. Playing time varies, so this is not a prediction for this player.',f.defenseVsPosition);

 }else if(context?.teamForm){

  fact('Team recent results',number(context.teamForm.value)===null?null:Math.round(context.teamForm.value*100)+'% result rate','Last available games, up to 5. A win counts as 1 and a tie as half. This is not next game’s win probability.',context.teamForm);

  const efficiency=(title,f,defense)=>fact(title,number(f?.value)===null?null:(f.value>0?'+':'')+f.value.toFixed(2)+' scoring value per play',defense?'Estimates how much opponents gained from passes and runs. Lower is better for this defense. This measure excludes sacks and some other plays.':'Estimates how much the offense gained from passes and runs. Higher is better for this offense. This measure excludes sacks and some other plays.',f);

  efficiency('Team offense',context.offense,false);

  efficiency('Team defense',context.defense,true);

  efficiency('Opponent defense',context.opponentDefense,true);

  const allowance=context.opponentAllowanceByPosition?.[row.position]?.[row.marketType];

  const position={QB:'quarterbacks',RB:'running backs',WR:'wide receivers',TE:'tight ends'}[row.position]||'this position';

  fact('Opponent vs '+position,number(allowance?.value)===null?null:number(allowance.value)+' '+unit+' per game','Combined total allowed to all opposing '+position+' in each observed game. This is not an individual player projection.',allowance);

 }else section('Player and matchup history','Not available for this quote yet.');

 section('What is still missing','Confirmed injury and playing-time information, complete league rankings, and proof that these matchup adjustments improve predictions on new games. These context numbers do not change PLAY decisions yet.');

 const details=add(body,'details',undefined,'source-details');details.open=expanded;

 add(details,'summary','Sources, timestamps & calculation notes');

 add(details,'p','Odds: '+(row.provider||'Unknown source')+'. Updated '+date(row.updatedAt)+'. Response '+date(row.generatedAt)+'.');

 add(details,'p',row.identityStatus==='ROSTER_MATCHED'?'Player matched to current ESPN roster: '+row.verifiedTeam+'. Participation is not confirmed.':row.identityStatus==='PROVIDER_ROSTER_MATCHED'?'Player ID and team match the provider’s event roster. This is not independent confirmation of participation.':'Current roster identity has not been independently verified.');

 add(details,'p','Model status: '+row.status+'. '+row.reason);
 add(details,'p','Provider player ID: '+(row.playerID||'N/A')+' · Event ID: '+(row.eventID||'N/A')+' · Period: '+(row.period||'N/A'));
 if(row.nameSource==='provider-id')add(details,'p','Display name was formatted from the provider ID. This is not verified roster identity.');
 if(row.observationHistory?.length){const history=add(details,'details',undefined,'observation-history');add(history,'summary',row.observationHistory.length+' previous observations');for(const old of row.observationHistory){add(history,'p',`${date(old.updatedAt)} · ${bookLabel(old.book)} · ${old.side} ${old.line??'N/A'} · ${old.available===false?'unavailable':odds(old.odds)}`);}}

 for(const {title,feature:f} of evidence){add(details,'h4',title);add(details,'p','Source: '+(f.source||'Unknown')+'. Observed: '+date(f.observedAt)+'. Data cutoff: '+date(f.cutoff)+'. '+(f.method||f.coverageReason||f.missingReason||'Exploratory sample')+'.');}

 add(details,'p','EPA means expected points added: estimated scoring value created by a play. Historical publication times are not verified. Context influence remains zero.');

 appendDeepDive(details,row,{scope:'research',presentation:{title:'NOT CLEARED — research only',reason:'This estimate has not earned live approval.'}});
 section('Saving this prop','Shortlist saves it only while this page stays open. It does not place a bet or record a model prediction.');

}

function changeView(sport,kind){shown=24;shortlist=false;for(const id of ['query','book','market','game','side','research-status','freshness'])$(id).value='';$('best-prices').checked=false;loader.load(sport,kind);}

for(const tab of document.querySelectorAll('[data-sport]'))tab.onclick=()=>changeView(tab.dataset.sport,loader.state.kind);

for(const tab of document.querySelectorAll('[data-kind]'))tab.onclick=()=>changeView(tab.dataset.kind==='props'&&!['NBA','NFL'].includes(loader.state.sport)?'NBA':loader.state.sport,tab.dataset.kind);

$('league-form').onsubmit=e=>{e.preventDefault();const league=$('league-code').value.trim().toUpperCase();if(/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(league))changeView(league,'games');};

for(const id of ['query','book','market','freshness','best-prices','side','game','research-status','sort'])$(id).addEventListener(id==='query'?'input':'change',()=>{shown=24;render();});

$('research-filter-toggle').addEventListener('click',()=>{const panel=$('research-filters');panel.hidden=!panel.hidden;$('research-filter-toggle').setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)$('query').focus();});

$('refresh').onclick=()=>loader.load(loader.state.sport,loader.state.kind);$('more').onclick=()=>{shown+=24;render();};$('shortlist-toggle').onclick=()=>{shortlist=!shortlist;shown=24;populate();render();};$('close-detail').onclick=()=>{$('detail').close();selected=null;};$('detail').addEventListener('close',()=>{selected=null;});

setInterval(()=>{render();if($('detail').open)drawDetail();},60000);
const initial=new URLSearchParams(location.search),initialKind=initial.get('kind')==='games'?'games':'props',initialSport=(initial.get('sport')||'NBA').toUpperCase();
loader.load(initialKind==='games'&&/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(initialSport)||initialKind==='props'&&['NBA','NFL'].includes(initialSport)?initialSport:'NBA',initialKind);
