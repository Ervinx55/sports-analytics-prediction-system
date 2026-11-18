import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {modelRows,marketLabel} from '../../sharp-service/nfl-view.js';
import {buildEdgeBoard} from '../../sharp-service/lib/edge-vnext-board.js';
import {decisionPresentation,decisionTime} from '../../sharp-service/decision-display.js';
import {deepDiveHtml} from '../../sharp-service/deep-dive.js';
import {teamScoringHtml} from '../../sharp-service/team-scoring-view.js';

const html=teamScoringHtml;
const context={contract:'team-scoring-context-v1',purpose:'EXPLANATION_ONLY',adjustmentApplied:false,sport:'NFL',cutoffAt:'2026-11-17T12:00:00Z',observedAt:'2026-11-17T11:00:00Z',source:'Schedule <source>',scope:'Current-season regular-season games',home:{teamId:'H',teamName:'Home <team>',windows:[{key:'history',label:'Current season',pointsFor:24.25,pointsAgainst:0,gameCount:8,requestedGames:null,gameIds:['h1'],latestGameAt:'2026-11-15T18:00:00Z',missingReason:null},{key:'last5',label:'Last 5',pointsFor:26,pointsAgainst:17.4,gameCount:5,requestedGames:5,gameIds:[],latestGameAt:'2026-11-15T18:00:00Z',missingReason:null},{key:'last10',label:'Last 10',pointsFor:24.25,pointsAgainst:0,gameCount:8,requestedGames:10,gameIds:[],latestGameAt:'2026-11-15T18:00:00Z',missingReason:null}]},away:{teamId:'A',teamName:'Away',windows:[{key:'history',label:'Current season',pointsFor:null,pointsAgainst:null,gameCount:0,requestedGames:null,gameIds:[],latestGameAt:null,missingReason:'No verified results'},{key:'last5',label:'Last 5',pointsFor:null,pointsAgainst:null,gameCount:0,requestedGames:5,gameIds:[],latestGameAt:null,missingReason:'No verified results'},{key:'last10',label:'Last 10',pointsFor:null,pointsAgainst:null,gameCount:0,requestedGames:10,gameIds:[],latestGameAt:null,missingReason:'No verified results'}]}};

test('team scoring preserves real zero, missing values, separate samples and partial windows',()=>{
 const before=JSON.stringify(context),rendered=html(context);
 assert.match(rendered,/scores 24\.3\/game/);assert.match(rendered,/allows 0\.0\/game/);
 assert.match(rendered,/Away[\s\S]*?scores Unavailable[\s\S]*?allows Unavailable[\s\S]*?0 games/);
 assert.match(rendered,/8 of 10 games/);assert.match(rendered,/5 of 5 games/);assert.match(rendered,/No verified results/);
 assert.match(rendered,/Historical averages[\s\S]*?not predicted scores/);
 assert.match(rendered,/2026-11-17T12:00:00Z/);assert.match(rendered,/2026-11-17T11:00:00Z/);
 assert.equal(JSON.stringify(context),before);
});

test('scoring evidence never turns source text or team names into active markup',()=>{
 const rendered=html({...context,source:'<img src=x onerror=alert(1)> javascript:alert(1)',scope:'<script>alert(1)</script>'});
 assert.doesNotMatch(rendered,/<img|<script|href=/);assert.match(rendered,/&lt;img/);assert.match(rendered,/Home &lt;team&gt;/);
});

test('absent or incompatible scoring context is visibly unavailable rather than fabricated',()=>{
 for(const value of [undefined,null,{...context,contract:'unknown'},{...context,adjustmentApplied:true}]){
  const rendered=html(value);assert.match(rendered,/Unavailable/);assert.doesNotMatch(rendered,/24\.3|0\.0\/game/);
 }
 const missing=html({...context,home:{...context.home,windows:[]},observedAt:null});
 assert.match(missing,/Home &lt;team&gt;[\s\S]*?Unavailable/);assert.match(missing,/Observed: Unavailable/);
});

test('NFL joins scoring context by exact event without changing probabilities or blocked status',()=>{
 const now=Date.parse('2026-11-17T12:00Z'),startsAt='2026-11-18T01:00Z';
 const data={generatedAt:new Date(now).toISOString(),events:[{eventID:'match',teamScoringContext:context},{eventID:'blocked',startsAt,available:false,teamScoringContext:context,reason:'Starter conflict'}],markets:[{eventID:'match',startsAt,modelProbability:.75,marketFairProbability:.75,probabilitySource:'market_only',independentContributionWeight:0},{eventID:'other',startsAt}]};
 const before=JSON.stringify(data),rows=modelRows(data,'teams',now);
 assert.equal(rows.find(r=>r.eventID==='match').teamScoringContext,context);
 assert.equal(rows.find(r=>r.eventID==='match').model,null);
 assert.equal(rows.find(r=>r.eventID==='match').market,.75);
 assert.equal(rows.find(r=>r.eventID==='blocked').forecastBlocked,true);
 assert.equal(rows.find(r=>r.eventID==='blocked').teamScoringContext,context);
 assert.equal(rows.find(r=>r.eventID==='other').teamScoringContext,undefined);
 assert.equal(JSON.stringify(data),before);
});

function edgeView(payload){
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',disabled:false});return nodes.get(id);};
 const script=fs.readFileSync(new URL('../../sharp-service/edge-vnext.html',import.meta.url),'utf8').match(/<script(?: type="module")?>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
 let failed=false;
 vm.runInNewContext(script,{document:{getElementById:get},URL,location:{origin:'https://example.test'},teamScoringHtml:html,fetch:async()=>{if(failed)throw Error('Refresh failed');return {ok:true,json:async()=>payload};}});
 return {get,fail:()=>{failed=true;}};
}

test('NBA winner row displays scoring history beside unchanged probabilities and research reasons',async()=>{
 const app=edgeView({rows:[{away:'Away',home:'Home',homeWinProbability:.6,awayWinProbability:.4,projectedHomeMargin:3,teamScoringContext:context,reasons:['UNCALIBRATED']}],rankings:{winners:[],value:[]}});
 await app.get('refreshNba').onclick();const rendered=app.get('nbaRows').innerHTML;
 assert.match(rendered,/scores 24\.3\/game/);assert.match(rendered,/60\.0%/);assert.match(rendered,/40\.0%/);assert.match(rendered,/UNCALIBRATED/);
});

test('NFL experimental adapter and table preserve scoring context without promoting market-only forecasts',async()=>{
 const now=new Date().toISOString(),startsAt=new Date(Date.now()+3600000).toISOString();
 const payload=buildEdgeBoard({now,nflResponse:{league:'NFL',generatedAt:now,markets:[{eventID:'one',startsAt,teamScoringContext:context,modelProbability:.75,marketFairProbability:.75,probabilitySource:'market_only',independentContributionWeight:0}]}});
 assert.equal(payload.rows[0].teamScoringContext,context);assert.equal(payload.rows[0].modelProbability,null);assert.equal(payload.rows[0].decision,'AVOID');
 const app=edgeView(payload);await app.get('refresh').onclick();assert.match(app.get('models').innerHTML,/scores 24\.3\/game/);assert.match(app.get('models').innerHTML,/Market reference only/);
});

test('failed NFL experimental refresh removes previous scoring history with the old forecast',async()=>{
 const app=edgeView({rows:[{teamScoringContext:context,modelProbability:null,marketFairProbability:.75,probabilitySource:'market_only',decision:'AVOID'}]});
 await app.get('refresh').onclick();assert.match(app.get('models').innerHTML,/scores 24\.3\/game/);
 app.fail();await app.get('refresh').onclick();assert.equal(app.get('models').innerHTML,'');assert.match(app.get('status').textContent,/Refresh failed/);
});

test('NFL rendered available and blocked cards both retain scoring history and decision boundaries',async()=>{
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='kind'?'teams':'',textContent:'',innerHTML:'',disabled:false,addEventListener(){},replaceChildren(){this.innerHTML='';}});return nodes.get(id);};
 const startsAt=new Date(Date.now()+3600000).toISOString(),payload={generatedAt:new Date().toISOString(),markets:[{eventID:'one',startsAt,away:'Away',home:'Home',teamScoringContext:context,marketType:'moneyline',modelProbability:.75,marketFairProbability:.75,probabilitySource:'market_only',independentContributionWeight:0}],events:[{eventID:'two',startsAt,available:false,teamScoringContext:context,matchup:{away:{name:'Away'},home:{name:'Home'}},reason:'Starter conflict'}]};
 const script=fs.readFileSync(new URL('../../sharp-service/nfl.html',import.meta.url),'utf8').match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
 const sandbox=vm.createContext({document:{getElementById:get},modelRows,marketLabel,decisionPresentation,decisionTime,deepDiveHtml,preserveDeepDives(){},teamScoringHtml:html,AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async()=>({ok:true,json:async()=>payload})});
 await vm.runInContext(script,sandbox);const cards=get('cards').innerHTML;
 assert.equal((cards.match(/class="team-scoring"/g)||[]).length,2);assert.match(cards,/Starter conflict/);assert.match(cards,/Market prices only/);assert.doesNotMatch(cards,/Model: 75\.0%/);
});
