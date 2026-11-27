import {displayPlayerName,formatCentralTime} from './ui-format.js';
import {bookLabel} from './book-catalog.js';
import {applyPlayerPortrait} from './player-portraits.js';
import {reviewedDateWindow,reviewedDay as day} from './reviewed-picks-contract.js';

const CONTRACT='edge-reviewed-picks-v1',STALE_MS=120000;
const centralTime=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'});
const calendarDate=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',year:'numeric',month:'short',day:'numeric'});
const sports=new Set(['NBA','NFL','NHL','MLB','CFB','NCAAF']);
const reportedDecisions=new Set(['BUY','AVOID','WATCH','PASS']);
const updateDecisions=new Set(['AVOID','WATCH','PASS','REVERSED']);
const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const timestamp=value=>typeof value==='string'&&day(value)!==null?Date.parse(value):null;
const validOdds=value=>Number.isInteger(value)&&Math.abs(value)>=100&&Math.abs(value)<=100000;
const odds=value=>validOdds(value)?(value>0?'+':'')+value:'N/A';
const marketLabel=value=>({points_assists:'points + assists',points_rebounds:'points + rebounds',rebounds_assists:'rebounds + assists',points_rebounds_assists:'points + rebounds + assists',pra:'points + rebounds + assists'}[value]||String(value??'').replaceAll('_',' '));
const decisionLabel=value=>({SELECT_RESEARCH:'RESEARCH',SELECT_RESEARCH_PRICE_CONDITIONAL:'CONDITIONAL RESEARCH',RETAIN:'RETAINED',REPORTED_SELECTION:'REPORTED SELECTION'}[value]||value);
const title=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,letter=>letter.toUpperCase());
const teamMarket=pick=>['moneyline','spread','total'].includes(pick.marketType)&&pick.playerId==null;
const matchupLabel=pick=>typeof pick.matchup==='string'?text(pick.matchup):pick.matchup?.away&&pick.matchup?.home?`${pick.matchup.away} vs ${pick.matchup.home}`:null;
const selection=pick=>`${title(pick.side)}${finite(pick.line)?' '+pick.line:''} ${marketLabel(pick.marketType)}${pick.marketScope==='FULL_GAME'?'':' · '+title(pick.marketScope)}`;
const recordedPrice=pick=>pick.historyOnly===true&&!text(pick.book)&&pick.odds===null?'Original book and price unavailable':
 pick.historyOnly===true?`${text(pick.book)?bookLabel(pick.book):'Original book unavailable'} · ${pick.odds===null?'Original price unavailable':'Recorded '+odds(pick.odds)}`:
 `${bookLabel(pick.book)} · Recorded ${odds(pick.odds)}`;

function validateFeed(body,now,sport){
 const generated=timestamp(body?.generatedAt),window=generated===null?null:reviewedDateWindow(sport,generated);
 if(body?.contract!==CONTRACT||body.sport!==sport||body.timezone!=='America/Chicago'||!Array.isArray(body.picks)||
    generated===null||generated>now||body.date!==day(generated)||body.dateWindow?.fromDate!==window?.fromDate||body.dateWindow?.toDate!==window?.toDate)throw Error('Invalid review feed');
 const ids=new Set();
 for(const pick of body.picks){
  const issued=timestamp(pick?.issuedAt),recorded=timestamp(pick?.recordedAt),history=pick?.historyOnly===true,update=pick?.reviewUpdate;
  const originalValid=history?
   sport==='NFL'&&pick.decision==='REPORTED_SELECTION'&&reportedDecisions.has(pick.reportedDecision)&&pick.sourceLabel==='Reported selection'&&
    (pick.book===null||Boolean(text(pick.book)))&&(pick.odds===null||validOdds(pick.odds))&&(pick.issuedAt===null||issued!==null):
   pick.reportedDecision==null&&pick.sourceLabel==='Manual review'&&Boolean(text(pick.book))&&validOdds(pick.odds)&&issued!==null;
  if(!text(pick?.id)||ids.has(pick.id)||pick.sport!==sport||!text(pick.eventId)||timestamp(pick.startsAt)===null||
     !text(pick.marketType)||!text(pick.marketScope)||!text(pick.side)||!text(pick.decision)||!originalValid||
     (pick.historyOnly!==undefined&&typeof pick.historyOnly!=='boolean')||
     (!finite(pick.line)&&pick.marketType!=='moneyline')||(!text(pick.playerId)&&!teamMarket(pick))||
     recorded===null||(issued!==null&&issued>recorded)||recorded>now||
     (pick.priceLimit!==null&&pick.priceLimit!==undefined&&!validOdds(pick.priceLimit)))throw Error('Invalid review record');
  if(update!=null&&(!updateDecisions.has(update.decision)||timestamp(update.issuedAt)===null||timestamp(update.issuedAt)>recorded||(issued!==null&&timestamp(update.issuedAt)<issued)||!text(update.note)||update.note.length>500))throw Error('Invalid review update');
  ids.add(pick.id);
 }
 return body;
}

// This feed publishes recorded manual reviews. Its refresh clock says whether
// the review status was updated; it never verifies the availability of a price.
export function mountReviewedPicks({
 document:doc=globalThis.document,mount=doc?.querySelector('[data-reviewed-picks-mount]'),
 now=()=>Date.now(),fetchImpl=globalThis.fetch,
 setIntervalImpl=globalThis.setInterval,clearIntervalImpl=globalThis.clearInterval,
 setTimeoutImpl=globalThis.setTimeout,clearTimeoutImpl=globalThis.clearTimeout
}={}){
 if(!mount)return null;
 const sport=(text(mount.getAttribute('data-reviewed-sport'))||'NBA').toUpperCase();if(!sports.has(sport))return null;
 const heading=sport==='NBA'?'Today’s reviewed picks':sport+' reviewed picks';
 const add=(parent,tag,value,className)=>{const node=doc.createElement(tag);if(value!==undefined)node.textContent=value;if(className)node.className=className;parent.append(node);return node;};
 mount.className='reviewed-picks-board';mount.setAttribute('aria-labelledby','reviewed-picks-title');mount.replaceChildren();
 const head=add(mount,'div',undefined,'target-board-head reviewed-board-head');add(head,'h2',heading).id='reviewed-picks-title';
 const actions=sport==='NFL'?add(head,'div',undefined,'reviewed-board-actions'):head,count=add(actions,'span','Count unavailable','reviewed-active-count');
 const reviewRefresh=sport==='NFL'?add(actions,'button',undefined,'edge-icon-button'):null;
 if(reviewRefresh){reviewRefresh.type='button';reviewRefresh.setAttribute('data-reviewed-refresh','');reviewRefresh.setAttribute('aria-label','Refresh '+sport+' reviewed picks');reviewRefresh.title='Refresh '+sport+' reviewed picks';const refreshIcon=add(reviewRefresh,'img');refreshIcon.src='/assets/icons/refresh.svg';refreshIcon.alt='';}
 const windowNote=sport==='NFL'?add(mount,'p','','reviewed-window-note'):null;
 const list=add(mount,'div',undefined,'live-cards reviewed-picks-list');
 const status=add(mount,'p','Loading published reviews…','reviewed-feed-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 add(mount,'p',sport==='NFL'?'Reported history is separate from current reviewed BUYs. Prices are recorded, where available.':'Manual review · Recorded prices; check the current price with the book.','board-note');
 let data=null,failed=false,pending=null,disposed=false,lastFingerprint='';
 const expanded=new Set();
 const windowPicks=time=>{const window=reviewedDateWindow(sport,time);return (data?.picks??[]).filter(pick=>{const date=day(timestamp(pick.startsAt));return date&&date>=window.fromDate&&date<=window.toDate;}).sort((a,b)=>timestamp(a.startsAt)-timestamp(b.startsAt)||a.id.localeCompare(b.id));};
 const fresh=time=>Boolean(data&&!failed&&data.date===day(time)&&time-timestamp(data.generatedAt)>=0&&time-timestamp(data.generatedAt)<=STALE_MS);
 const fingerprint=time=>JSON.stringify([day(time),fresh(time),failed,windowPicks(time).map(pick=>[pick.id,timestamp(pick.startsAt)<=time])]);
 function disclosure(parent,key,className){const node=add(parent,'details',undefined,className);node.setAttribute('data-reviewed-disclosure',key);node.open=expanded.has(key);return node;}
 function summary(parent,label,key,className){const node=add(parent,'summary',label,className);node.setAttribute('data-reviewed-focus',key);return node;}
 function render(){
  const time=now(),picks=windowPicks(time),current=fresh(time),active=doc.activeElement;
  const focusKey=list.contains(active)?active?.getAttribute?.('data-reviewed-focus'):null;
  for(const node of list.querySelectorAll('[data-reviewed-disclosure]')){const key=node.getAttribute('data-reviewed-disclosure');if(node.open)expanded.add(key);else expanded.delete(key);}
  list.replaceChildren();
  const countLabel=current?`${picks.filter(pick=>pick.historyOnly!==true&&pick.decision==='BUY'&&timestamp(pick.startsAt)>time).length} upcoming BUYs`:'Count unavailable';
  count.textContent=sport==='NFL'&&data?`${picks.length} saved review${picks.length===1?'':'s'} · ${countLabel}`:countLabel;
  if(windowNote){const window=reviewedDateWindow(sport,time);windowNote.textContent=`Game dates: ${calendarDate.format(Date.parse(window.fromDate+'T12:00:00Z'))} – ${calendarDate.format(Date.parse(window.toDate+'T12:00:00Z'))} · CT`;}
  if(failed)status.textContent='Review refresh failed. Saved reviews are shown; current review status is unavailable.';
  else if(data&&!current)status.textContent='Review status needs a refresh. Saved reviews are shown; current review status is unavailable.';
  else if(data)status.textContent='Review status updated '+formatCentralTime(data.generatedAt)+'.';
  else status.textContent='Loading published reviews…';
  if(!picks.length)add(list,'p',current?(sport==='NFL'?'No published NFL reviews in this date window.':'No published reviews for today.'):failed||data?heading+' are unavailable. Use refresh to try again.':'Loading published reviews…','empty');
  for(const pick of picks){
   const history=pick.historyOnly===true,started=timestamp(pick.startsAt)<=time,buy=!history&&current&&!started&&pick.decision==='BUY';
   const badge=history?'Reported prior '+pick.reportedDecision:started?'GAME STARTED':!current?'SAVED REVIEW':pick.decision==='BUY'?'REVIEWED BUY':'REVIEWED '+decisionLabel(pick.decision);
   const matchup=matchupLabel(pick),isTeam=teamMarket(pick),name=isTeam?matchup||sport+' game':displayPlayerName(pick.playerName,pick.playerId).name;
   const row=disclosure(list,pick.id,'player-market-row prop-card reviewed-pick-row');row.setAttribute('data-reviewed-pick',pick.id);
   const top=summary(row,undefined,pick.id,'player-row-summary'),copy=add(top,'span',undefined,'player-row-label');
   add(copy,'h3',name,'player-row-heading');
   add(copy,'span',selection(pick),'player-row-market');
   if(sport==='NFL')add(copy,'span',formatCentralTime(pick.startsAt),'reviewed-row-date');
   add(copy,'span',recordedPrice(pick),'reviewed-row-price');
   add(copy,'span',badge,'reviewed-row-status '+(buy?'reviewed-buy':''));
   if(history)add(copy,'span',[started?'Game started':null,!current?'Saved review':null,'Original review unverified'].filter(Boolean).join(' · '),'reviewed-row-context');
   if(pick.reviewUpdate)add(copy,'span','Later review: '+pick.reviewUpdate.decision+' at changed terms','reviewed-row-update');
   add(top,'span','Back to reviewed picks','player-row-back');const arrow=add(top,'img',undefined,'player-row-chevron');arrow.src='/assets/icons/chevron-right.svg';arrow.alt='';
   const contents=add(row,'div',undefined,'player-market-content'),card=add(contents,'article',undefined,'target-player-card prop-selection reviewed-pick-card');
   const meta=add(card,'div',undefined,'target-card-meta');
   const game=add(meta,'span',[sport,matchup,sport==='NFL'?formatCentralTime(pick.startsAt):centralTime.format(timestamp(pick.startsAt))+' CT'].filter(Boolean).join(' · '),'target-card-game');game.setAttribute('title',formatCentralTime(pick.startsAt));
   add(meta,'span',badge,'badge '+(buy?'good':'neutral'));
   const showPortrait=!isTeam&&sport==='NBA',identity=add(card,'div',undefined,'target-player-identity'+(!showPortrait?' reviewed-game-identity':''));
   if(showPortrait){const portrait=add(identity,'img',undefined,'target-player-portrait');applyPlayerPortrait(portrait,pick.playerId);}
   const player=add(identity,'div',undefined,'target-player-copy');add(player,'h3',name,'player-name');add(player,'p',selection(pick),'target-card-selection');add(player,'p',recordedPrice(pick),'target-card-book');
   add(card,'p',`${pick.sourceLabel}${history?' · History only; original review unverified':''}${!current?' · Saved review':''}${started?' · Game started':''}${validOdds(pick.priceLimit)?' · Price limit: '+odds(pick.priceLimit)+' or better':''}`,'target-card-reason');
   if(pick.reviewUpdate)add(card,'p','Later review: '+pick.reviewUpdate.decision+' at changed terms','reviewed-card-update');
   const details=disclosure(card,pick.id+':details','target-research-details');summary(details,history?'Reported selection & later review':'Review & recorded price',pick.id+':details');
   add(details,'p',`${history?'Reported prior '+pick.reportedDecision:'Recorded decision: '+pick.decision} · Source: ${pick.sourceLabel}`);
   if(history){add(details,'p','Original recommendation unverified.');add(details,'p',recordedPrice(pick)+'.');}
   else add(details,'p',`Recorded price: ${bookLabel(pick.book)} ${odds(pick.odds)}. Current price availability is not verified by this review.`);
   if(validOdds(pick.priceLimit))add(details,'p',`Price limit: ${odds(pick.priceLimit)} or better. This is the original review condition.`);
   if(history){add(details,'p',pick.issuedAt===null?'Original review time unavailable.':'Original review time: '+formatCentralTime(pick.issuedAt));add(details,'p','Captured '+formatCentralTime(pick.recordedAt));}
   else add(details,'p',`Reviewed ${formatCentralTime(pick.issuedAt)} · Saved ${formatCentralTime(pick.recordedAt)}`);
   add(details,'p',`Game time: ${formatCentralTime(pick.startsAt)}`);
   if(text(pick.reviewNote))add(details,'p',pick.reviewNote);
   if(pick.reviewUpdate){add(details,'p',`Later review: ${pick.reviewUpdate.decision} at changed terms · ${formatCentralTime(pick.reviewUpdate.issuedAt)}`);add(details,'p',pick.reviewUpdate.note);}
  }
  // A focused summary is visible even when its own disclosure is closed.
  // Restore only enclosing disclosures so refresh never opens that summary.
  if(focusKey)for(const node of list.querySelectorAll('[data-reviewed-focus]'))if(node.getAttribute('data-reviewed-focus')===focusKey){for(let ancestor=node.parentElement?.parentElement;ancestor&&ancestor!==list;ancestor=ancestor.parentElement)if(ancestor.tagName==='DETAILS')ancestor.open=true;node.focus({preventScroll:true});break;}
  lastFingerprint=fingerprint(time);
 }
 async function refresh(){
  if(disposed)return;
  pending?.abort();const request=new AbortController();pending=request;const timeout=setTimeoutImpl(()=>request.abort(),20000);
  reviewRefresh?.setAttribute('aria-busy','true');
  try{
   const response=await fetchImpl('/api/dashboard?reviewedPicks=1&sport='+sport,{cache:'no-store',signal:request.signal});
   if(!response.ok)throw Error('Unavailable');
   const body=validateFeed(await response.json(),now(),sport);
   if(pending===request&&!disposed){data=body;failed=false;}
  }catch{if(pending===request&&!disposed)failed=true;}
  finally{clearTimeoutImpl(timeout);if(pending===request&&!disposed){reviewRefresh?.setAttribute('aria-busy','false');render();}}
 }
 const refreshButton=doc.getElementById('refresh');refreshButton?.addEventListener('click',refresh);
 reviewRefresh?.addEventListener('click',refresh);
 render();refresh();
 const poll=setIntervalImpl(refresh,60000),clock=setIntervalImpl(()=>{if(!disposed&&fingerprint(now())!==lastFingerprint)render();},1000);
 return {refresh,destroy(){disposed=true;pending?.abort();clearIntervalImpl(poll);clearIntervalImpl(clock);refreshButton?.removeEventListener('click',refresh);reviewRefresh?.removeEventListener('click',refresh);}};
}

if(typeof document!=='undefined')mountReviewedPicks();
