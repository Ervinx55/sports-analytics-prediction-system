import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildDeepDive} from '../../sharp-service/deep-dive.js';
import handler from '../../sharp-service/handlers/nba-live-decisions.js';

const now=Date.parse('2026-11-23T18:14:26.753Z'),stamp=new Date(now).toISOString();
const eventID='sgo:SHvnat0tA70LqQ9tHYvT',playerID='KEVIN_DURANT_1_NBA',startsAt='2026-11-24T01:30:00.000Z';
const hashes=['880a76673cae94f50329671aaeb84254346348edaa6f4e7312a1f9910e442308','31a5b080bdf88ff0ce6eb3b8c06c204e4bdd3e8693b1953cb919eb3a8aa2a0ce'];
// Reduced shape of the actual reviewed route: two distinct, unapproved models
// evaluate the same exact quote. They are not two separate betting selections.
function row(patch={}){
 return {contract:'nba-reviewed-live-v1',eventID,playerID,startsAt,market:'rebounds',side:'UNDER',line:5.5,book:'draftkings',odds:-153,oppositeOdds:116,quoteAt:'2026-11-23T18:06:07.710Z',oppositeQuoteAt:'2026-11-23T18:06:07.710Z',issuedAt:'2026-11-23T18:06:23.271Z',forecastAt:'2026-11-23T18:06:17.146Z',validUntil:'2026-11-23T18:16:07.710Z',status:'PASS',productionEligible:false,productionWeight:0,approvalId:null,modelHash:hashes[0],validationProtocol:'nba-minutes-paired-2026-11-10-v1',decisionId:'minutes-decision',identity:'same-quote',modelProbability:.6268656716417911,marketProbability:.5663947350380476,reasons:['MODEL_NOT_APPROVED','EXPLICIT_AVAILABILITY_REQUIRED'],reason:'No matching reviewed model approval is active. An explicit, current official Available report is required.',context:{contract:'nba-explanation-only-v1',features:{expectedMinutes:{value:33.35,source:'Synthetic fixture',gameCount:10,cutoff:stamp,observedAt:'2026-11-22T23:21:14.905Z'}}},...patch};
}
function body(rows=[row(),row({modelHash:hashes[1],validationProtocol:'nba-prospective-bilateral-2026-11-09-v4',decisionId:'baseline-decision',modelProbability:.6169154228855721})]){
 return {contract:'nba-reviewed-live-v1',generatedAt:stamp,decisions:rows};
}
function names(){
 return {source:'SportsGameOdds',generatedAt:stamp,events:[{eventID,provider:'SportsGameOdds',startsAt,players:[{prop:{playerID,playerName:'Kevin Durant',identityStatus:'PROVIDER_ROSTER_MATCHED'},explanationBinding:{contract:'sgo-event-roster-v1',eventID,playerID,startsAt,teamId:'HOUSTON_ROCKETS_NBA',opponentTeamId:'LA_CLIPPERS_NBA'}}]}]};
}
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this._text='';this.attributes={};}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('\n');}
 append(...children){this.children.push(...children);}
 prepend(...children){this.children.unshift(...children);}
 replaceChildren(...children){this.children=children;this._text='';}
 setAttribute(name,value){this.attributes[name]=String(value);}
 getAttribute(name){return this.attributes[name]??null;}
 querySelectorAll(selector){return selector==='[data-nba-evaluation]'?descendants(this).filter(node=>node.attributes['data-nba-evaluation']):[];}
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
const source=readFileSync(new URL('../../sharp-service/nba-live.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
async function widget(data){
 let clock=now,calls=0;const main=new Element('main'),timers=[],deep=[];
 const document={createElement:tag=>new Element(tag),querySelector:selector=>selector==='main'?main:null,body:main};
 const appendDeepDive=(parent,record,options)=>{deep.push(record);const node=new Element('details');node.textContent=buildDeepDive(record,options).sections.map(section=>section.text).join('\n');parent.append(node);};
 class Clock extends Date{static now(){return clock;}}
 const hooks=new Function('document','appendDeepDive','preserveDeepDives','fetch','setInterval','setTimeout','clearTimeout','AbortController','Date',source+'\nreturn {setNames:typeof setNbaQuoteNames===\'function\'?setNbaQuoteNames:null};')(
  document,appendDeepDive,()=>{},async()=>{calls++;return {ok:true,json:async()=>data};},(fn,ms)=>{timers.push({fn,ms});},()=>0,()=>{},AbortController,Clock
 );
 await new Promise(resolve=>setImmediate(resolve));
 return {main,deep,get cards(){return descendants(main).filter(node=>node.tag==='article');},get text(){return main.textContent;},get calls(){return calls;},setNames:hooks.setNames,tick(time){clock=time;for(const timer of timers)if(timer.ms===1000)timer.fn();}};
}

test('actual widget groups an exact quote while retaining both labeled research evaluations',async()=>{
 const data=body(),before=JSON.stringify(data),view=await widget(data);
 assert.equal(view.cards.length,1);
 assert.match(view.cards[0].textContent,/AVOID — not cleared/);
 assert.match(view.text,/Research estimate.*62\.7%/);
 assert.match(view.text,/Research estimate.*61\.7%/);
 assert.match(view.text,/no current production clearance/i);
 assert.equal(view.deep.length,2);
 assert.match(view.text,/2 model evaluation records/);
 assert.equal(JSON.stringify(data),before);
});

test('missing names remain unavailable and the raw provider ID is explicitly labeled',async()=>{
 const view=await widget(body([row()]));
 const heading=descendants(view.cards[0]).find(node=>node.tag==='h3').textContent;
 assert.equal(heading,'AVOID — not cleared: Player name unavailable');
 assert.match(view.text,/Provider player ID: KEVIN_DURANT_1_NBA/);
 assert.doesNotMatch(heading,/KEVIN DURANT 1 NBA/);
});

test('already-fetched exact roster metadata supplies names without another request or decision mutation',async()=>{
 const data=body(),before=JSON.stringify(data),view=await widget(data);
 assert.equal(typeof view.setNames,'function');
 view.setNames(names(),now);
 assert.match(view.cards[0].textContent,/AVOID — not cleared: Kevin Durant/);
 assert.equal(view.calls,1);
 assert.equal(JSON.stringify(data),before);
 assert.ok(view.deep.every(record=>record.productionEligible===false&&record.productionWeight===0));
});

test('wrong event, rescheduled start, player, roster binding and conflicting names cannot enrich the title',async()=>{
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
  assert.equal(typeof view.setNames,'function');view.setNames(data,now);
  const heading=descendants(view.cards[0]).find(node=>node.tag==='h3').textContent;
  assert.match(heading,/Player name unavailable/);
  assert.doesNotMatch(heading,/Kevin Durant|Conflicting Name/);
 }
});

test('different event starts, players, markets, sides, lines, books, prices and scopes stay separate',async()=>{
 const patches=[{}, {startsAt:'2026-11-24T02:00:00Z'}, {eventID:'sgo:other'}, {playerID:'OTHER_PLAYER_NBA'}, {market:'assists'}, {side:'OVER'}, {line:6.5}, {book:'fanduel'}, {odds:-154}, {marketScope:'FIRST_HALF'}];
 const data=body(patches.flatMap(patch=>[row(patch),row({...patch,modelHash:hashes[1]})]));
 const view=await widget(data);
 assert.equal(view.cards.length,patches.length);
 assert.equal(view.deep.length,2*patches.length);
});

const cleared=patch=>row({status:'PLAY',productionEligible:true,productionWeight:1,approvalId:'reviewed-approval',reasons:[],reason:'Reviewed service clearance.',issuedAt:stamp,forecastAt:stamp,quoteAt:stamp,oppositeQuoteAt:stamp,validUntil:new Date(now+300000).toISOString(),...patch});
test('BUY is a display label for a current service-cleared PLAY and expires without changing its recorded status',async()=>{
 const data=body([cleared()]),view=await widget(data);
 assert.match(view.cards[0].textContent,/BUY — cleared/);
 assert.match(view.text,/Service decision status: PLAY/);
 view.tick(now+30000);
 assert.match(view.cards[0].textContent,/AVOID — not cleared/);
 assert.doesNotMatch(view.cards[0].textContent,/BUY — cleared/);
 assert.equal(data.decisions[0].status,'PLAY');
});

test('newer PASS or conflicting same-model records cannot resurrect an older cleared PLAY',async()=>{
 for(const rows of [
  [cleared({issuedAt:new Date(now-1000).toISOString()}),row({issuedAt:stamp})],
  [cleared(),row({issuedAt:stamp})],
  [cleared({approvalId:''})],
  [cleared({reasons:['MODEL_NOT_APPROVED']})],
  [cleared({reasons:'MODEL_NOT_APPROVED'})],
  [cleared({side:1})],
  [cleared({line:'5.5'})],
  [cleared({odds:[-153]})]
 ]){
  const view=await widget(body(rows));
  assert.doesNotMatch(view.cards[0].textContent,/BUY — cleared/);
  assert.match(view.cards[0].textContent,/AVOID — not cleared/);
 }
});

test('malformed probabilities never render as numerical research confidence',async()=>{
 for(const probability of [-.2,1.2,'0.9',null]){
  const view=await widget(body([row({modelProbability:probability})]));
  assert.match(view.text,/Research estimate[^\n]*Unavailable/);
  assert.doesNotMatch(view.text,/Research estimate[^\n]*-20\.0%|Research estimate[^\n]*120\.0%/);
 }
});

test('declared PLAY with invalid probability, stale paired evidence or a mismatched market probability remains AVOID',async()=>{
 for(const patch of [
  {modelProbability:1.2},{modelProbability:null},{modelProbability:'0.7'},
  {marketProbability:'0.5'},{marketProbability:null},{marketProbability:.99},
  {oppositeOdds:null},{oppositeOdds:'116'},{oppositeOdds:[116]},
  {quoteAt:new Date(now-600001).toISOString()},
  {oppositeQuoteAt:new Date(now-600001).toISOString()},
  {forecastAt:new Date(now-600001).toISOString()},
  {quoteAt:new Date(now+1).toISOString()},
  {oppositeQuoteAt:null},{contract:'unknown'}
 ]){
  const data=body([cleared(patch)]),before=JSON.stringify(data),view=await widget(data);
  assert.match(view.cards[0].textContent,/AVOID — not cleared/,JSON.stringify(patch));
  assert.doesNotMatch(view.cards[0].textContent,/BUY — cleared/);
  assert.match(view.text,/Research estimate/);
  assert.equal(JSON.stringify(data),before);
 }
});

test('research disclosure expansion survives a currentness recheck',async()=>{
 const view=await widget(body()),details=descendants(view.main).filter(node=>node.attributes['data-nba-evaluation']);
 details[0].open=true;view.tick(now+1000);
 const refreshed=descendants(view.main).filter(node=>node.attributes['data-nba-evaluation']);
 assert.equal(refreshed[0].open,true);assert.equal(refreshed[1].open,false);
});

test('conflicting recorded and roster names stay unavailable, and malformed name feeds cannot crash decisions',async()=>{
 const view=await widget(body([row({playerName:'Different Recorded Name'})]));
 view.setNames(names(),now);
 assert.match(descendants(view.cards[0]).find(node=>node.tag==='h3').textContent,/Player name unavailable/);
 const malformed=names();malformed.events[0].players={not:'an array'};
 assert.doesNotThrow(()=>view.setNames(malformed,now));
 assert.match(view.cards[0].textContent,/AVOID — not cleared/);
});

test('the live read handler preserves distinct model records and their status and probabilities',async()=>{
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
