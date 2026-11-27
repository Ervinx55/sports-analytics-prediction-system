import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {currentDecisionCard,currentSelectionKey,rankByWinProbability} from '../../sharp-service/current-card.js';
import {displayPlayerName,formatCentralTime,formatProbability} from '../../sharp-service/ui-format.js';

const now=Date.parse('2026-11-27T18:00:00Z');
const observation=(id,overrides={})=>({id,sport:'MLB',event_id:'game-1',starts_at:'2026-11-27T19:00:00Z',captured_at:'2026-11-27T17:59:00Z',player_id:'DERRICK_WHITE_1_NBA',player_name:null,stat_id:'batting_hits',side:'over',line:0.5,best_book:'draftkings',best_odds:-110,status:'PLAY',model_probability:0.65,market_fair_probability:0.5,model_version:'approved-v1',reason:'Full recorded explanation.',...overrides});
const grade=rows=>currentDecisionCard({sport:'MLB',props:rows},{sport:'MLB',kind:'props',now});

test('current exact-wager snapshots collapse to the newest row without mutating observations',()=>{
 const rows=[observation('old',{captured_at:'2026-11-27T17:58:00Z'}),observation('latest'),observation('latest')];
 const before=structuredClone(rows),result=grade(rows);
 assert.deepEqual(result.props.map(row=>row.id),['latest']);
 assert.equal(result.summary.gradedProps,1);assert.equal(result.summary.play,1);
 assert.equal(result.supersededObservations,2);assert.deepEqual(rows,before);
});

test('a newer unavailable quote or rejection replaces an older BUY for the same wager',()=>{
 for(const replacement of [{status:'PASS'},{available:false},{quoteAvailable:false},{marketAvailable:false},{productionEligible:false}]){
  const result=grade([observation('old',{captured_at:'2026-11-27T17:58:00Z'}),observation('new',replacement)]);
  assert.equal(result.props.length,1);assert.equal(result.props[0].id,'new');assert.equal(result.plays.length,0);
 }
});

test('books, alternate lines, opposite sides, periods, starts, players, sports, and models stay distinct',()=>{
 const base=observation('base');
 const changes=[{best_book:'fanduel'},{line:1.5},{side:'under'},{period:'first-inning'},{starts_at:'2026-11-27T20:00:00Z'},{player_id:'OTHER_PLAYER_1_MLB'},{sport:'NBA'},{model_version:'challenger-v2'},{stat_id:'batting_totalBases'},{event_id:'game-2'}];
 const keys=[base,...changes.map((change,index)=>observation('different-'+index,change))].map(row=>currentSelectionKey(row));
 assert.equal(new Set(keys).size,keys.length);
 assert.equal(currentSelectionKey(base),currentSelectionKey({...base,id:'another-observation',line:'0.50',best_book:'DraftKings',side:'OVER',starts_at:'2026-11-27T13:00:00-06:00'}));
});

test('missing player or book identity does not merge unrelated observations by display label',()=>{
 assert.equal(grade([observation('a',{player_id:null}),observation('b',{player_id:null})]).props.length,2);
 assert.equal(grade([observation('a',{best_book:null}),observation('b',{best_book:null})]).props.length,2);
 assert.notEqual(currentSelectionKey(observation('a',{line:null})),currentSelectionKey(observation('b',{line:0})));
 assert.notEqual(currentSelectionKey(observation('a',{line:false})),currentSelectionKey(observation('a',{line:0})));
});

test('equal-time conflicts use the withheld observation regardless of source ordering',()=>{
 const a=observation('buy'),b=observation('withheld',{available:false});
 assert.equal(grade([a,b]).plays.length,0);assert.equal(grade([b,a]).plays.length,0);
 assert.equal(grade([a,b]).props[0].id,'withheld');assert.equal(grade([b,a]).props[0].id,'withheld');
});

test('conflicting equal-time decision facts withhold BUY without mutating source evidence',()=>{
 for(const change of [{model_probability:.8},{market_fair_probability:.6},{best_odds:120},{ev_pct:15},{edge_pct_points:12},{validUntil:'2026-11-27T18:05:00Z'}]){
  const a=observation('a'),b=observation('b',change),before=structuredClone([a,b]);
  for(const rows of [[a,b],[b,a]]){
   const result=grade(rows);assert.equal(result.plays.length,0);assert.equal(result.props.length,1);
   assert.equal(result.props[0].observationConflict,true);assert.match(result.props[0].reason,/Conflicting current observations/);
  }
  assert.deepEqual([a,b],before);
 }
 const duplicates=grade([observation('a'),observation('b')]);
 assert.equal(duplicates.plays.length,1);assert.notEqual(duplicates.props[0].observationConflict,true);
});

test('the latest unavailable exact quote withholds older model BUYs across model versions',()=>{
 for(const flag of ['available','quoteAvailable','marketAvailable']){
  const a=observation('approved',{captured_at:'2026-11-27T17:58:00Z'}),b=observation('withdrawn',{model_version:'research-v2',status:'PASS',[flag]:false});
  const before=structuredClone([a,b]);
  for(const rows of [[a,b],[b,a]]){
   const result=grade(rows);assert.equal(result.props.length,2);assert.equal(result.plays.length,0);
   const approved=result.props.find(row=>row.id==='approved');assert.equal(approved.latestQuoteUnavailable,true);assert.equal(approved.recordedStatus,'PLAY');
   assert.match(approved.reason,/latest market observation is unavailable/);
  }
  assert.deepEqual([a,b],before);
 }
});

test('distinct model estimates remain independent when the same latest quote is available',()=>{
 const a=observation('approved',{model_probability:.7}),b=observation('research',{model_version:'research-v2',model_probability:.8});
 assert.equal(grade([a,b]).plays.length,2);
 const disabled={...b,status:'PASS',productionEligible:false};
 assert.deepEqual(grade([a,disabled]).plays.map(row=>row.id),['approved']);
 const olderWithdrawal={...b,available:false,captured_at:'2026-11-27T17:58:00Z'};
 assert.deepEqual(grade([a,olderWithdrawal]).plays.map(row=>row.id),['approved']);
 const priceConflict={...b,best_odds:120};
 assert.equal(grade([a,priceConflict]).plays.length,0);
});

test('a newer different price supersedes an older model BUY while an identical price preserves freshness rules',()=>{
 const older=observation('older',{captured_at:'2026-11-27T17:58:00Z'});
 for(const price of [-120,130]){
  const newer=observation('newer',{model_version:'research-v2',available:true,best_odds:price,status:'PASS'}),before=structuredClone([older,newer]);
  for(const rows of [[older,newer],[newer,older]]){
   const result=grade(rows);assert.equal(result.plays.length,0);assert.equal(result.props.length,2);
   const old=result.props.find(row=>row.id==='older');assert.equal(old.priceSuperseded,true);assert.equal(old.recordedStatus,'PLAY');assert.match(old.reason,/market price changed/);
  }
  assert.deepEqual([older,newer],before);
  assert.deepEqual(grade([older,{...newer,status:'PLAY'}]).plays.map(row=>row.id),['newer']);
  for(const samePrice of [-110,'-110'])assert.deepEqual(grade([older,{...newer,best_odds:samePrice}]).plays.map(row=>row.id),['older']);
 }
});

test('player and team identity both remain part of an exact selection',()=>{
 const a=observation('team-a',{team_id:'A'}),b=observation('team-b',{team_id:'B'});
 assert.notEqual(currentSelectionKey(a),currentSelectionKey(b));assert.equal(grade([a,b]).props.length,2);
 const withdrawn={...b,available:false,captured_at:'2026-11-27T17:59:30Z'};
 assert.deepEqual(grade([a,withdrawn]).plays.map(row=>row.id),['team-a']);
 const anotherPlayer={...a,player_id:'OTHER_PLAYER'};
 assert.notEqual(currentSelectionKey(a),currentSelectionKey(anotherPlayer));
});

test('explicitly expired decisions cannot retain a current BUY even when capture is fresh',()=>{
 for(const expiry of [{validUntil:'2026-11-27T18:00:00Z'},{valid_until:'2026-11-27T17:59:30Z'},{validUntil:'invalid'}]){
  const result=grade([observation('expired',expiry)]);
  assert.equal(result.plays.length,0);assert.equal(result.props[0].recordedStatus,'PLAY');
 }
});

function dashboardHarness(){
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:id==='propStatus'?'all':id==='propSort'?'start':'',hidden:false,addEventListener(){},classList:{add(){},toggle(){}}});return elements.get(id);};
 const document={getElementById:element,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},body:{}};
 const html=readFileSync(new URL('../../sharp-service/dashboard.html',import.meta.url),'utf8');
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'').replace(/  load\(false\);\s*$/,'');
 const make=new Function('document','location','window','rankByWinProbability','currentDecisionCard','currentSelectionKey','displayPlayerName','formatCentralTime','formatProbability','deepDiveHtml','preserveDeepDives',script+'\nreturn {renderPlayerProps,renderPropPlaysInPlays,renderMarketCard,renderPropGradeBoard};');
 const api=make(document,{hash:''},{addEventListener(){}},rankByWinProbability,currentDecisionCard,currentSelectionKey,displayPlayerName,formatCentralTime,formatProbability,()=>'<details class="el-deep-dive"><summary>Full evidence</summary></details>',()=>{});
 return {...api,element,html};
}

test('dashboard presents readable player names and only one full BUY card location',()=>{
 const h=dashboardHarness(),row=observation('one'),card=grade([row]);
 h.renderPlayerProps(card);h.renderPropPlaysInPlays(card);
 assert.match(h.element('playsPropList').innerHTML,/>Derrick White<\/h3>/);
 assert.equal((h.element('playsPropList').innerHTML.match(/class="card dashboard-prop-buy"/g)||[]).length,1);
 assert.doesNotMatch(h.element('propPlayList').innerHTML,/dashboard-prop-buy/);
 assert.doesNotMatch(h.element('propGradeList').innerHTML,/data-dashboard-detail/);
 assert.match(h.element('propGradeList').innerHTML,/Open full BUY card/);
 assert.doesNotMatch(h.html,/id="propPendingList"/);
 assert.equal((h.html.match(/data-nba-live-mount/g)||[]).length,1);
});

test('dashboard prop search, status and sorting operate on valid values with missing probabilities last',()=>{
 const h=dashboardHarness(),rows=[observation('missing',{status:'PASS',player_name:'Missing Model',model_probability:null}),observation('higher',{player_name:'Higher Chance',model_probability:0.8}),observation('lower',{player_name:'Lower Chance',model_probability:0.6})];
 h.element('propSort').value='model';h.renderPropGradeBoard({props:rows});
 let html=h.element('propGradeList').innerHTML;
 assert.ok(html.indexOf('Higher Chance')<html.indexOf('Lower Chance'));assert.ok(html.indexOf('Lower Chance')<html.indexOf('Missing Model'));assert.match(html,/N\/A/);
 h.element('propStatus').value='PASS';h.renderPropGradeBoard({props:rows});
 assert.match(h.element('propBoardCount').textContent,/^1 unique/);assert.doesNotMatch(h.element('propGradeList').innerHTML,/Higher Chance/);
 h.element('propStatus').value='all';h.element('propSearch').value='lower';h.renderPropGradeBoard({props:rows});
 assert.match(h.element('propBoardCount').textContent,/^1 unique/);assert.match(h.element('propGradeList').innerHTML,/Lower Chance/);
});

test('unavailable prop data remains unavailable instead of becoming a zero-play claim',()=>{
 const h=dashboardHarness(),card=currentDecisionCard(null,{sport:'MLB',kind:'props',now});
 h.renderPlayerProps(card);h.renderPropPlaysInPlays(card);
 assert.equal(h.element('pPlay').textContent,'Unavailable');assert.equal(h.element('playsPropCountBadge').textContent,'UNAVAILABLE');
 assert.match(h.element('propBoardCount').textContent,/unavailable/);assert.doesNotMatch(h.element('propPlayList').innerHTML,/0 cleared/);
});

test('overview shows compact game counts and links rather than repeating full BUY evidence',()=>{
 const h=dashboardHarness(),row=observation('team',{player_id:null,stat_id:null,market_type:'moneyline',market_label:'Houston ML',away_team:'Away',home_team:'Houston',side:'home',line:null});
 h.renderMarketCard({markets:[row]});
 assert.match(h.element('marketCardList').innerHTML,/1 BUY/);assert.match(h.element('marketCardList').innerHTML,/Open BUY card/);
 assert.doesNotMatch(h.element('marketCardList').innerHTML,/data-dashboard-detail/);
});

test('dashboard tabs follow hash navigation and refresh once per section change',()=>{
 const makeNode=id=>({id,dataset:{tab:id},active:id==='today',attributes:{},listeners:{},classList:{toggle(name,value){this.owner.active=value;}},setAttribute(name,value){this.attributes[name]=value;},addEventListener(name,handler){this.listeners[name]=handler;}});
 const tabs=['today','plays','results','system'].map(makeNode),sections=tabs.map(tab=>makeNode(tab.id));
 for(const node of [...tabs,...sections])node.classList.owner=node;
 const listeners={},location={hash:'#plays'},window={addEventListener(name,handler){listeners[name]=handler;}},document={querySelectorAll(selector){return selector==='.tab'?tabs:selector==='.section'?sections:[];},querySelector(){return tabs.find(tab=>tab.active);},addEventListener(name,handler){listeners['document-'+name]=handler;}};
 let refreshes=0;
 const html=readFileSync(new URL('../../sharp-service/dashboard.html',import.meta.url),'utf8'),routing=html.slice(html.indexOf('  const currentView='),html.indexOf('  let propBoardLimit='));
 new Function('document','location','window','$','load',routing)(document,location,window,id=>sections.find(section=>section.id===id),()=>refreshes++);
 const active=()=>tabs.find(tab=>tab.active).id;
 assert.equal(active(),'plays');assert.equal(refreshes,0);assert.equal(tabs[1].attributes['aria-selected'],'true');
 location.hash='#results';listeners.hashchange();assert.equal(active(),'results');assert.equal(refreshes,1);
 listeners.hashchange();assert.equal(refreshes,1);
 tabs[3].listeners.click();assert.equal(location.hash,'#system');listeners.hashchange();assert.equal(active(),'system');assert.equal(refreshes,2);
 tabs[3].listeners.click();assert.equal(refreshes,2);
 let prevented=false;
 listeners['document-click']({target:{closest:()=>({dataset:{openTab:'plays'}})},preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(location.hash,'#plays');listeners.hashchange();assert.equal(active(),'plays');assert.equal(refreshes,3);
 tabs[0].listeners.click();assert.equal(location.hash,'');listeners.hashchange();assert.equal(active(),'today');assert.equal(refreshes,4);
 location.hash='#unknown';listeners.hashchange();assert.equal(active(),'today');assert.equal(refreshes,4);
});
