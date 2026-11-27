import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountReviewedPicks} from '../../sharp-service/reviewed-picks.js';

const now=Date.parse('2026-11-27T18:00:00Z'),stamp=new Date(now).toISOString();
const pick=(patch={})=>({id:'review-1',sport:'NBA',eventId:'fixture-event',startsAt:new Date(now+3600000).toISOString(),playerId:'DERRICK_WHITE_1_NBA',playerName:'Derrick White',marketType:'rebounds',marketScope:'FULL_GAME',side:'OVER',line:3.5,book:'draftkings',odds:123,decision:'BUY',issuedAt:new Date(now-600000).toISOString(),recordedAt:new Date(now-60000).toISOString(),sourceLabel:'Manual review',matchup:'ATL vs BOS',priceLimit:100,reviewNote:'Original reviewed selection.',...patch});
const feed=(picks=[pick()],patch={})=>({contract:'edge-reviewed-picks-v1',generatedAt:stamp,date:'2026-11-27',timezone:'America/Chicago',sport:'NBA',picks,...patch});
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
async function widget(initial,{clock=now}={}){
 let time=clock,response={body:initial,ok:true},calls=0;const timers=[],requests=[];
 const document={activeElement:null},mount=new Element('section',document),refreshButton=new Element('button',document);
 mount.id='reviewed-picks';refreshButton.id='refresh';document.createElement=tag=>new Element(tag,document);document.getElementById=id=>id==='refresh'?refreshButton:null;
 const controller=mountReviewedPicks({mount,document,now:()=>time,fetchImpl:async(url,options)=>{calls++;requests.push({url,options});if(response.error)throw Error('Synthetic refresh error');return {ok:response.ok,json:async()=>response.body};},setIntervalImpl:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearIntervalImpl:()=>{},setTimeoutImpl:()=>0,clearTimeoutImpl:()=>{}});
 await new Promise(resolve=>setImmediate(resolve));
 return {mount,document,requests,timers,
  get rows(){return mount.querySelectorAll('[data-reviewed-pick]');},get text(){return mount.textContent;},get count(){return mount.querySelector('.reviewed-active-count').textContent;},get calls(){return calls;},
  async refresh(next=initial,{ok=true,error=false}={}){response={body:next,ok,error};await controller.refresh();},
  async manualRefresh(next=initial){response={body:next,ok:true};refreshButton.dispatch('click');await new Promise(resolve=>setImmediate(resolve));},
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
 assert.equal(view.rows.length,1);assert.match(view.rows[0].querySelector('summary').textContent,/ATL vs BOS/);assert.match(view.text,/Home moneyline/);
 assert.doesNotMatch(view.text,/Name unavailable/);assert.equal(view.mount.querySelectorAll('.target-player-portrait').length,0);
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
