import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountReviewedPicks} from '../../sharp-service/reviewed-picks.js';
import * as reviewedPicks from '../../sharp-service/reviewed-picks.js';

const now=Date.parse('2026-11-27T18:00:00Z'),stamp=new Date(now).toISOString();
const pick=(patch={})=>({id:'review-1',sport:'NBA',eventId:'fixture-event',startsAt:new Date(now+3600000).toISOString(),playerId:'DERRICK_WHITE_1_NBA',playerName:'Derrick White',marketType:'rebounds',marketScope:'FULL_GAME',side:'OVER',line:3.5,book:'draftkings',odds:123,decision:'BUY',issuedAt:new Date(now-600000).toISOString(),recordedAt:new Date(now-60000).toISOString(),sourceLabel:'Manual review',matchup:'ATL vs BOS',priceLimit:100,reviewNote:'Original reviewed selection.',...patch});
const feed=(picks=[pick()],patch={})=>({contract:'edge-reviewed-picks-v1',generatedAt:stamp,date:'2026-11-27',dateWindow:{fromDate:'2026-11-27',toDate:'2026-11-27'},timezone:'America/Chicago',sport:'NBA',picks,...patch});
const reported=(patch={})=>pick({sport:'NFL',playerId:'BO_NIX_1_NFL',playerName:'Bo Nix',marketType:'passing_yards',side:'UNDER',line:214.5,startsAt:'2026-11-26T19:00:00Z',book:null,odds:null,issuedAt:null,decision:'REPORTED_SELECTION',historyOnly:true,reportedDecision:'BUY',sourceLabel:'Reported selection',priceLimit:null,matchup:'Denver at Las Vegas',reviewNote:'Original selection reported; exact original price and time were not recovered.',reviewUpdate:{decision:'AVOID',issuedAt:new Date(now-120000).toISOString(),note:'Later review avoided the lower 199.5–202.5 passing-yard lines. This does not establish a withdrawal of the original 214.5 line.'},...patch});
const nflFeed=(picks=[reported()],patch={})=>feed(picks,{sport:'NFL',dateWindow:{fromDate:'2026-11-21',toDate:'2026-12-03'},...patch});
const gamePick=(patch={})=>pick({id:'game-1',playerId:null,playerName:null,marketType:'spread',marketScope:'FULL_GAME',side:'AWAY',line:-9.5,book:'betmgm',odds:-110,priceLimit:-110,matchup:'Denver Nuggets at Utah Jazz',...patch});
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
class Element{
 constructor(tag,document){this.tag=tag;this.ownerDocument=document;this.children=[];this.attributes={};this.dataset={};this.listeners={};this.open=false;this.hidden=false;this._text='';}
 get tagName(){return this.tag.toUpperCase();}
 set textContent(value){this._text=String(value);this.replaceChildren();}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('\n');}
 append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
 replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children);}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key]??null;}
 hasAttribute(key){return Object.hasOwn(this.attributes,key);}
 addEventListener(type,callback){(this.listeners[type]??=[]).push(callback);}
 removeEventListener(type,callback){this.listeners[type]=(this.listeners[type]??[]).filter(fn=>fn!==callback);}
 dispatch(type){for(const callback of this.listeners[type]??[])callback({type,target:this});}
 focus(){this.ownerDocument.activeElement=this;}
 contains(node){return node===this||descendants(this).includes(node);}
 querySelectorAll(selector){const selectors=selector.split(',').map(value=>value.trim());return descendants(this).filter(node=>selectors.some(value=>value[0]==='['?node.hasAttribute(value.slice(1,-1)):value[0]==='.'?node.className?.split(' ').includes(value.slice(1)):node.tag===value));}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
async function widget(initial,{clock=now,sport='NBA',kind='all'}={}){
 let time=clock,response={body:initial,ok:true},calls=0;const timers=[],requests=[];
 const document={activeElement:null},mount=new Element('section',document),refreshButton=new Element('button',document);
 mount.id='reviewed-picks';mount.setAttribute('data-reviewed-sport',sport);refreshButton.id='refresh';document.createElement=tag=>new Element(tag,document);document.getElementById=id=>id==='refresh'?refreshButton:null;
 const controller=mountReviewedPicks({mount,document,kind,now:()=>time,fetchImpl:async(url,options)=>{calls++;requests.push({url,options});if(response.error)throw Error('Synthetic refresh error');return {ok:response.ok,json:async()=>response.body};},setIntervalImpl:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearIntervalImpl:()=>{},setTimeoutImpl:()=>0,clearTimeoutImpl:()=>{}});
 await new Promise(resolve=>setImmediate(resolve));
 return {mount,document,requests,timers,refreshButton,
  get rows(){return mount.querySelectorAll('[data-reviewed-pick]');},get text(){return mount.textContent;},get count(){return mount.querySelector('.reviewed-active-count').textContent;},get calls(){return calls;},
  async refresh(next=initial,{ok=true,error=false}={}){response={body:next,ok,error};await controller.refresh();},
  async manualRefresh(next=initial){response={body:next,ok:true};refreshButton.dispatch('click');await new Promise(resolve=>setImmediate(resolve));},
  async reviewRefresh(next=initial){response={body:next,ok:true};mount.querySelector('[data-reviewed-refresh]').dispatch('click');await new Promise(resolve=>setImmediate(resolve));},
  tick(value){time=value;for(const timer of timers)if(timer.ms===1000)timer.fn();}
 };
}

test('published manual picks expose exact recorded selection and price while collapsed',async()=>{
 const source=feed([pick(),pick({id:'review-2',playerName:'Payton Pritchard',playerId:'PAYTON_PRITCHARD_1_NBA',marketType:'points_assists',line:21.5,book:'betmgm',odds:-105,priceLimit:-110})]),before=JSON.stringify(source),view=await widget(source);
 assert.equal(view.rows.length,2);assert.match(view.count,/2 upcoming/);
 const summary=view.rows[0].querySelector('summary').textContent;
 assert.match(summary,/Derrick White/);assert.match(summary,/Over 3\.5 rebounds/);assert.match(summary,/DraftKings.*Recorded \+123/s);assert.match(summary,/REVIEWED BUY/);
 assert.equal(view.rows[0].open,false);assert.match(view.text,/Manual review/);assert.match(view.text,/Price limit.*\+100 or better/);
 assert.match(view.text,/points \+ assists/);assert.equal(JSON.stringify(source),before);
 assert.equal(view.requests[0].url,'/api/dashboard?reviewedPicks=1&sport=NBA');assert.equal(view.requests[0].options.cache,'no-store');
 assert.ok(view.timers.some(timer=>timer.ms===60000),'reviews poll once per minute');
});

test('manual cards do not manufacture model probabilities or automatic approval',async()=>{
 const view=await widget(feed([pick({modelProbability:.99,productionEligible:true,approvalId:'should-be-ignored'})]));
 assert.equal(view.mount.querySelectorAll('.target-card-metrics').length,0);assert.doesNotMatch(view.text,/99\.0%|Current approval|Automatically approved/);
 assert.match(view.text,/Recorded decision: BUY/);assert.match(view.text,/Recorded price/);
});

test('published team reviews use the matchup subject without inventing a player',async()=>{
 const view=await widget(feed([pick({playerId:null,playerName:null,marketType:'moneyline',side:'HOME',line:null})]));
 assert.equal(view.rows.length,1);assert.match(view.rows[0].querySelector('summary').textContent,/ATL vs BOS/);assert.match(view.text,/Home moneyline · Full game/);
 assert.doesNotMatch(view.text,/Name unavailable/);assert.equal(view.mount.querySelectorAll('.target-player-portrait').length,0);
});

test('Games reviews include team moneyline, spread and total across periods but count only upcoming game BUYs',async()=>{
 const rows=[pick(),gamePick({id:'full-spread'}),gamePick({id:'half-spread',marketScope:'FIRST_HALF',line:-4.5}),gamePick({id:'moneyline',marketType:'moneyline',side:'HOME',line:null}),gamePick({id:'total',marketType:'total',side:'UNDER',line:232.5,decision:'WATCH'}),gamePick({id:'started',startsAt:new Date(now-1000).toISOString()})];
 const source=feed(rows),before=JSON.stringify(source),view=await widget(source,{kind:'games'});
 assert.equal(view.rows.length,5);assert.match(view.count,/3 upcoming BUYs/);
 assert.deepEqual(new Set(view.rows.map(row=>row.getAttribute('data-reviewed-pick'))),new Set(['full-spread','half-spread','moneyline','total','started']));
 assert.match(view.text,/NBA reviewed games/);assert.doesNotMatch(view.text,/Derrick White/);
 assert.match(view.text,/Denver Nuggets -9\.5 · Full game/);assert.match(view.text,/Denver Nuggets -4\.5 · First half/);
 assert.match(view.text,/Utah Jazz moneyline · Full game/);assert.match(view.text,/Under 232\.5 total · Full game/);
 assert.equal(view.mount.querySelectorAll('.target-player-portrait').length,0);assert.equal(JSON.stringify(source),before);
 await view.manualRefresh(source);assert.equal(view.rows.length,5,'refresh cannot duplicate the same journal pick');
 assert.match(view.count,/3 upcoming BUYs/);view.tick(now+3600000);
 await view.refresh(feed(rows,{generatedAt:new Date(now+3600000).toISOString()}));assert.match(view.count,/0 upcoming BUYs/);
});

test('game labels preserve positive spreads and use a neutral side fallback for an ambiguous matchup',async()=>{
 const view=await widget(feed([gamePick({id:'home',matchup:'Los Angeles Lakers @ San Antonio Spurs',side:'HOME',line:6.5,marketScope:'FIRST_HALF'}),gamePick({id:'unknown',matchup:'A game without ordered team names',line:-3.5})]),{kind:'games'});
 assert.match(view.text,/San Antonio Spurs \+6\.5 · First half/);
 assert.match(view.text,/Away -3\.5 · Full game/);assert.doesNotMatch(view.text,/Name unavailable/);
});

test('combined NBA reviewed picks still contain both props and team selections',async()=>{
 const view=await widget(feed([pick(),gamePick()]));
 assert.equal(view.rows.length,2);assert.match(view.count,/2 upcoming BUYs/);
 assert.match(view.text,/Derrick White/);assert.match(view.text,/Denver Nuggets -9\.5 · Full game/);
 assert.match(view.text,/Today’s reviewed picks/);
});

test('Games reviews have an independent refresh while quote loading disables the main refresh',async()=>{
 const source=feed([gamePick()]),view=await widget(source,{kind:'games'}),button=view.mount.querySelector('[data-reviewed-refresh]');
 assert.ok(button);assert.match(button.getAttribute('aria-label'),/Refresh NBA reviewed games/);
 view.refreshButton.disabled=true;await view.reviewRefresh(source);assert.equal(view.calls,2);assert.equal(view.rows.length,1);
});

test('Games controller mounts once per sport and hides unsupported leagues or props without stale rows',()=>{
 const document={activeElement:null},mount=new Element('section',document),calls=[],destroyed=[];
 const controller=reviewedPicks.mountReviewedGames({document,mount,mountPicks:options=>{
  assert.equal(mount.children.length,0);assert.equal(mount.textContent,'','previous sport is cleared before the new request');
  calls.push(options);mount.append(Object.assign(new Element('article',document),{textContent:options.sport}));
  return {destroy(){destroyed.push(options.sport);}};
 }});
 controller.update({sport:'NBA',kind:'games'});controller.update({sport:'NBA',kind:'games',status:'ready'});
 assert.equal(calls.length,1);assert.equal(calls[0].kind,'games');assert.equal(mount.hidden,false);
 controller.update({sport:'NFL',kind:'games'});assert.equal(calls.length,2);assert.deepEqual(destroyed,['NBA']);assert.equal(mount.textContent,'NFL');
 controller.update({sport:'EPL',kind:'games'});assert.equal(mount.hidden,true);assert.equal(mount.children.length,0);assert.deepEqual(destroyed,['NBA','NFL']);
 controller.update({sport:'NBA',kind:'props'});assert.equal(calls.length,2);assert.equal(mount.hidden,true);
 controller.update({sport:'NBA',kind:'games'});assert.equal(calls.length,3);controller.destroy();assert.equal(mount.hidden,true);assert.equal(mount.children.length,0);
});

test('late reviewed responses cannot restore a previous sport after switching Games context',async()=>{
 const document={activeElement:null},mount=new Element('section',document),refreshButton=new Element('button',document),requests=[],cleared=[];
 document.createElement=tag=>new Element(tag,document);document.getElementById=id=>id==='refresh'?refreshButton:null;
 const controller=reviewedPicks.mountReviewedGames({document,mount,now:()=>now,fetchImpl:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve})),setIntervalImpl:(_fn,ms)=>ms,clearIntervalImpl:id=>cleared.push(id),setTimeoutImpl:()=>0,clearTimeoutImpl:()=>{}});
 const respond=async(request,body)=>{request.resolve({ok:true,json:async()=>body});await new Promise(resolve=>setImmediate(resolve));};
 controller.update({sport:'NBA',kind:'games'});await respond(requests[0],feed([gamePick()]));assert.match(mount.textContent,/Denver Nuggets/);
 controller.update({sport:'NFL',kind:'games'});assert.doesNotMatch(mount.textContent,/Denver Nuggets/);assert.equal(mount.querySelectorAll('[data-reviewed-pick]').length,0);
 assert.equal(requests[0].options.signal.aborted,true);assert.ok(cleared.includes(60000)&&cleared.includes(1000));
 assert.equal(requests[1].url,'/api/dashboard?reviewedPicks=1&sport=NFL');
 controller.update({sport:'NHL',kind:'games'});assert.equal(requests[1].options.signal.aborted,true);
 await respond(requests[1],nflFeed([gamePick({sport:'NFL',matchup:'Old NFL away at Old NFL home'})]));assert.doesNotMatch(mount.textContent,/Old NFL/);
 await respond(requests[2],feed([gamePick({sport:'NHL',matchup:'NHL away at NHL home'})],{sport:'NHL'}));assert.match(mount.textContent,/NHL away/);assert.equal(mount.querySelectorAll('[data-reviewed-pick]').length,1);
 controller.update({sport:'EPL',kind:'games'});assert.equal(mount.hidden,true);assert.equal(mount.children.length,0);
 assert.equal(refreshButton.listeners.click.length,0,'disposed boards remove their header refresh listener');
});

test('Games page places an explicitly controlled reviews mount before research without automatic mounting',()=>{
 const html=readFileSync(new URL('../../sharp-service/research.html',import.meta.url),'utf8'),js=readFileSync(new URL('../../sharp-service/research.js',import.meta.url),'utf8');
 assert.match(html,/<section id="reviewed-games"[^>]*hidden/);
 assert.ok(html.indexOf('id="reviewed-games"')<html.indexOf('id="research-board"'));
 assert.doesNotMatch(html,/data-reviewed-picks-mount/,'the shared module must not auto-mount with an incorrect sport');
 assert.match(js,/import\s*\{mountReviewedGames\}\s*from '\.\/reviewed-picks\.js'/);
 assert.match(js,/reviewedGames\.update\(state\)/);
});

test('a started game keeps the review visible and removes its upcoming BUY count',async()=>{
 const start=new Date(now+1000).toISOString(),view=await widget(feed([pick({startsAt:start})]));
 assert.match(view.count,/1 upcoming/);view.tick(now+1000);
 assert.equal(view.rows.length,1);assert.match(view.rows[0].querySelector('summary').textContent,/GAME STARTED/);assert.match(view.count,/0 upcoming/);
 assert.match(view.text,/Recorded decision: BUY/);
});

test('refresh errors retain saved reviews without asserting an active count',async()=>{
 const source=feed(),view=await widget(source);view.rows[0].open=true;
 const detail=view.rows[0].querySelector('.target-research-details');detail.open=true;detail.querySelector('summary').focus();
 await view.refresh(source,{error:true});
 assert.equal(view.rows.length,1);assert.match(view.rows[0].querySelector('summary').textContent,/SAVED REVIEW/);assert.match(view.text,/refresh failed/i);assert.match(view.count,/unavailable/i);
 assert.equal(view.rows[0].open,true);const restored=view.rows[0].querySelector('.target-research-details');assert.equal(restored.open,true);assert.equal(view.document.activeElement,restored.querySelector('summary'));
 await view.manualRefresh(source);assert.equal(view.calls,3);assert.match(view.count,/1 upcoming/);assert.match(view.rows[0].querySelector('summary').textContent,/REVIEWED BUY/);
});

test('a feed older than two minutes preserves recorded review but cannot claim updated review status',async()=>{
 const view=await widget(feed());view.tick(now+120001);
 assert.equal(view.rows.length,1);assert.match(view.count,/unavailable/i);assert.match(view.rows[0].querySelector('summary').textContent,/SAVED REVIEW/);assert.match(view.text,/review status.*refresh/i);
 assert.match(view.text,/Recorded \+123/);
});

test('Chicago midnight removes yesterday’s saved cards even while refresh fails',async()=>{
 const clock=Date.parse('2026-11-28T05:59:00Z'),source=feed([pick({startsAt:'2026-11-28T05:59:30Z'})],{generatedAt:new Date(clock).toISOString()}),view=await widget(source,{clock});
 assert.equal(view.rows.length,1);await view.refresh(source,{error:true});view.tick(Date.parse('2026-11-28T06:00:00Z'));
 assert.equal(view.rows.length,0);assert.doesNotMatch(view.text,/Derrick White/);assert.match(view.count,/unavailable/i);
});

test('invalid or future responses cannot replace the last published review or become a verified empty list',async()=>{
 const source=feed(),view=await widget(source);
 for(const invalid of [{contract:'other',picks:[]},feed([],{generatedAt:new Date(now+1000).toISOString()}),feed([pick({startsAt:'2026-11-27T19:00:00'})])]){
  await view.refresh(invalid);assert.equal(view.rows.length,1);assert.match(view.count,/unavailable/i);assert.match(view.text,/refresh failed/i);
 }
 const unavailable=await widget({error:'Unavailable'});assert.equal(unavailable.rows.length,0);assert.match(unavailable.text,/unavailable/i);assert.doesNotMatch(unavailable.count,/^0/);
});

test('non-BUY decisions and picks outside today’s Central date cannot count as current reviewed BUYs',async()=>{
 const view=await widget(feed([pick({decision:'REVERSED'}),pick({id:'tomorrow',startsAt:'2026-11-29T01:00:00Z'})]));
 assert.equal(view.rows.length,1);assert.match(view.count,/0 upcoming/);assert.doesNotMatch(view.rows[0].querySelector('summary').textContent,/REVIEWED BUY/);assert.match(view.text,/Recorded decision: REVERSED/);
});

test('refreshed order keeps disclosure state and focus attached to the recorded review ID',async()=>{
 const a=pick(),b=pick({id:'review-2',startsAt:new Date(now+7200000).toISOString()}),view=await widget(feed([a,b]));
 view.rows[0].open=true;view.rows[0].querySelector('summary').focus();
 await view.refresh(feed([{...a,startsAt:new Date(now+10800000).toISOString()},b]));
 const moved=view.rows.find(row=>row.getAttribute('data-reviewed-pick')==='review-1');assert.ok(moved);assert.equal(moved.open,true);assert.equal(view.document.activeElement,moved.querySelector('summary'));
});

test('refresh preserves focus on a closed disclosure without opening it',async()=>{
 const source=feed(),view=await widget(source);
 view.rows[0].querySelector('summary').focus();await view.refresh(source);
 assert.equal(view.rows[0].open,false);assert.equal(view.document.activeElement,view.rows[0].querySelector('summary'));
 view.rows[0].open=true;view.rows[0].querySelector('.target-research-details').querySelector('summary').focus();
 await view.refresh(source);
 assert.equal(view.rows[0].open,true);assert.equal(view.rows[0].querySelector('.target-research-details').open,false);
});

test('conditional and reported decisions retain their original terms without a reviewed BUY badge',async()=>{
 const view=await widget(feed([pick({decision:'SELECT_RESEARCH_PRICE_CONDITIONAL'}),pick({id:'reported',decision:'REPORTED_SELECTION'})]));
 assert.match(view.count,/0 upcoming/);assert.match(view.rows.find(row=>row.getAttribute('data-reviewed-pick')==='review-1').querySelector('summary').textContent,/CONDITIONAL RESEARCH/);assert.match(view.text,/Recorded decision: SELECT_RESEARCH_PRICE_CONDITIONAL/);
 assert.match(view.text,/REPORTED SELECTION/);assert.match(view.text,/Price limit: \+100 or better/);assert.doesNotMatch(view.text,/REVIEWED BUY/);
});

test('untrusted text renders as text and cannot inject markup or URLs',async()=>{
 const view=await widget(feed([pick({reviewNote:'<img src=x onerror=alert(1)>',matchup:'<script>unsafe</script>'})]));
 assert.match(view.text,/<img src=x onerror=alert\(1\)>/);assert.equal(view.mount.querySelectorAll('script').length,0);
 assert.equal(view.mount.querySelectorAll('img').filter(image=>image.src==='x').length,0);
});

test('NBA landing mounts reviewed picks before automated decisions and exposes a menu anchor',()=>{
 const html=readFileSync(new URL('../../sharp-service/nba.html',import.meta.url),'utf8'),nav=readFileSync(new URL('../../sharp-service/edge-navigation.js',import.meta.url),'utf8');
 assert.match(html,/id="reviewed-picks"[^>]*data-reviewed-picks-mount/);assert.ok(html.indexOf('data-reviewed-picks-mount')<html.indexOf('data-nba-live-mount'));assert.match(html,/src="\/reviewed-picks\.js"/);assert.match(nav,/\/nba\.html#reviewed-picks/);
});

test('NFL history displays a reported prior BUY with missing original terms and a separate later review',async()=>{
 const source=nflFeed(),before=JSON.stringify(source),view=await widget(source,{sport:'NFL'});
 assert.equal(view.rows.length,1);assert.match(view.text,/NFL reviewed picks/);assert.equal(view.requests[0].url,'/api/dashboard?reviewedPicks=1&sport=NFL');
 const summary=view.rows[0].querySelector('summary').textContent;
 assert.match(summary,/Bo Nix/);assert.match(summary,/Under 214\.5 passing yards/);assert.match(summary,/Nov 26, 2026/);assert.match(summary,/1:00 PM CST/);
 assert.match(summary,/Reported prior BUY/i);assert.match(summary,/Game started/i);assert.match(summary,/Original book and price unavailable/);
 assert.match(summary,/Later review: AVOID at changed terms/);assert.match(view.text,/Original review time unavailable/);assert.match(view.text,/Captured Nov 27, 2026/);
 assert.match(view.text,/199\.5–202\.5/);assert.match(view.count,/1 saved review · 0 upcoming BUYs/);assert.equal(view.mount.querySelectorAll('.reviewed-buy').length,0);
 assert.equal(view.mount.querySelectorAll('.target-player-portrait').length,0);assert.equal(view.mount.querySelectorAll('.target-card-metrics').length,0);
 assert.doesNotMatch(view.text,/REVIEWED BUY|Recorded decision: BUY|Original review: AVOID|REPORTED_SELECTION/);assert.equal(JSON.stringify(source),before);
});

test('NFL shows Sunday records in its window but only complete future BUY reviews count',async()=>{
 const sunday='2026-11-29T18:00:00Z',source=nflFeed([reported({id:'future-history',startsAt:sunday}),reported({id:'future-complete',playerId:'JAYLEN_WARREN_1_NFL',playerName:'Jaylen Warren',marketType:'receiving_yards',side:'OVER',line:16.5,startsAt:sunday,historyOnly:false,reportedDecision:null,sourceLabel:'Manual review',decision:'BUY',issuedAt:new Date(now-600000).toISOString(),book:'draftkings',odds:-110,reviewUpdate:null})]);
 const view=await widget(source,{sport:'NFL'});assert.equal(view.rows.length,2);assert.match(view.count,/2 saved reviews · 1 upcoming BUY/);
 const historical=view.rows.find(row=>row.getAttribute('data-reviewed-pick')==='future-history');assert.match(historical.querySelector('summary').textContent,/Nov 29, 2026/);assert.match(historical.textContent,/Reported prior BUY/i);assert.doesNotMatch(historical.textContent,/REVIEWED BUY|GAME STARTED/);
 assert.equal(view.mount.querySelectorAll('.reviewed-buy').length,1);assert.equal(view.mount.querySelectorAll('.target-player-portrait').length,0);
});

test('NFL saved history remains after errors and ages out at its Chicago calendar window boundary',async()=>{
 const clock=Date.parse('2026-11-28T05:59:00Z'),source=nflFeed([reported({id:'oldest',startsAt:'2026-11-21T18:00:00Z'}),reported({id:'recent',startsAt:'2026-11-26T18:00:00Z'})],{generatedAt:new Date(clock).toISOString()}),view=await widget(source,{sport:'NFL',clock});
 assert.equal(view.rows.length,2);view.rows[1].open=true;const detail=view.rows[1].querySelector('.target-research-details');detail.open=true;detail.querySelector('summary').focus();
 await view.refresh(source,{error:true});assert.equal(view.rows.length,2);assert.match(view.text,/Saved review/i);assert.match(view.count,/unavailable/i);
 view.tick(Date.parse('2026-11-28T06:00:00Z'));assert.deepEqual(view.rows.map(row=>row.getAttribute('data-reviewed-pick')),['recent']);
 assert.equal(view.rows[0].open,true);assert.equal(view.rows[0].querySelector('.target-research-details').open,true);assert.equal(view.document.activeElement,view.rows[0].querySelector('.target-research-details').querySelector('summary'));
 assert.match(view.text,/Reported prior BUY/i);assert.doesNotMatch(view.text,/REVIEWED BUY/);
});

test('NFL rejects an incomplete BUY or mismatched reported-history metadata instead of clearing it',async()=>{
 const source=nflFeed();
 for(const patch of [{historyOnly:false,sourceLabel:'Manual review',decision:'BUY'},{decision:'BUY'},{reportedDecision:null},{sourceLabel:'Manual review'},{book:'',odds:null},{issuedAt:'not a timestamp'},{reviewUpdate:{decision:'BUY',issuedAt:stamp,note:'Invented update'}},{reviewUpdate:{decision:'AVOID',issuedAt:new Date(now-30000).toISOString(),note:'After capture'}},{issuedAt:new Date(now-180000).toISOString(),reviewUpdate:{decision:'AVOID',issuedAt:new Date(now-240000).toISOString(),note:'Before original review'}}]){
  const view=await widget(nflFeed([reported(patch)]),{sport:'NFL'});assert.equal(view.rows.length,0,JSON.stringify(patch));assert.match(view.count,/unavailable/i);
 }
 const view=await widget(source,{sport:'NFL'});await view.refresh(nflFeed([],{dateWindow:{fromDate:'2026-01-01',toDate:'2027-01-01'}}));assert.equal(view.rows.length,1);assert.match(view.count,/unavailable/i);
 await view.refresh(feed());assert.equal(view.rows.length,1);assert.match(view.count,/unavailable/i);
 const nba=await widget(feed([reported({sport:'NBA',startsAt:new Date(now+1000).toISOString()})]));assert.equal(nba.rows.length,0);assert.match(nba.count,/unavailable/i);
});

test('NFL reported-history refresh works while the model refresh button is disabled',async()=>{
 const source=nflFeed(),view=await widget(source,{sport:'NFL'}),button=view.mount.querySelector('[data-reviewed-refresh]');
 assert.ok(button);assert.match(button.getAttribute('aria-label'),/Refresh NFL reviewed picks/);view.refreshButton.disabled=true;
 await view.reviewRefresh(source);assert.equal(view.calls,2);assert.match(view.text,/Reported prior BUY/i);
 view.refreshButton.disabled=false;await view.manualRefresh(source);assert.equal(view.calls,3);
});

test('NFL later review notes are text and do not replace the reported original decision',async()=>{
 const view=await widget(nflFeed([reported({reviewUpdate:{decision:'AVOID',issuedAt:new Date(now-120000).toISOString(),note:'<img src=x onerror=alert(1)>'}})]),{sport:'NFL'});
 assert.match(view.text,/<img src=x onerror=alert\(1\)>/);assert.match(view.text,/Reported prior BUY/i);assert.match(view.text,/Later review: AVOID at changed terms/);
 assert.equal(view.mount.querySelectorAll('img').filter(img=>img.src==='x').length,0);assert.equal(view.mount.querySelectorAll('.reviewed-buy').length,0);
});

test('NFL landing mounts review history above automated models and scopes research-only wording',()=>{
 const html=readFileSync(new URL('../../sharp-service/nfl.html',import.meta.url),'utf8'),nav=readFileSync(new URL('../../sharp-service/edge-navigation.js',import.meta.url),'utf8');
 assert.match(html,/id="reviewed-picks"[^>]*data-reviewed-picks-mount[^>]*data-reviewed-sport="NFL"/);assert.ok(html.indexOf('data-reviewed-picks-mount')<html.indexOf('NFL models</h2>'));assert.match(html,/src="\/reviewed-picks\.js"/);
 assert.match(html,/No automated NFL recommendations are enabled/);assert.doesNotMatch(html,/Research only · no cleared NFL plays|No NFL recommendations are enabled/);assert.match(nav,/NFL reviewed picks','\/nfl\.html#reviewed-picks/);
});
