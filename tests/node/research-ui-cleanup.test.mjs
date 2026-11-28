import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatCentralTime} from '../../sharp-service/ui-format.js';
import {normalizeResearch,latestResearchObservations,groupResearchRows,sortResearchGroups,filterResearch,refreshResearchRow} from '../../sharp-service/research-data.js';
import {appendGameMatchup} from '../../sharp-service/game-card-view.js';
const now=Date.parse('2026-11-27T17:00:00Z'),stamp=new Date(now-1000).toISOString(),older=new Date(now-60000).toISOString(),start=new Date(now+3600000).toISOString();
const q=(patch={})=>({line:3.5,odds:-110,available:true,updatedAt:stamp,...patch});
function body(players){return {contract:'nba-multibook-research-v1',source:'SportsGameOdds',generatedAt:stamp,events:[{eventID:'sgo:test',provider:'SportsGameOdds',startsAt:start,matchup:{away:{name:'Hawks'},home:{name:'Celtics'}},players}]};}
function player(patch={}){return {prop:{playerID:'DERRICK_WHITE_1_NBA',statID:'rebounds',over:{books:{draftkings:q()}},under:{books:{draftkings:q()}},...patch}};}
function matchupDocument(){
 const doc={createElement(tag){
  const node={tagName:tag.toUpperCase(),ownerDocument:doc,children:[],attributes:{},dataset:{},value:'',
   append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);return child;},
   setAttribute(name,value){this.attributes[name]=String(value);}};
  Object.defineProperty(node,'textContent',{get(){return this.value+this.children.map(child=>child.textContent).join('');},set(value){this.value=String(value);this.children=[];}});
  return node;
 }};
 return doc;
}
const visibleText=node=>node.hidden||node.attributes['aria-hidden']==='true'?'':node.value+node.children.map(visibleText).join('');
test('game matchup presentation preserves team order and uses two team identities without player portraits',()=>{
 const doc=matchupDocument(),parent=doc.createElement('div');
 const options={sport:'NBA',away:{name:'Atlanta Hawks',id:'ATLANTA_HAWKS_NBA'},home:{name:'Boston Celtics',id:'BOSTON_CELTICS_NBA'}},before=structuredClone(options);
 const heading=appendGameMatchup(parent,options);
 assert.equal(heading.tagName,'H3');assert.equal(parent.children[0],heading);
 assert.equal(visibleText(heading),'Atlanta Hawks vs Boston Celtics');
 assert.deepEqual(heading.children.map(child=>child.className),['team-identity','game-matchup-separator','team-identity']);
 assert.equal(heading.children[0].children[0].children[0].src,'/assets/team-logos/nba/atl.png');
 assert.equal(heading.children[2].children[0].children[0].src,'/assets/team-logos/nba/bos.png');
 assert.deepEqual(options,before,'Presentation cannot rewrite provider team identity or order');
});
test('compact game matchup stays inline and retains the supplied at/versus distinction',()=>{
 const doc=matchupDocument(),parent=doc.createElement('span');
 const heading=appendGameMatchup(parent,{sport:'NBA',away:'Oklahoma City Thunder',home:'Golden State Warriors',separator:'at',compact:true,tag:'span',className:'player-row-heading'});
 assert.equal(heading.tagName,'SPAN');assert.ok(heading.children.every(child=>child.tagName==='SPAN'));
 assert.match(heading.className,/game-matchup-compact/);
 assert.equal(visibleText(heading),'Oklahoma City Thunder at Golden State Warriors');
});
test('unresolved and markup-like team names remain full literal names with no image request',()=>{
 const doc=matchupDocument(),parent=doc.createElement('div'),name='<img src=x onerror=alert(1)> Home';
 const heading=appendGameMatchup(parent,{sport:'NBA',away:'Unknown visiting team',home:name});
 assert.equal(visibleText(heading),'Unknown visiting team vs '+name);
 for(const identity of [heading.children[0],heading.children[2]]){
  assert.equal(identity.children[0].children.some(child=>child.tagName==='IMG'),false);
  assert.equal(identity.children[0].children[0].hidden,false);
  assert.equal(identity.children[1].tagName,'SPAN');
 }
});
test('provider ID fallback creates readable name without changing roster identity',()=>{
 const rows=normalizeResearch(body([player()]),'NBA',now);
 assert.ok(rows.every(row=>row.player==='Derrick White'&&row.nameSource==='provider-id'));
 assert.ok(rows.every(row=>row.playerID==='DERRICK_WHITE_1_NBA'&&row.identityStatus===''&&row.model===null));
});
test('price snapshots collapse before grouping, with history retained and input unchanged',()=>{
 const first=player({over:{books:{draftkings:q({odds:120,updatedAt:older})}},under:{books:{draftkings:q({updatedAt:older})}}});
 const latest=player();const data=body([first,latest]),before=structuredClone(data);
 for(const list of [[first,latest],[latest,first]]){
  const rows=normalizeResearch(body(list),'NBA',now);assert.equal(rows.length,2);
  assert.equal(rows.find(row=>row.side==='OVER').odds,-110);
  assert.equal(rows.find(row=>row.side==='OVER').observationHistory.length,1);
  assert.equal(groupResearchRows(rows).length,1);
 }
 assert.deepEqual(data,before);
});
test('newest unavailable observation suppresses old available price in either order',()=>{
 const old=player({over:{books:{draftkings:q({updatedAt:older})}},under:{books:{draftkings:q({updatedAt:older})}}});
 const withdrawn=player({over:{books:{draftkings:q({available:false})}}});
 for(const records of [[old,withdrawn],[withdrawn,old]]){
  const rows=normalizeResearch(body(records),'NBA',now),over=rows.find(row=>row.side==='OVER'),under=rows.find(row=>row.side==='UNDER');
  assert.equal(over.available,false);assert.equal(over.status,'UNAVAILABLE');assert.equal(over.market,null);assert.equal(over.model,null);assert.equal(under.market,null);
  assert.equal(refreshResearchRow(over,now).market,null);
  assert.equal(filterResearch(rows,{status:'UNAVAILABLE'}).length,1);
 }
});
test('ties with conflicting price facts are visibly unavailable, not chosen by row order',()=>{
 const one=player(),two=player({over:{books:{draftkings:q({odds:140})}}});
 for(const records of [[one,two],[two,one]]){
  const over=normalizeResearch(body(records),'NBA',now).find(row=>row.side==='OVER');
  assert.equal(over.quoteConflict,true);assert.equal(over.available,false);assert.equal(over.market,null);assert.match(over.reason,/Conflicting/);
 }
});
test('identical duplicate snapshots do not manufacture a quote conflict',()=>{
 const data=body([player(),player()]),rows=normalizeResearch(data,'NBA',now);
 assert.equal(rows.length,2);assert.ok(rows.every(row=>!row.quoteConflict&&row.market===.5));
});
test('one player market contains both sides, all books and alternate lines',()=>{
 const rows=normalizeResearch(body([player({over:{books:{draftkings:q(),fanduel:q()}},under:{books:{draftkings:q(),fanduel:q()}}}),player({over:{books:{draftkings:q({line:4.5})}},under:{books:{draftkings:q({line:4.5})}}})]),'NBA',now);
 const groups=groupResearchRows(rows);assert.equal(rows.length,6);assert.equal(groups.length,1);
 assert.deepEqual([...new Set(groups[0].rows.map(row=>row.line))],[3.5,4.5]);
 assert.equal(new Set(groups[0].rows.map(row=>row.id)).size,6);
});
test('different period, start time, event and sport never dedupe together',()=>{
 const base=normalizeResearch(body([player()]),'NBA',now)[0];
 const rows=[base,{...base,id:'reg',period:'reg'},{...base,id:'start',startsAt:new Date(now+7200000).toISOString()},{...base,id:'event',eventID:'other'},{...base,id:'sport',sport:'NFL'}];
 assert.equal(latestResearchObservations(rows,now).length,5);assert.equal(groupResearchRows(rows).length,5);
});
test('exact period prevents joining an NFL model for another game period',()=>{
 const data=body([player({period:'reg'})]);data.candidates=[{eventID:'sgo:test',startsAt:start,playerID:'DERRICK_WHITE_1_NBA',statID:'rebounds',side:'OVER',period:'game',line:3.5,book:'draftkings',odds:-110,rawIndependentProbability:.7}];
 const rows=normalizeResearch(data,'NFL',now);assert.ok(rows.every(row=>row.model===null));
});
test('sorting puts missing numerical values after known values without fabricating zero',()=>{
 const groups=[{key:'none',startsAt:start,player:'A',rows:[{model:null,market:null}]},{key:'zero',startsAt:start,player:'B',rows:[{model:0,market:.5}]},{key:'high',startsAt:start,player:'C',rows:[{model:.7,market:.6}]}];
 assert.deepEqual(sortResearchGroups(groups,'model').map(g=>g.key),['high','zero','none']);
 assert.deepEqual(sortResearchGroups(groups,'gap').map(g=>g.key),['high','zero','none']);
 assert.deepEqual(groups.map(g=>g.key),['none','zero','high']);
});
test('search, game and side filters operate on original exact quote rows',()=>{
 const rows=normalizeResearch(body([player()]),'NBA',now);
 const filtered=filterResearch(rows,{query:'Derrick White',side:'UNDER',game:'sgo:test',market:'rebounds',book:'draftkings'});
 assert.equal(filtered.length,1);assert.equal(filtered[0].side,'UNDER');assert.equal(groupResearchRows(filtered).length,1);
 assert.equal(filterResearch(rows,{game:'another'}).length,0);
});
test('unknown identity does not combine unrelated unnamed players',()=>{
 const data=body([player({playerID:'',playerName:''}),player({playerID:'',playerName:''})]);
 const rows=normalizeResearch(data,'NBA',now);assert.equal(rows.length,4);assert.equal(groupResearchRows(rows).length,4);
});
test('research UI includes exact quote actions, accessible filters and source history disclosure',()=>{
 const html=readFileSync(new URL('../../sharp-service/research.html',import.meta.url),'utf8');
 const panel=html.slice(html.indexOf('id="research-filters"'),html.indexOf('<section id="shortlist-review"'));
 for(const id of ['query','game','side','market','book','sort','research-status','shortlist-toggle','best-prices'])assert.match(panel,new RegExp('id="'+id+'"'));
 assert.match(html,/<button id="research-filter-toggle"[^>]*aria-controls="research-filters"[^>]*aria-expanded="false"/);
 assert.match(panel,/^id="research-filters"[^>]* hidden>/);
 assert.ok(html.indexOf('id="cards"')<html.indexOf('id="status"'),'Live status follows the compact player list');
 assert.ok(html.indexOf('id="cards"')<html.indexOf('class="research-coverage"'),'Coverage follows the compact player list');
 assert.match(html,/<p id="status" role="status" aria-live="polite">/);
 const js=readFileSync(new URL('../../sharp-service/research.js',import.meta.url),'utf8');
 assert.match(js,/groupResearchRows/);assert.match(js,/dataset\.quoteId=row\.id/);assert.match(js,/observationHistory/);assert.match(js,/save\.disabled=row\.available===false/);
});

test('research card times distinguish future Central dates and follow Chicago midnight',()=>{
 const source=readFileSync(new URL('../../sharp-service/research.js',import.meta.url),'utf8');
 const clock=source.slice(source.indexOf('const centralClock='),source.indexOf('\nfunction icon('));
 const tipoff=new Function('date',clock+'\nreturn tipoff;')(formatCentralTime);
 assert.equal(tipoff('2026-11-28T01:00:00Z',now),'7:00 PM CT');
 assert.equal(tipoff('2026-11-29T01:00:00Z',now),'Nov 28 · 7:00 PM CT');
 const evening=Date.parse('2026-11-28T00:15:00Z');
 assert.equal(tipoff('2026-11-28T05:30:00Z',evening),'11:30 PM CT');
 assert.equal(tipoff('2026-11-28T06:30:00Z',evening),'Nov 28 · 12:30 AM CT');
 assert.equal(tipoff(null,now),'N/A');
 assert.equal(tipoff('2026-11-28T01:00:00',now),'N/A');
});

import {normalizeGameResearch,compareResearchPrices} from '../../sharp-service/research-comparison.js';
function gameEvent(when=stamp,available=true){return {eventID:'game',league:'NBA',startsAt:start,status:{},matchup:{home:{id:'H',name:'Home'},away:{id:'A',name:'Away'}},markets:{moneyline:{home:{oddID:'points-home-game-ml-home',books:{draftkings:{odds:-110,line:null,available,updatedAt:when}}},away:{oddID:'points-away-game-ml-away',books:{draftkings:{odds:-110,line:null,available:true,updatedAt:when}}}}}};}
function gameData(events){return {source:'SportsGameOdds',fetchedAt:stamp,providerObservations:[{league:'NBA',provider:'SportsGameOdds',fetchedAt:stamp}],events};}
test('game snapshots retain newest withdrawal and invalidate the old paired outcome',()=>{
 for(const events of [[gameEvent(older),gameEvent(stamp,false)],[gameEvent(stamp,false),gameEvent(older)]]){
  const rows=normalizeGameResearch(gameData(events),'NBA',now);assert.equal(rows.length,2);assert.equal(groupResearchRows(rows).length,1);
  const home=rows.find(row=>row.side==='HOME');assert.equal(home.available,false);assert.equal(home.status,'UNAVAILABLE');assert.equal(home.observationHistory.length,1);
  assert.ok(rows.every(row=>row.market===null));assert.ok([...compareResearchPrices(rows,now).values()].every(c=>c.eligibleBooks===0));
 }
});
test('game price conflicts at the latest timestamp cannot establish an active price',()=>{
 const one=gameEvent(),two=gameEvent();two.markets.moneyline.home.books.draftkings.odds=150;
 const rows=normalizeGameResearch(gameData([one,two]),'NBA',now),home=rows.find(row=>row.side==='HOME');
 assert.equal(home.available,false);assert.equal(home.quoteConflict,true);assert.equal(home.market,null);assert.equal(rows.find(row=>row.side==='AWAY').market,null);
});
test('same named game at another start or period remains a separate market group',()=>{
 const one=gameEvent(),two=gameEvent();two.startsAt=new Date(now+7200000).toISOString();
 const rows=normalizeGameResearch(gameData([one,two]),'NBA',now);
 assert.equal(rows.length,4);assert.equal(new Set(rows.map(row=>row.id)).size,4);assert.equal(groupResearchRows(rows).length,2);
});
test('ambiguous book aliases in the newest game observation cannot revive old prices',()=>{
 const old=gameEvent(older),current=gameEvent();
 current.markets.moneyline.home.books.DraftKings={...current.markets.moneyline.home.books.draftkings,odds:150};
 const rows=normalizeGameResearch(gameData([old,current]),'NBA',now),home=rows.find(row=>row.side==='HOME');
 assert.equal(home.available,false);assert.equal(home.quoteConflict,true);assert.equal(home.market,null);assert.equal(rows.find(row=>row.side==='AWAY').market,null);
});
test('cross-book comparison cannot combine identical event IDs at different start times',()=>{
 const base=normalizeGameResearch(gameData([gameEvent()]),'NBA',now).find(row=>row.side==='HOME');
 const other={...base,id:'rescheduled',book:'fanduel',startsAt:new Date(now+7200000).toISOString()};
 const different=compareResearchPrices([base,other],now);
 assert.equal(different.get(base.id).eligibleBooks,1);assert.equal(different.get(base.id).best,false);assert.equal(different.get(other.id).eligibleBooks,1);
 const same=compareResearchPrices([base,{...other,startsAt:base.startsAt}],now);
 assert.equal(same.get(base.id).eligibleBooks,2);assert.equal(same.get(base.id).best,true);
});
test('cross-book comparison respects provider event namespaces',()=>{
 const base=normalizeGameResearch(gameData([gameEvent()]),'NBA',now).find(row=>row.side==='HOME');
 const other={...base,id:'other-provider',book:'fanduel',provider:'Other Provider'};
 const result=compareResearchPrices([base,other],now);
 assert.equal(result.get(base.id).eligibleBooks,1);assert.equal(result.get(base.id).best,false);assert.equal(result.get(other.id).eligibleBooks,1);
});
test('normalization preserves provider-specific start and quote identities',()=>{
 const first={...gameEvent(),provider:'SportsGameOdds'},second={...gameEvent(),provider:'Other Provider'};
 const data=gameData([first,second]);data.providerObservations.push({league:'NBA',provider:'Other Provider',fetchedAt:stamp});
 const rows=normalizeGameResearch(data,'NBA',now);
 assert.equal(rows.length,4);assert.equal(new Set(rows.map(row=>row.id)).size,4);assert.equal(groupResearchRows(rows).length,2);
 assert.deepEqual([...new Set(rows.map(row=>row.provider))],['SportsGameOdds','Other Provider']);
});
test('unnamed prop rows cannot create a cross-book best-price claim',()=>{
 const base=normalizeResearch(body([player({playerID:'',playerName:''})]),'NBA',now).find(row=>row.side==='OVER');
 const other={...base,id:'other-book',book:'fanduel'};
 const result=compareResearchPrices([base,other],now);
 assert.ok([...result.values()].every(row=>row.best===false&&row.eligibleBooks===0));
});

test('missing subject identity cannot pair another unnamed player or the row with itself',()=>{
 const one=player({playerID:'',playerName:'',over:{books:{draftkings:q({odds:100})}},under:undefined});
 const two=player({playerID:'',playerName:'',over:undefined,under:{books:{draftkings:q({odds:-200})}}});
 const rows=normalizeResearch(body([one,two]),'NBA',now);
 assert.equal(rows.length,2);assert.equal(groupResearchRows(rows).length,2);
 assert.ok(rows.every(row=>row.market===null&&row.oppositeQuote===null&&row.priceCheck.status==='NOT_COMPARABLE'));
 assert.ok([...compareResearchPrices(rows,now).values()].every(row=>row.eligibleBooks===0&&row.best===false));
});
