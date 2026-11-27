import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {propsResponse} from '../../sharp-service/api/nbaprops.js';
import {researchPropsResponse} from '../../sharp-service/lib/nba-research-props.js';
import {assessPropQuote} from '../../sharp-service/prop-price-checks.js';
import {buildDeepDive} from '../../sharp-service/deep-dive.js';
import {setNbaQuoteNames} from '../../sharp-service/nba-live.js';
import {normalizeResearch,groupResearchRows,filterResearch} from '../../sharp-service/research-data.js';
import {displayPlayerName,formatCentralTime,formatProbability,shortReason} from '../../sharp-service/ui-format.js';
import {bookLabel} from '../../sharp-service/book-catalog.js';

const at='2026-11-23T17:43:05.616Z',now=Date.parse(at);
const playerID='BRANDON_MILLER_1_NBA';
// Minimal reconstruction of the captured default response and matching SGO
// research metadata. This fixture is local; no live provider calls are made.
function providerEvent(){
 const e={eventID:'Sk80aOQhIGWVFdi4BqLD',leagueID:'NBA',type:'match',status:{startsAt:'2026-11-24T00:00:00.000Z'},teams:{home:{teamID:'CHARLOTTE_HORNETS_NBA',names:{long:'Charlotte Hornets'}},away:{teamID:'MEMPHIS_GRIZZLIES_NBA',names:{long:'Memphis Grizzlies'}}},players:{[playerID]:{playerID,name:'Brandon Miller',teamID:'CHARLOTTE_HORNETS_NBA'}},odds:{}};
 for(const [side,odds] of [['over','-166'],['under','+126']]){
  const oddID=`assists-${playerID}-game-ou-${side}`;
  e.odds[oddID]={oddID,playerID,statEntityID:playerID,statID:'assists',periodID:'game',betTypeID:'ou',sideID:side,byBookmaker:{draftkings:{overUnder:'2.5',odds,available:true,lastUpdatedAt:'2026-11-23T17:42:52.513Z'}}};
 }
 return e;
}
const price=(event,side)=>event.odds[`assists-${playerID}-game-ou-${side}`].byBookmaker.draftkings;
async function response(event=providerEvent(),{research=false,fetchedAt=now,nextCursor=null}={}){
 const requests=[];
 const load=research?researchPropsResponse:propsResponse;
 const result=await load({now,key:'synthetic-test-key',optimize:async()=>({blocked:false,effectiveLimit:16}),fetchPage:async request=>{
  requests.push(request);return {payload:{success:true,data:[event],nextCursor},fetchedAt,cacheStatus:'HIT'};
 }});
 assert.equal(result.status,200);
 return {body:result.body,requests};
}

const html=readFileSync(new URL('../../sharp-service/nba.html',import.meta.url),'utf8');
const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
 .replace(/^import .*;$/gm,'')
 .replace(/\$\('refresh'\)\.addEventListener\('click',refresh\);refresh\(\);/,'');
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this._text='';this.value='';}
 addEventListener(){}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('\n');}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;this._text='';}
 get childElementCount(){return this.children.length;}
}
function render(body,checkedAt=now){
 const nodes=new Map(),deep=[];
 const document={createElement:tag=>new Element(tag),getElementById:id=>{
  if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);
 }};
 const appendDeepDive=(parent,row,options)=>{
  deep.push(row);const node=new Element('details');
  node.textContent=buildDeepDive(row,options).sections.map(section=>section.text).join('\n');parent.append(node);
 };
 new Function('document','appendDeepDive','preserveDeepDives','appendDecision','assessPropQuote','setNbaQuoteNames','normalizeResearch','groupResearchRows','filterResearch','displayPlayerName','formatCentralTime','formatProbability','shortReason','bookLabel','data','now',source+'\nrenderProps(data,now);')(document,appendDeepDive,()=>{},()=>{},assessPropQuote,setNbaQuoteNames,normalizeResearch,groupResearchRows,filterResearch,displayPlayerName,formatCentralTime,formatProbability,shortReason,bookLabel,body,checkedAt);
 return {text:nodes.get('props-cards').textContent,nodes,deep};
}

test('the default NBA API preserves names and provider identity through the actual page renderer',async()=>{
 const {body,requests}=await response();
 const query=new URL(requests[0].url).searchParams;
 assert.equal(requests.length,1);assert.equal(query.get('bookmakerID'),'draftkings');
 assert.equal(query.get('oddIDs'),'points-PLAYER_ID-game-ou-over,points-PLAYER_ID-game-ou-under,rebounds-PLAYER_ID-game-ou-over,rebounds-PLAYER_ID-game-ou-under,assists-PLAYER_ID-game-ou-over,assists-PLAYER_ID-game-ou-under');
 assert.equal(query.get('limit'),'16');assert.equal(body.productionEligible,false);assert.equal(body.productionWeight,0);
 assert.deepEqual(body.events[0].matchup,{home:{name:'Charlotte Hornets'},away:{name:'Memphis Grizzlies'}});
 assert.equal(body.events[0].players[0].prop.identityStatus,'PROVIDER_ROSTER_MATCHED');
 const view=render(body);
 assert.match(view.text,/Brandon Miller/);
 assert.match(view.text,/Memphis Grizzlies @ Charlotte Hornets/);
 assert.match(view.text,/Provider roster matched.*SportsGameOdds/);
 assert.doesNotMatch(view.text,/\(ESPN\)|team unavailable|quote quality: Unknown/);
 assert.match(view.text,/2 of 2 quote sides comparable/);
 assert.match(view.text,/Quote checks assessed/);
 assert.match(view.text,/PREDICTION UNAVAILABLE/);
 assert.match(view.text,/PROP_CALIBRATION_UNVALIDATED/);
 assert.equal(view.deep[0].model,null);
 assert.equal(view.deep[0].productionEligible,false);
});

test('research metadata also renders provider identity, price checks and visible readiness reasons',async()=>{
 const {body}=await response(providerEvent(),{research:true});
 assert.equal(body.contract,'nba-multibook-research-v1');
 const view=render(body);
 assert.match(view.text,/Provider roster matched.*SportsGameOdds/);
 assert.match(view.text,/2 of 2 quote sides comparable/);
 assert.match(view.text,/projected playing time/);
 assert.match(view.text,/PLAYER_INJURY_CLEARANCE_UNVERIFIED/);
 assert.deepEqual(view.deep[0].propReadiness,body.events[0].players[0].propReadiness);
 assert.deepEqual(view.deep[0].reasons,body.events[0].players[0].propReadiness.reasons);
 assert.doesNotMatch(view.text,/Player roster identity is unverified|quote quality: Unknown/);
});

test('default quotes require an explicit provider availability flag for comparability',async()=>{
 for(const available of [false,undefined]){
  const event=providerEvent();
  for(const side of ['over','under'])if(available===undefined)delete price(event,side).available;else price(event,side).available=available;
  const {body}=await response(event);
  const prop=body.events[0].players[0].prop;
  assert.equal(prop.over.books.draftkings.available,false);
  assert.equal(prop.under.books.draftkings.available,false);
  const view=render(body);
  assert.match(view.text,/0 of 2 quote sides comparable/);
  assert.match(view.text,/Quote availability is not confirmed/);
  assert.equal(view.deep[0].model,null);
 }
});

test('stale, future, missing and different-line opposite prices stay visibly noncomparable',async()=>{
 for(const change of [
  event=>{price(event,'under').lastUpdatedAt='2026-11-23T17:30:00Z';},
  event=>{price(event,'under').lastUpdatedAt='2026-11-23T17:45:00Z';},
  event=>{delete event.odds[`assists-${playerID}-game-ou-under`];},
  event=>{price(event,'under').overUnder='3.5';}
 ]){
  const event=providerEvent();change(event);
  const {body}=await response(event),view=render(body);
  assert.match(view.text,/0 of [12] quote sides comparable/);
  assert.match(view.text,/Fresh opposite-side price at this exact book and line is missing/);
  assert.doesNotMatch(view.text,/[1-9]\d* of \d+ quote sides comparable/);
 }
});

test('a later assessment expires the same snapshot without changing source timestamps',async()=>{
 const {body}=await response(),before=JSON.stringify(body);
 assert.match(render(body).text,/2 of 2 quote sides comparable/);
 const later=now+6*60000,view=render(body,later);
 assert.match(view.text,/0 of 2 quote sides comparable/);
 assert.match(view.text,/Quote is over five minutes old/);
 assert.match(view.text,/Quote checks assessed/);
 assert.ok(view.text.includes(formatCentralTime(later,{seconds:true})));
 assert.equal(JSON.stringify(body),before);
});

test('missing names and a player outside the event roster stay explicit rather than fabricated',async()=>{
 const event=providerEvent();delete event.teams.home.names;delete event.teams.away.names;
 delete event.players[playerID].name;event.players[playerID].teamID='OTHER_TEAM_NBA';
 const {body}=await response(event),view=render(body);
 assert.equal(body.events[0].players[0].prop.identityStatus,'UNVERIFIED');
 assert.match(view.text,/Brandon Miller/);
 assert.match(view.text,/Display name formatted from provider ID/);
 assert.match(view.text,/Away team unavailable @ Home team unavailable/);
 assert.match(view.text,/Player roster identity is unverified/);
 assert.match(view.text,/PLAYER_EVENT_IDENTITY_UNVERIFIED/);
 assert.doesNotMatch(view.text,/Provider roster matched/);
});

test('the page preserves existing historical context while forwarding all missing-readiness reasons',async()=>{
 const {body}=await response();
 const context={contract:'nba-explanation-only-v1',position:'F',features:{expectedMinutes:{value:30.54,source:'Synthetic test evidence',gameCount:10,cutoff:at,observedAt:at}}};
 body.events[0].players[0].context=context;
 const view=render(body);
 assert.equal(view.deep[0].context,context);
 assert.match(view.text,/30.54 historical average minutes/);
 assert.match(view.text,/PROJECTED_MINUTES_UNAVAILABLE/);
 assert.match(view.text,/ROTATION_UNCONFIRMED/);
 assert.match(view.text,/No prop play is cleared/);
 assert.equal(view.deep[0].propReadiness.projectedMinutes,null);
});

test('malformed default-feed cursors cannot claim complete coverage or consume another page',async()=>{
 for(const nextCursor of [false,0,{},[],'x'.repeat(2049)]){
  const {body,requests}=await response(providerEvent(),{nextCursor});
  assert.equal(body.coverage.eventsComplete,false);
  assert.ok(body.coverage.reasons.includes('INVALID_CURSOR'));
  assert.equal(requests.length,1);
 }
 for(const nextCursor of [null,undefined,'']){
  const {body,requests}=await response(providerEvent(),{nextCursor});
  assert.equal(body.coverage.eventsComplete,true);
  assert.equal(requests.length,1);
 }
});

test('array or boolean prop lines cannot be coerced into bookmaker observations',async()=>{
 for(const overUnder of [[2.5],true,false,[],{},'  ',null]){
  const event=providerEvent();
  for(const side of ['over','under'])price(event,side).overUnder=overUnder;
  const {body}=await response(event);
  assert.equal(body.events[0].players.length,0,JSON.stringify(overUnder));
  assert.match(render(body).text,/No upcoming NBA player quotes/);
 }
});

test('array prices cannot manufacture a comparable pair and valid decimal strings retain exact values',async()=>{
 const event=providerEvent();price(event,'over').odds=[-166];price(event,'under').odds=[126];
 const {body}=await response(event);
 assert.equal(body.events[0].players.length,0);
 assert.match(render(body).text,/No upcoming NBA player quotes/);
 const valid=await response(),prop=valid.body.events[0].players[0].prop;
 assert.equal(prop.over.books.draftkings.line,2.5);
 assert.equal(prop.over.books.draftkings.odds,-166);
 assert.equal(prop.under.books.draftkings.odds,126);
 assert.match(render(valid.body).text,/2 of 2 quote sides comparable/);
});
