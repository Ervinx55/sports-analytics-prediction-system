import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function view(payload){
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',disabled:false});return nodes.get(id);};
 const script=fs.readFileSync(new URL('../../sharp-service/edge-vnext.html',import.meta.url),'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
 let request;
 vm.runInNewContext(script,{document:{getElementById:get},URL,location:{origin:'https://example.test'},fetch:async u=>{request=u;return {ok:true,json:async()=>payload};}});
 return {get,refresh:()=>get('refreshNba').onclick(),request:()=>request};
}
test('NBA refresh requests market evidence and displays separate winner and price rankings',async()=>{
 const app=view({status:'RESEARCH_SHADOW',rows:[],evaluationSummary:{games:1,matchedGames:1,gamesWithSharpPairs:1,pricedSides:2,reasonCounts:{UNCALIBRATED:1}},rankings:{winners:[{team:'NY',probability:.7,status:'RESEARCH_ONLY'}],value:[{selection:'WSH',odds:200,book:'draftkings',modelProbability:.3,marketFairProbability:.25,modelExpectedReturn:-.1,status:'RESEARCH_ONLY'}]}});
 await app.refresh();assert.equal(app.request().searchParams.get('quotes'),'1');
 assert.match(app.get('nbaWinners').textContent,/NY/);assert.match(app.get('nbaValueRows').innerHTML,/WSH/);
 assert.match(app.get('nbaCoverage').textContent,/1\/1/);assert.match(app.get('nbaCoverage').textContent,/UNCALIBRATED/);
});
test('provider text in research rankings cannot inject markup',async()=>{
 const app=view({rows:[],rankings:{winners:[],value:[{selection:'<img src=x onerror=alert(1)>',book:'<script>',odds:120,modelExpectedReturn:.03}]}});
 await app.refresh();assert.ok(!app.get('nbaValueRows').innerHTML.includes('<img'));assert.match(app.get('nbaValueRows').innerHTML,/&lt;img/);
});
