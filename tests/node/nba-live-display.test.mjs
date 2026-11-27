import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildDeepDive} from '../../sharp-service/deep-dive.js';
import {formatCentralTime,formatProbability,formatNumber,shortReason} from '../../sharp-service/ui-format.js';
import {bookLabel} from '../../sharp-service/prop-price-checks.js';
import {setNbaQuoteNames,groupLiveDecisions,groupLiveCards,livePlayerName,scopeOf} from '../../sharp-service/nba-live.js';
import handler from '../../sharp-service/handlers/nba-live-decisions.js';

const now=Date.parse('2026-11-23T18:14:26.753Z'),stamp=new Date(now).toISOString();
const eventID='sgo:SHvnat0tA70LqQ9tHYvT',playerID='KEVIN_DURANT_1_NBA',startsAt='2026-11-24T01:30:00.000Z';
const hashes=['880a76673cae94f50329671aaeb84254346348edaa6f4e7312a1f9910e442308','31a5b080bdf88ff0ce6eb3b8c06c204e4bdd3e8693b1953cb919eb3a8aa2a0ce'];
// Reduced shape of the reviewed route: two unapproved models evaluate one
// exact quote. They belong under one selection, not two apparent plays.
function row(patch={}){
 return {contract:'nba-reviewed-live-v1',eventID,playerID,startsAt,market:'rebounds',side:'UNDER',line:5.5,book:'draftkings',odds:-153,oppositeOdds:116,quoteAt:'2026-11-23T18:06:07.710Z',oppositeQuoteAt:'2026-11-23T18:06:07.710Z',issuedAt:'2026-11-23T18:06:23.271Z',forecastAt:'2026-11-23T18:06:17.146Z',validUntil:'2026-11-23T18:16:07.710Z',status:'PASS',productionEligible:false,productionWeight:0,approvalId:null,modelHash:hashes[0],validationProtocol:'nba-minutes-paired-2026-11-10-v1',decisionId:'minutes-decision',identity:'same-quote',modelProbability:.6268656716417911,marketProbability:.5663947350380476,reasons:['MODEL_NOT_APPROVED','EXPLICIT_AVAILABILITY_REQUIRED'],reason:'No matching reviewed model approval is active. An explicit, current official Available report is required.',context:{contract:'nba-explanation-only-v1',features:{expectedMinutes:{value:33.35,source:'Synthetic fixture',gameCount:10,cutoff:stamp,observedAt:'2026-11-22T23:21:14.905Z'}}},...patch};
}
function body(rows=[row(),row({modelHash:hashes[1],validationProtocol:'nba-prospective-bilateral-2026-11-09-v4',decisionId:'baseline-decision',modelProbability:.6169154228855721})]){
 return {contract:'nba-reviewed-live-v1',generatedAt:stamp,decisions:rows};
}
function names(){
 return {source:'SportsGameOdds',generatedAt:stamp,events:[{eventID,provider:'SportsGameOdds',startsAt,matchup:{away:{name:'Houston Rockets'},home:{name:'LA Clippers'}},players:[{prop:{playerID,playerName:'Kevin Durant',identityStatus:'PROVIDER_ROSTER_MATCHED'},explanationBinding:{contract:'sgo-event-roster-v1',eventID,playerID,startsAt,teamId:'HOUSTON_ROCKETS_NBA',opponentTeamId:'LA_CLIPPERS_NBA'}}]}]};
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
class Element{
 constructor(tag='div',ownerDocument){this.tag=tag;this.children=[];this._text='';this.attributes={};this.listeners={};this.ownerDocument=ownerDocument;this.open=false;this.hidden=false;}
 set textContent(value){this._text=String(value);this.replaceChildren();}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('\n');}
 get value(){return this._value??(this.tag==='select'?this.children[0]?.value??'':'');}
 set value(value){this._value=String(value);}
 get options(){return this.children;}
 append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
 prepend(...children){for(const child of children)child.parentElement=this;this.children.unshift(...children);}
 replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];if(this.tag==='select')this._value=undefined;this.append(...children);}
 setAttribute(name,value){this.attributes[name]=String(value);}
 getAttribute(name){return this.attributes[name]??null;}
 hasAttribute(name){return Object.hasOwn(this.attributes,name);}
 addEventListener(type,callback){(this.listeners[type]??=[]).push(callback);}
 dispatch(type){for(const callback of this.listeners[type]??[])callback({type,target:this});}
 contains(node){return node===this||descendants(this).includes(node);}
 focus(){this.ownerDocument.activeElement=this;}
 querySelectorAll(selector){const selectors=selector.split(',').map(value=>value.trim());return descendants(this).filter(node=>selectors.some(value=>value[0]==='['?node.hasAttribute(value.slice(1,-1)):value[0]==='.'?node.className?.split(' ').includes(value.slice(1)):node.tag===value));}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
const source=readFileSync(new URL('../../sharp-service/nba-live-view.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
async function widget(initial){
 let clock=now,calls=0,response={ok:true,body:initial};const timers=[],deep=[];
 const document={activeElement:null};const main=new Element('main',document);
 document.createElement=tag=>new Element(tag,document);document.querySelector=selector=>selector==='main'?main:null;document.body=main;
 const appendDeepDive=(parent,record,options)=>{deep.push(record);const node=new Element('details',document);node.textContent=buildDeepDive(record,options).sections.map(section=>section.text).join('\n');parent.append(node);};
 class Clock extends Date{static now(){return clock;}}
 setNbaQuoteNames(null,clock);
 const mount=new Function('document','appendDeepDive','preserveDeepDives','formatCentralTime','formatProbability','formatNumber','shortReason','bookLabel','fetch','setInterval','setTimeout','clearTimeout','AbortController','Date',source+'\nreturn mountLiveBoard;')(
  document,appendDeepDive,()=>{},formatCentralTime,formatProbability,formatNumber,shortReason,bookLabel,
  async()=>{calls++;if(response.error)throw Error('Synthetic unavailable response');return {ok:response.ok,json:async()=>response.body};},
  (fn,ms)=>{timers.push({fn,ms});},()=>0,()=>{},AbortController,Clock
 );
 const render=mount({groupLiveDecisions:data=>groupLiveDecisions(data,clock),groupLiveCards,livePlayerName,scopeOf});
 await new Promise(resolve=>setImmediate(resolve));
 return {
  main,deep,document,
  get cards(){return main.querySelectorAll('article');},get text(){return main.textContent;},get calls(){return calls;},
  setNames(data,time=clock){const count=setNbaQuoteNames(data,time);render();return count;},
  tick(time){clock=time;for(const timer of timers)if(timer.ms===1000)timer.fn();},
  control(title){return main.querySelectorAll('label').find(node=>node._text===title)?.children.find(node=>['input','select'].includes(node.tag));},
  filter(title,value){const node=this.control(title);assert.ok(node,`Missing ${title} filter`);node.value=value;node.dispatch('input');},
  async refresh(next=initial,{ok=true,error=false}={}){response={body:next,ok,error};for(const timer of timers)if(timer.ms===15000)await timer.fn();}
 };
}
const selections=view=>view.main.querySelectorAll('.prop-selection');
const badges=view=>selections(view).map(node=>node.querySelector('.badge').textContent);
const heading=card=>card.querySelector('h3').textContent;
const identity=card=>card.querySelectorAll('[data-live-detail]').find(node=>node.getAttribute('data-live-detail').endsWith(':identity'));
const cleared=patch=>row({status:'PLAY',productionEligible:true,productionWeight:1,approvalId:'reviewed-approval',reasons:[],reason:'Reviewed service clearance.',issuedAt:stamp,forecastAt:stamp,quoteAt:stamp,oppositeQuoteAt:stamp,validUntil:new Date(now+300000).toISOString(),...patch});

test('widget groups an exact quote and retains both labeled evaluations without mutating source',async()=>{
 const data=body(),before=JSON.stringify(data),view=await widget(data);
 assert.equal(view.cards.length,1);assert.deepEqual(badges(view),['AVOID']);assert.equal(heading(view.cards[0]),'Kevin Durant');
 assert.match(view.text,/Research estimate.*62\.7%/);assert.match(view.text,/Research estimate.*61\.7%/);
 assert.match(view.text,/no current production clearance/i);assert.equal(view.deep.length,2);
 assert.match(view.text,/2 model evaluation records/);assert.match(view.text,/1 unique selections/);
 assert.equal(JSON.stringify(data),before);
});

test('recognized ID names are readable while identity and raw IDs stay in collapsed details',async()=>{
 const view=await widget(body([row()])),card=view.cards[0];
 assert.equal(heading(card),'Kevin Durant');assert.doesNotMatch(heading(card),/BUY|AVOID|_1_NBA/);
 assert.match(identity(card).textContent,/formatted from provider ID; roster identity is unverified/);
 assert.equal(identity(card).open,false);assert.match(identity(card).textContent,/Provider player ID: KEVIN_DURANT_1_NBA/);
 assert.ok(card.children.filter(node=>node.tag!=='details').every(node=>!node._text.includes('KEVIN_DURANT_1_NBA')));
});

test('already-fetched exact roster metadata adds names and matchup without another request',async()=>{
 const data=body(),before=JSON.stringify(data),view=await widget(data);
 assert.equal(view.setNames(names(),now),1);assert.equal(heading(view.cards[0]),'Kevin Durant');
 assert.match(view.cards[0].textContent,/Houston Rockets @ LA Clippers/);
 assert.match(identity(view.cards[0]).textContent,/Name from the supplied event records/);
 assert.equal(view.calls,1);assert.equal(JSON.stringify(data),before);
 assert.ok(view.deep.every(record=>record.productionEligible===false&&record.productionWeight===0));
});

test('wrong event, start, roster binding or conflicting names cannot enrich a fallback title',async()=>{
 for(const change of [
  data=>{data.events[0].eventID='sgo:other';},
  data=>{data.events[0].startsAt='2026-11-24T03:30:00Z';},
  data=>{data.events[0].players[0].prop.playerID='OTHER_PLAYER_NBA';},
  data=>{data.events[0].players[0].explanationBinding.teamId='OTHER_TEAM';},
  data=>{data.events[0].players[0].explanationBinding.eventID='sgo:other';},
  data=>{data.events[0].players[0].identityStatus='UNVERIFIED';data.events[0].players[0].prop.identityStatus='UNVERIFIED';},
  data=>{data.generatedAt=new Date(now+1000).toISOString();},
  data=>{data.source='Unknown source';},
  data=>{data.events[0].players.push({...structuredClone(data.events[0].players[0]),prop:{playerID,playerName:'Conflicting Name',identityStatus:'PROVIDER_ROSTER_MATCHED'}});}
 ]){
  const view=await widget(body([row()])),data=names();change(data);
  assert.equal(view.setNames(data,now),0);assert.equal(heading(view.cards[0]),'Kevin Durant');
  assert.match(identity(view.cards[0]).textContent,/roster identity is unverified/);
  assert.doesNotMatch(view.cards[0].textContent,/Houston Rockets @ LA Clippers|Conflicting Name/);
 }
});

test('books, sides and alternate lines share a player market while each selection stays intact',async()=>{
 const patches=[{}, {side:'OVER'}, {line:6.5}, {book:'fanduel'}];
 const data=body(patches.flatMap(patch=>[row(patch),row({...patch,modelHash:hashes[1]})]));
 const view=await widget(data);assert.equal(view.cards.length,1);assert.equal(selections(view).length,4);
 assert.equal(view.deep.length,8);assert.match(view.text,/4 unique selections/);
 const extra=view.cards[0].querySelectorAll('[data-live-detail]').find(node=>node.getAttribute('data-live-detail').endsWith(':extra'));
 assert.ok(extra);assert.equal(extra.open,false);assert.equal(extra.querySelectorAll('.prop-selection').length,2);
});

test('different events, scheduled starts, players, markets and periods remain distinct cards',async()=>{
 const patches=[{}, {startsAt:'2026-11-24T02:00:00Z'}, {eventID:'sgo:other'}, {playerID:'OTHER_PLAYER_1_NBA'}, {market:'assists'}, {marketScope:'FIRST_HALF'}];
 const view=await widget(body(patches.map(patch=>row(patch))));
 assert.equal(view.cards.length,patches.length);assert.equal(selections(view).length,patches.length);
});

test('current BUY expires to UNVERIFIED without changing recorded service status',async()=>{
 const data=body([cleared()]),view=await widget(data);assert.deepEqual(badges(view),['BUY']);
 assert.match(view.text,/Service decision status: PLAY/);view.tick(now+30000);
 assert.deepEqual(badges(view),['UNVERIFIED']);assert.match(view.text,/Decision expired or not verified/);
 assert.equal(data.decisions[0].status,'PLAY');
});

test('newer PASS or conflicting same-model records cannot resurrect an older cleared BUY',async()=>{
 for(const rows of [
  [cleared({issuedAt:new Date(now-1000).toISOString(),quoteAt:new Date(now-1000).toISOString(),oppositeQuoteAt:new Date(now-1000).toISOString()}),row({issuedAt:stamp,quoteAt:stamp,oppositeQuoteAt:stamp})],
  [cleared(),row({issuedAt:stamp,quoteAt:stamp,oppositeQuoteAt:stamp})],
  [cleared({approvalId:''})], [cleared({reasons:['MODEL_NOT_APPROVED']})], [cleared({reasons:'MODEL_NOT_APPROVED'})],
  [cleared({side:1})], [cleared({line:'5.5'})], [cleared({odds:[-153]})]
 ]){
  const view=await widget(body(rows));assert.ok(badges(view).every(status=>status!=='BUY'));
 }
});

test('malformed probabilities remain N/A instead of numerical research confidence',async()=>{
 for(const probability of [-.2,1.2,'0.9',null]){
  const view=await widget(body([row({modelProbability:probability})]));
  assert.match(view.text,/Research estimate[^\n]*N\/A/);
  assert.doesNotMatch(view.text,/Research estimate[^\n]*(?:-20\.0%|120\.0%)/);
 }
});

test('invalid probability, stale paired evidence and mismatched odds cannot display BUY',async()=>{
 for(const patch of [
  {modelProbability:1.2},{modelProbability:null},{modelProbability:'0.7'},
  {marketProbability:'0.5'},{marketProbability:null},{marketProbability:.99},
  {oppositeOdds:null},{oppositeOdds:'116'},{oppositeOdds:[116]},
  {quoteAt:new Date(now-600001).toISOString()}, {oppositeQuoteAt:new Date(now-600001).toISOString()},
  {forecastAt:new Date(now-600001).toISOString()}, {quoteAt:new Date(now+1).toISOString()},
  {oppositeQuoteAt:null},{contract:'unknown'},{available:false}
 ]){
  const data=body([cleared(patch)]),before=JSON.stringify(data),view=await widget(data);
  assert.deepEqual(badges(view),['UNVERIFIED'],JSON.stringify(patch));
  assert.match(view.text,/Research estimate/);assert.equal(JSON.stringify(data),before);
 }
});

test('disclosure expansion and keyboard focus survive an expiry repaint',async()=>{
 const view=await widget(body([cleared()]));
 const outer=selections(view)[0].querySelector('[data-live-detail]'),evaluation=outer.querySelector('[data-nba-evaluation]');
 outer.open=true;evaluation.open=true;evaluation.querySelector('summary').focus();
 const original=view.cards[0];view.tick(now+1000);assert.equal(view.cards[0],original,'ordinary clock ticks should not rebuild cards');
 view.tick(now+30000);
 const refreshed=selections(view)[0].querySelector('[data-live-detail]');
 assert.equal(refreshed.open,true);assert.equal(refreshed.querySelector('[data-nba-evaluation]').open,true);
 assert.equal(view.document.activeElement,refreshed.querySelector('[data-nba-evaluation]').querySelector('summary'));
});

test('an expired model loses its cleared label even when another model keeps the selection BUY',async()=>{
 const data=body([
  cleared({validUntil:new Date(now+1000).toISOString()}),
  cleared({modelHash:hashes[1],validationProtocol:'nba-prospective-bilateral-2026-11-09-v4',decisionId:'longer-approval',validUntil:new Date(now+20000).toISOString()})
 ]),view=await widget(data);
 const clearedLabels=()=>view.main.querySelectorAll('[data-nba-evaluation]').map(node=>node.querySelector('summary').textContent).filter(value=>value.startsWith('Cleared evaluation'));
 assert.equal(clearedLabels().length,2);assert.deepEqual(badges(view),['BUY']);
 view.tick(now+2000);
 assert.deepEqual(badges(view),['BUY']);assert.equal(clearedLabels().length,1);
 assert.ok(view.main.querySelectorAll('[data-nba-evaluation]').some(node=>node.querySelector('summary').textContent.startsWith('Research evaluation')));
 assert.ok(data.decisions.every(record=>record.status==='PLAY'),'original recorded decisions remain intact');
});

test('search, status, side, market and book filters change visible selections without extra requests',async()=>{
 const view=await widget(body([cleared(),row({side:'OVER'}),row({playerID:'DERRICK_WHITE_1_NBA',playerName:'Derrick White',market:'assists',book:'fanduel'})]));
 const filterOptions=view.main.querySelector('.board-filter-options');
 assert.equal(filterOptions.open,false);assert.equal(filterOptions.contains(view.control('Player or game')),false);
 assert.equal(filterOptions.contains(view.control('Status')),true);
 view.setNames(names(),now);assert.equal(view.cards.length,2);
 view.filter('Player or game','Houston');assert.equal(view.cards.length,1);assert.equal(heading(view.cards[0]),'Kevin Durant');
 view.filter('Player or game','');view.filter('Status','BUY');assert.deepEqual(badges(view),['BUY']);
 assert.match(filterOptions.querySelector('summary').textContent,/1 active/);
 view.filter('Status','');view.filter('Side','OVER');assert.equal(selections(view).length,1);assert.match(selections(view)[0].textContent,/over 5\.5/i);
 view.filter('Side','');view.filter('Market','assists');assert.equal(heading(view.cards[0]),'Derrick White');
 view.filter('Market','');view.filter('Book','fanduel');assert.equal(heading(view.cards[0]),'Derrick White');
 view.filter('Player or game','Nobody Here');assert.equal(view.cards.length,0);assert.match(view.text,/No player markets match these filters/);
 assert.equal(view.calls,1);
});

test('numeric sorting follows displayed agreement and keeps ambiguous or missing metrics last',async()=>{
 const view=await widget(body([
  row({modelProbability:.4,marketProbability:.1,edge:.3,ev:.9}),
  row({modelHash:hashes[1],modelProbability:.95,marketProbability:.9,edge:.05,ev:.2}),
  row({playerID:'DERRICK_WHITE_1_NBA',playerName:'Derrick White',modelProbability:.65,marketProbability:.55,edge:.1,ev:.12}),
  row({playerID:'PAYTON_PRITCHARD_1_NBA',playerName:'Payton Pritchard',modelProbability:null,marketProbability:null,edge:null,ev:null}),
  row({playerID:'RUDY_GOBERT_1_NBA',playerName:'Rudy Gobert',modelProbability:0,marketProbability:0,edge:0,ev:0})
 ]));
 const ambiguous=view.cards.find(card=>heading(card)==='Kevin Durant');
 assert.ok(ambiguous.querySelector('.compare').querySelectorAll('strong').every(cell=>cell.textContent==='N/A'));
 for(const sort of ['model','market','edge','ev']){
  view.filter('Sort',sort);const names=view.cards.map(heading);
  assert.equal(names[0],'Derrick White',sort);
  assert.ok(names.indexOf('Rudy Gobert')<names.indexOf('Payton Pritchard'),sort+' must retain valid zero values');
  assert.ok(names.indexOf('Rudy Gobert')<names.indexOf('Kevin Durant'),sort+' must not cherry-pick disagreeing model values');
 }
});

test('filters persist across refresh and unavailable responses cannot keep old BUYs visible',async()=>{
 const data=body([cleared(),row({book:'fanduel',market:'assists'})]),view=await widget(data);
 view.filter('Book','fanduel');view.filter('Side','UNDER');await view.refresh(data);
 assert.equal(view.control('Book').value,'fanduel');assert.equal(view.control('Side').value,'UNDER');
 assert.equal(selections(view).length,1);view.filter('Book','');assert.ok(badges(view).includes('BUY'));
 await view.refresh(data,{error:true});assert.equal(view.cards.length,0);
 assert.match(view.text,/Last successful refresh/);assert.match(view.text,/No current BUY can be verified/);
});

test('conflicting recorded and roster names use labeled fallback; malformed feed cannot crash',async()=>{
 const view=await widget(body([row({playerName:'Different Recorded Name'})]));view.setNames(names(),now);
 assert.equal(heading(view.cards[0]),'Kevin Durant');assert.match(identity(view.cards[0]).textContent,/Conflicting supplied names/);
 const malformed=names();malformed.events[0].players={not:'an array'};
 assert.doesNotThrow(()=>view.setNames(malformed,now));assert.deepEqual(badges(view),['AVOID']);
});

test('the live read handler preserves distinct model records, status and probabilities',async()=>{
 const saved={key:process.env.SUPABASE_SECRET_KEY,fetch:globalThis.fetch};
 process.env.SUPABASE_SECRET_KEY='synthetic-private-key';const data=body(),before=JSON.stringify(data);
 globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes('read_nba_explanation_snapshot_v1')?{contract:'nba-explanation-snapshot-v1',generatedAt:new Date().toISOString(),history:[],targets:[]}:structuredClone(data)});
 const res={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;return this;}};
 try{
  await handler({method:'GET'},res);assert.equal(res.code,200);assert.equal(res.body.decisions.length,2);
  for(let i=0;i<2;i++)for(const key of ['modelHash','modelProbability','status','productionEligible','productionWeight','approvalId'])assert.equal(res.body.decisions[i][key],data.decisions[i][key]);
  assert.equal(JSON.stringify(data),before);
 }finally{globalThis.fetch=saved.fetch;if(saved.key===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=saved.key;}
});
