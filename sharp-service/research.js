import {currentCfbForecasts} from './cfb-research.js';
import {appendDeepDive,preserveDeepDives} from './deep-dive.js';
import {filterResearch,refreshResearchRow} from './research-data.js';
import {createResearchLoader} from './research-loader.js';
import {bookLabel,platformType} from './prop-price-checks.js';
import {appendDfsWorksheet} from './dfs-payout-worksheet.js';
import {compareResearchPrices} from './research-comparison.js';
const $=id=>document.getElementById(id);
const add=(parent,tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;parent.append(node);return node;};
const label=value=>String(value??'').replaceAll('_',' ');
const pct=value=>value===null?'Unavailable':`${(value*100).toFixed(1)}%`;
const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'Unavailable';
const odds=value=>value===null?'Odds unavailable':`${value>0?'+':''}${value}`;
const priceLabel=row=>row.platformType==='dfs'?'Entry payout required':row.platformType==='exchange'?'Executable contract price unverified':odds(row.odds);
const difference=row=>row.model===null||row.market===null?'Unavailable':`${((row.model-row.market)*100).toFixed(1)} pp`;
const saved=new Map();let shortlist=false,shown=40,selected=null;
const loader=createResearchLoader({onChange:state=>{
 if(state.status==='loading'){$('detail').close();selected=null;}else populate();
 render();
 if(state.status==='ready'&&selected&&$('detail').open){selected=state.rows.find(row=>row.id===selected.id)||selected;drawDetail();}
}});
function button(parent,text,handler){const node=add(parent,'button',text);node.type='button';node.onclick=handler;return node;}
function current(row){return refreshResearchRow(row);}
function sourceRows(){const live=new Map(loader.state.rows.map(r=>[r.id,r]));return (shortlist?[...saved.values()].filter(r=>r.sport===loader.state.sport&&(r.kind||'props')===loader.state.kind).map(r=>live.get(r.id)||r):loader.state.rows).map(current).filter(r=>Date.parse(r.startsAt)>Date.now());}
function comparisonIndex(){const observations=new Map([...saved.values(),...loader.state.rows].map(r=>[r.id,r]));return compareResearchPrices([...observations.values()]);}
function appendComparison(parent,row,comparison){
 const block=add(parent,'div',undefined,'price-comparison');
 if(!comparison||comparison.eligibleBooks<2){add(block,'strong',comparison?.eligibleBooks===1?'Only one comparable book':'Price comparison unavailable');add(block,'p','Needs fresh, complete sportsbook prices for this exact selection.');return;}
 add(block,'strong',comparison.best?'BEST OBSERVED PRICE':'Compare the exact price');
 add(block,'p',`${comparison.eligibleBooks} comparable books · best observed ${odds(comparison.bestOdds)}`);
 add(block,'p',comparison.referenceProbability===null?'Market reference needs more other-book coverage.':`Market reference: ${pct(comparison.referenceProbability)} · ${comparison.referenceBooks.length} other ${comparison.referenceKind==='sharp'?'sharp ':''}books`);
 add(block,'small','Verify your account access and current price. This is a market comparison, not a forecast or a cleared play.');
}
function populate(){for(const [id,key,title] of [['book','book','All platforms'],['market','marketType','All markets']]){const select=$(id),previous=select.value;select.replaceChildren();const first=add(select,'option',title);first.value='';const configured=id==='book'?(loader.state.bookCoverage?.configured??[]):[];for(const value of [...new Set([...sourceRows().map(r=>r[key]),...configured])].sort()){const opt=add(select,'option',id==='book'?bookLabel(value):label(value));opt.value=value;}if([...select.options].some(o=>o.value===previous))select.value=previous;}}
function renderCoverage(state,rows){
 const target=$('platform-coverage'),expanded=target.querySelector('details')?.open||false;target.replaceChildren();
 const books=state.bookCoverage?.configured;if(!Array.isArray(books)||state.status!=='ready'){target.hidden=true;return;}target.hidden=false;
 add(target,'h2','Platform coverage & payout checks');add(target,'p','All account-entitled books are requested. This bounded refresh may not contain every market. A fresh line or complete price pair does not clear a play. Both validation models remain frozen.','muted');
 const details=add(target,'details');details.open=expanded;add(details,'summary',books.length+' monitored or observed platforms · view coverage');const grid=add(details,'div',undefined,'platform-grid');
 for(const book of books){const subset=rows.filter(r=>r.book===book),card=add(grid,'article',undefined,'platform-item');add(card,'h3',bookLabel(book));add(card,'strong',`${subset.length} quotes · ${subset.filter(r=>r.freshness==='CURRENT').length} fresh`);const type=platformType(book);add(card,'p',!subset.length?'No available '+state.sport+' '+(state.kind==='games'?'game':'prop')+' lines returned for this platform.':type==='dfs'?'Entry payout and pick rules still required.':type==='exchange'?'Contract identity, executable price, depth and fees still required.':`${subset.filter(r=>r.priceCheck?.status==='COMPARABLE').length} prices have a fresh matching opposite side.`);}
}
function render(){
 const state=loader.state,all=sourceRows(),comparisons=comparisonIndex();const rows=filterResearch(all,{query:$('query').value,book:$('book').value,market:$('market').value,freshness:$('freshness').value}).filter(row=>!$('best-prices').checked||comparisons.get(row.id)?.best);
 $('refresh').disabled=state.status==='loading';$('count').textContent=state.status==='ready'?state.rows.length:'—';$('modeled').textContent=state.status==='ready'?all.filter(r=>r.model!==null).length:'—';$('fresh').textContent=state.status==='ready'?all.filter(r=>r.freshness==='CURRENT').length:'—';$('saved-count').textContent=saved.size;
 renderCfbSummary(state,all);
 const isCfb=state.sport==='NCAAF'&&state.kind==='games';$('play-readiness').textContent=isCfb?'CFB predictions · research, not cleared plays':'No cleared player-prop plays';for(const p of $('play-readiness').parentElement.querySelectorAll('p'))p.hidden=isCfb;
 $('shortlist-toggle').textContent=shortlist?'Back to board':'View shortlist';$('shortlist-toggle').setAttribute('aria-pressed',String(shortlist));
 for(const tab of document.querySelectorAll('[data-sport]')){tab.setAttribute('aria-pressed',String(tab.dataset.sport===state.sport));tab.hidden=state.kind==='props'&&!['NBA','NFL'].includes(tab.dataset.sport);}
 for(const tab of document.querySelectorAll('[data-kind]'))tab.setAttribute('aria-pressed',String(tab.dataset.kind===state.kind));$('other-league').hidden=state.kind!=='games';
 renderCoverage(state,state.rows.map(current).filter(r=>Date.parse(r.startsAt)>Date.now()));
 $('status').textContent=(state.message?`${state.message} `:'')+(state.status==='ready'||shortlist?`${rows.length} matching ${shortlist?'shortlisted':'research'} quotes · ${state.sport} · ${state.provider||'Provider unavailable'} · response ${date(state.generatedAt)}`:'');
 const target=$('cards');preserveDeepDives(target);target.replaceChildren();$('more').hidden=rows.length<=shown;
 if(!rows.length){add(target,'div',state.status==='loading'&&!shortlist?'Fetching quotes and research estimates…':state.status==='error'&&!shortlist?'Quotes could not be loaded. This does not mean every market is PASS.':shortlist?'No upcoming shortlisted quotes match these filters. Shortlists are kept only for this page session.':all.length?'No quotes match these filters.':'No upcoming quotes were returned. Coverage may be unavailable or outside the provider window.','empty');return;}
 for(const row of rows.slice(0,shown)){
  const card=add(target,'article',undefined,'card');const head=add(card,'div',undefined,'card-head');add(head,'h3',row.player);add(head,'span','NOT CLEARED','badge');add(card,'p',`${row.away||'Away unavailable'} @ ${row.home||'Home unavailable'} · ${date(row.startsAt)}`,'match');add(card,'small',label(row.marketType).toUpperCase()+(row.period?' · '+(row.period==='reg'?'REGULATION':row.period==='game'?'FULL GAME':'PERIOD UNVERIFIED'):''));add(card,'p',`${row.side} ${row.kind==='games'&&row.line===null?'':row.line??'Line unavailable'}`,'selection');add(card,'p',`${bookLabel(row.book)} · ${priceLabel(row)}`,'quote');
  const platformSpecific=['dfs','exchange'].includes(row.platformType);
  const compare=add(card,'div',undefined,'comparison');for(const [name,value] of (platformSpecific?[['Model chance*',pct(row.model)],['Payout / cost','Unverified'],['Value check','Unavailable']]:[['Model chance*',pct(row.model)],['Book chance',pct(row.market)],['Gap (points)',difference(row).replace(' pp','')]])){const cell=add(compare,'div');add(cell,'small',name);add(cell,'strong',value);}
  appendComparison(card,row,comparisons.get(row.id));
  if(row.priceCheck)add(card,'p',row.priceCheck.summary,'price-readiness');
  add(card,'p',`${row.freshness} timestamp · ${date(row.updatedAt)}`,'freshness '+(row.freshness==='CURRENT'?'current':''));
  add(card,'p',['SHADOW','RESEARCH'].includes(row.status)?'Research only. The model chance is experimental; it is not a betting recommendation.':'Research only. This line has no validated prediction attached.','match');
  if(row.kind!=='games')appendDeepDive(card,row,{scope:'research',presentation:{title:'NOT CLEARED — research only',reason:'This estimate has not earned live approval.'}});
  const actions=add(card,'div',undefined,'actions');button(actions,'Why isn’t this cleared?',()=>openDetail(row));button(actions,saved.has(row.id)?'Remove saved':'Shortlist +',()=>{if(saved.has(row.id))saved.delete(row.id);else saved.set(row.id,structuredClone(row));render();});
 }
 $('more').textContent=`Show more · ${Math.min(shown,rows.length)} of ${rows.length}`;
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
 const grid=add(target,'div',undefined,'cards');for(const f of unique){const card=add(grid,'article',undefined,'card');add(card,'h3',`${f.awayName} @ ${f.homeName}`);add(card,'p',date(f.startsAt),'match');add(card,'strong',`${f.homeName}: ${pct(f.homeProbability)} · ${f.awayName}: ${pct(f.awayProbability)}`);add(card,'p','Forecast '+date(f.generatedAt)+' · NOT CLEARED','muted');appendCfbExplanation(card,f);if(rows.some(r=>r.eventID===f.eventID&&r.cfbForecast&&r.model!==null))button(card,'Compare prices',()=>{$('query').value=f.homeName;$('market').value='moneyline';shown=40;render();$('research-board').scrollIntoView({behavior:'smooth'});});else add(card,'p','Book comparison unavailable: '+(f.quoteComparisonEligible===false?'the provider kickoff conflicts with the verified schedule.':'no exact matching quotes in this refresh.'),'muted');if(f.scheduleVerification){const detail=add(card,'details');add(detail,'summary','Verified schedule and price restriction');add(detail,'p',f.scheduleVerification.explanation);add(detail,'p','Provider kickoff: '+date(f.providerStartsAt)+'. Verified schedule: '+date(f.startsAt)+'. Reviewed: '+date(f.scheduleVerification.reviewedAt));for(const url of f.scheduleVerification.sources||[]){if(typeof url==='string'&&url.startsWith('https://')){const link=add(detail,'a',new URL(url).hostname);link.href=url;link.target='_blank';link.rel='noopener noreferrer';add(detail,'br');}}}}
}
function drawDetail(){
 if(!selected)return;
 const expanded=$('detail-body').querySelector('details')?.open||false;
 const row=current(selected),context=row.context,body=$('detail-body');
 const priorWorksheet=body.querySelector('.payout-worksheet');
 $('detail-title').textContent=row.player;body.replaceChildren();
 const section=(heading,copy,className='detail-section')=>{const block=add(body,'section',undefined,className);add(block,'h3',heading);if(copy)add(block,'p',copy);return block;};
 const number=v=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(1):null;
 const unit=label(row.marketType).replace('receiving receptions','receptions');
 add(body,'p',row.kind==='games'?label(row.marketType)+' · '+row.side+' '+(row.line??'')+' · '+(row.period==='reg'?'Regulation':row.period==='game'?'Full game':'Period unverified'):(row.side==='OVER'?'More than':'Less than')+' '+(row.line??'?')+' '+unit,'selection');
 add(body,'p',bookLabel(row.book)+' · '+priceLabel(row)+' · '+date(row.startsAt),'muted');
 section('NOT CLEARED — research only',row.model===null?'This line has no validated prediction attached. Platform checks and player availability still matter.':'The model is still being tested. Its estimated chance has not earned approval for live plays.','decision-summary');
 appendComparison(body,row,comparisonIndex().get(row.id));
 if(row.priceCheck){const block=section('Price and payout checks',row.priceCheck.summary);const list=add(block,'ul');for(const reason of row.priceCheck.reasons)add(list,'li',reason);}
 if(row.platformType==='dfs'){
  section('Why there is no book percentage','The provider’s indicative odds are not the payout for this DFS entry. Check the actual lineup type, every payout tier, pick multipliers, promotions, correlations and settlement rules. No 50% probability is inferred from +100.');
  if(priorWorksheet?.dataset.quoteId===row.id&&priorWorksheet.dataset.observedAt===row.generatedAt)body.append(priorWorksheet);
  else {appendDfsWorksheet(body,row);const sheet=body.querySelector('.payout-worksheet');sheet.dataset.quoteId=row.id;sheet.dataset.observedAt=row.generatedAt;}
 }else if(row.platformType==='exchange')section('Why the exchange cost is unverified','This provider record does not identify the exact contract and executable order book. Americanized indicative odds cannot substitute for an ask price, size, fees and settlement terms. No cost-based probability or expected profit is shown.');
 else section('What the percentages mean','Model chance: '+pct(row.model)+'. Book chance: '+pct(row.market)+'. A book percentage requires fresh opposing prices from the exact book and line. Integer lines can push, so their unconditional percentage is withheld. A gap does not prove an advantage.');
 if(row.freshness!=='CURRENT')section('Quotes need refreshing',row.freshness==='STALE'?'These quotes exceed the freshness limit. The market comparison is hidden until fresh prices arrive.':'We cannot verify when these quotes were updated. The market comparison is hidden.');
 if(row.cfbForecast)appendCfbExplanation(body,row.cfbForecast);
 if(row.kind==='games'){section('Game market rules','Compare only the same period, outcome structure and line. Regulation and full-game markets can settle differently. Provider prices do not confirm identical house rules, limits or account eligibility.');section('Sources and decision status','Source: '+(row.provider||'Unknown')+'. Quote updated '+date(row.updatedAt)+'. Provider fetched '+date(row.generatedAt)+(row.cfbForecast?'. Independent CFB research estimate attached; not approved for PLAY.':'. No game model is attached to these quotes; check the cleared team plays page for current decisions.'));section('Market reference','The reference excludes this book. It uses the median no-vig chance from at least two other sharp books, or at least three other sportsbooks. Books may share information; this is not a validated probability or a count of independent samples.');return;}
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
 for(const {title,feature:f} of evidence){add(details,'h4',title);add(details,'p','Source: '+(f.source||'Unknown')+'. Observed: '+date(f.observedAt)+'. Data cutoff: '+date(f.cutoff)+'. '+(f.method||f.coverageReason||f.missingReason||'Exploratory sample')+'.');}
 add(details,'p','EPA means expected points added: estimated scoring value created by a play. Historical publication times are not verified. Context influence remains zero.');
 section('Saving this prop','Shortlist saves it only while this page stays open. It does not place a bet or record a model prediction.');
}
function changeView(sport,kind){shown=40;shortlist=false;for(const id of ['query','book','market'])$(id).value='';$('best-prices').checked=false;loader.load(sport,kind);}
for(const tab of document.querySelectorAll('[data-sport]'))tab.onclick=()=>changeView(tab.dataset.sport,loader.state.kind);
for(const tab of document.querySelectorAll('[data-kind]'))tab.onclick=()=>changeView(tab.dataset.kind==='props'&&!['NBA','NFL'].includes(loader.state.sport)?'NBA':loader.state.sport,tab.dataset.kind);
$('league-form').onsubmit=e=>{e.preventDefault();const league=$('league-code').value.trim().toUpperCase();if(/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(league))changeView(league,'games');};
for(const id of ['query','book','market','freshness','best-prices'])$(id).addEventListener(id==='query'?'input':'change',()=>{shown=40;render();});
$('refresh').onclick=()=>loader.load(loader.state.sport,loader.state.kind);$('more').onclick=()=>{shown+=40;render();};$('shortlist-toggle').onclick=()=>{shortlist=!shortlist;shown=40;populate();render();};$('close-detail').onclick=()=>{$('detail').close();selected=null;};$('detail').addEventListener('close',()=>{selected=null;});
setInterval(()=>{render();if($('detail').open)drawDetail();},60000);const initial=new URLSearchParams(location.search);if(['CFB','NCAAF'].includes(initial.get('sport'))&&initial.get('kind')==='games')loader.load('NCAAF','games');else loader.load('NBA');
