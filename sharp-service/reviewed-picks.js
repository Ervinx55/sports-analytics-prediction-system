import {displayPlayerName,formatCentralTime} from './ui-format.js';
import {bookLabel} from './book-catalog.js';
import {applyPlayerPortrait} from './player-portraits.js';

const CONTRACT='edge-reviewed-picks-v1',STALE_MS=120000;
const centralDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'});
const centralTime=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'});
const day=value=>centralDay.format(value);
const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const timestamp=value=>typeof value==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const validOdds=value=>Number.isInteger(value)&&Math.abs(value)>=100&&Math.abs(value)<=100000;
const odds=value=>validOdds(value)?(value>0?'+':'')+value:'N/A';
const marketLabel=value=>({points_assists:'points + assists',points_rebounds:'points + rebounds',rebounds_assists:'rebounds + assists',points_rebounds_assists:'points + rebounds + assists',pra:'points + rebounds + assists'}[value]||String(value??'').replaceAll('_',' '));
const decisionLabel=value=>({SELECT_RESEARCH:'RESEARCH',SELECT_RESEARCH_PRICE_CONDITIONAL:'CONDITIONAL RESEARCH',RETAIN:'RETAINED',REPORTED_SELECTION:'REPORTED SELECTION'}[value]||value);
const title=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,letter=>letter.toUpperCase());
const teamMarket=pick=>['moneyline','spread','total'].includes(pick.marketType)&&pick.playerId==null;
const matchupLabel=pick=>typeof pick.matchup==='string'?text(pick.matchup):pick.matchup?.away&&pick.matchup?.home?`${pick.matchup.away} vs ${pick.matchup.home}`:null;
const selection=pick=>`${title(pick.side)}${finite(pick.line)?' '+pick.line:''} ${marketLabel(pick.marketType)}${pick.marketScope==='FULL_GAME'?'':' · '+title(pick.marketScope)}`;

function validateFeed(body,now){
 if(body?.contract!==CONTRACT||body.sport!=='NBA'||body.timezone!=='America/Chicago'||!Array.isArray(body.picks)||
    timestamp(body.generatedAt)===null||timestamp(body.generatedAt)>now||body.date!==day(timestamp(body.generatedAt)))throw Error('Invalid review feed');
 const ids=new Set();
 for(const pick of body.picks){
  const issued=timestamp(pick?.issuedAt),recorded=timestamp(pick?.recordedAt);
  if(!text(pick?.id)||ids.has(pick.id)||pick.sport!=='NBA'||!text(pick.eventId)||timestamp(pick.startsAt)===null||
     !text(pick.marketType)||!text(pick.marketScope)||!text(pick.side)||!text(pick.book)||!text(pick.decision)||
     !validOdds(pick.odds)||(!finite(pick.line)&&pick.marketType!=='moneyline')||(!text(pick.playerId)&&!teamMarket(pick))||
     issued===null||recorded===null||issued>recorded||recorded>now||pick.sourceLabel!=='Manual review'||
     (pick.priceLimit!==null&&pick.priceLimit!==undefined&&!validOdds(pick.priceLimit)))throw Error('Invalid review record');
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
 const add=(parent,tag,value,className)=>{const node=doc.createElement(tag);if(value!==undefined)node.textContent=value;if(className)node.className=className;parent.append(node);return node;};
 mount.className='reviewed-picks-board';mount.setAttribute('aria-labelledby','reviewed-picks-title');mount.replaceChildren();
 const head=add(mount,'div',undefined,'target-board-head reviewed-board-head');add(head,'h2','Today’s reviewed picks').id='reviewed-picks-title';
 const count=add(head,'span','Count unavailable','reviewed-active-count');
 const list=add(mount,'div',undefined,'live-cards reviewed-picks-list');
 const status=add(mount,'p','Loading published reviews…','reviewed-feed-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 add(mount,'p','Manual review · Recorded prices; check the current price with the book.','board-note');
 let data=null,failed=false,pending=null,disposed=false,lastFingerprint='';
 const expanded=new Set();
 const todayPicks=time=>(data?.picks??[]).filter(pick=>day(timestamp(pick.startsAt))===day(time)).sort((a,b)=>timestamp(a.startsAt)-timestamp(b.startsAt)||a.id.localeCompare(b.id));
 const fresh=time=>Boolean(data&&!failed&&data.date===day(time)&&time-timestamp(data.generatedAt)>=0&&time-timestamp(data.generatedAt)<=STALE_MS);
 const fingerprint=time=>JSON.stringify([day(time),fresh(time),failed,todayPicks(time).map(pick=>[pick.id,timestamp(pick.startsAt)<=time])]);
 function disclosure(parent,key,className){const node=add(parent,'details',undefined,className);node.setAttribute('data-reviewed-disclosure',key);node.open=expanded.has(key);return node;}
 function summary(parent,label,key,className){const node=add(parent,'summary',label,className);node.setAttribute('data-reviewed-focus',key);return node;}
 function render(){
  const time=now(),picks=todayPicks(time),current=fresh(time),active=doc.activeElement;
  const focusKey=list.contains(active)?active?.getAttribute?.('data-reviewed-focus'):null;
  for(const node of list.querySelectorAll('[data-reviewed-disclosure]')){const key=node.getAttribute('data-reviewed-disclosure');if(node.open)expanded.add(key);else expanded.delete(key);}
  list.replaceChildren();
  count.textContent=current?`${picks.filter(pick=>pick.decision==='BUY'&&timestamp(pick.startsAt)>time).length} upcoming BUYs`:'Count unavailable';
  if(failed)status.textContent='Review refresh failed. Saved reviews are shown; current review status is unavailable.';
  else if(data&&!current)status.textContent='Review status needs a refresh. Saved reviews are shown; current review status is unavailable.';
  else if(data)status.textContent='Review status updated '+formatCentralTime(data.generatedAt)+'.';
  else status.textContent='Loading published reviews…';
  if(!picks.length)add(list,'p',current?'No published reviews for today.':failed||data?'Today’s reviewed picks are unavailable. Use refresh to try again.':'Loading published reviews…','empty');
  for(const pick of picks){
   const started=timestamp(pick.startsAt)<=time,buy=current&&!started&&pick.decision==='BUY';
   const badge=started?'GAME STARTED':!current?'SAVED REVIEW':pick.decision==='BUY'?'REVIEWED BUY':'REVIEWED '+decisionLabel(pick.decision);
   const matchup=matchupLabel(pick),isTeam=teamMarket(pick),name=isTeam?matchup||'NBA game':displayPlayerName(pick.playerName,pick.playerId).name;
   const row=disclosure(list,pick.id,'player-market-row prop-card reviewed-pick-row');row.setAttribute('data-reviewed-pick',pick.id);
   const top=summary(row,undefined,pick.id,'player-row-summary'),copy=add(top,'span',undefined,'player-row-label');
   add(copy,'h3',name,'player-row-heading');
   add(copy,'span',selection(pick),'player-row-market');
   add(copy,'span',`${bookLabel(pick.book)} · Recorded ${odds(pick.odds)}`,'reviewed-row-price');
   add(copy,'span',badge,'reviewed-row-status '+(buy?'reviewed-buy':''));
   add(top,'span','Back to reviewed picks','player-row-back');const arrow=add(top,'img',undefined,'player-row-chevron');arrow.src='/assets/icons/chevron-right.svg';arrow.alt='';
   const contents=add(row,'div',undefined,'player-market-content'),card=add(contents,'article',undefined,'target-player-card prop-selection reviewed-pick-card');
   const meta=add(card,'div',undefined,'target-card-meta');
   const game=add(meta,'span',['NBA',matchup,centralTime.format(timestamp(pick.startsAt))+' CT'].filter(Boolean).join(' · '),'target-card-game');game.setAttribute('title',formatCentralTime(pick.startsAt));
   add(meta,'span',badge,'badge '+(buy?'good':'neutral'));
   const identity=add(card,'div',undefined,'target-player-identity'+(isTeam?' reviewed-game-identity':''));
   if(!isTeam){const portrait=add(identity,'img',undefined,'target-player-portrait');applyPlayerPortrait(portrait,pick.playerId);}
   const player=add(identity,'div',undefined,'target-player-copy');add(player,'h3',name,'player-name');add(player,'p',selection(pick),'target-card-selection');add(player,'p',`${bookLabel(pick.book)} · Recorded ${odds(pick.odds)}`,'target-card-book');
   add(card,'p',`Manual review${!current?' · Saved review':''}${started?' · Game started':''}${validOdds(pick.priceLimit)?' · Price limit: '+odds(pick.priceLimit)+' or better':''}`,'target-card-reason');
   const details=disclosure(card,pick.id+':details','target-research-details');summary(details,'Review & recorded price',pick.id+':details');
   add(details,'p',`Recorded decision: ${pick.decision} · Source: Manual review`);
   add(details,'p',`Recorded price: ${bookLabel(pick.book)} ${odds(pick.odds)}. Current price availability is not verified by this review.`);
   if(validOdds(pick.priceLimit))add(details,'p',`Price limit: ${odds(pick.priceLimit)} or better. This is the original review condition.`);
   add(details,'p',`Reviewed ${formatCentralTime(pick.issuedAt)} · Saved ${formatCentralTime(pick.recordedAt)}`);
   add(details,'p',`Game time: ${formatCentralTime(pick.startsAt)}`);
   if(text(pick.reviewNote))add(details,'p',pick.reviewNote);
  }
  // A focused summary is visible even when its own disclosure is closed.
  // Restore only enclosing disclosures so refresh never opens that summary.
  if(focusKey)for(const node of list.querySelectorAll('[data-reviewed-focus]'))if(node.getAttribute('data-reviewed-focus')===focusKey){for(let ancestor=node.parentElement?.parentElement;ancestor&&ancestor!==list;ancestor=ancestor.parentElement)if(ancestor.tagName==='DETAILS')ancestor.open=true;node.focus({preventScroll:true});break;}
  lastFingerprint=fingerprint(time);
 }
 async function refresh(){
  if(disposed)return;
  pending?.abort();const request=new AbortController();pending=request;const timeout=setTimeoutImpl(()=>request.abort(),20000);
  try{
   const response=await fetchImpl('/api/dashboard?reviewedPicks=1&sport=NBA',{cache:'no-store',signal:request.signal});
   if(!response.ok)throw Error('Unavailable');
   const body=validateFeed(await response.json(),now());
   if(pending===request&&!disposed){data=body;failed=false;}
  }catch{if(pending===request&&!disposed)failed=true;}
  finally{clearTimeoutImpl(timeout);if(pending===request&&!disposed)render();}
 }
 const refreshButton=doc.getElementById('refresh');refreshButton?.addEventListener('click',refresh);
 render();refresh();
 const poll=setIntervalImpl(refresh,60000),clock=setIntervalImpl(()=>{if(!disposed&&fingerprint(now())!==lastFingerprint)render();},1000);
 return {refresh,destroy(){disposed=true;pending?.abort();clearIntervalImpl(poll);clearIntervalImpl(clock);refreshButton?.removeEventListener('click',refresh);}};
}

if(typeof document!=='undefined')mountReviewedPicks();
