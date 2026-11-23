import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../sharp-service/api/dashboard.js';
import {currentDecisionCard,rankByWinProbability} from '../../sharp-service/current-card.js';

const invoke=async(sport='NBA')=>{let body,status;await handler({method:'GET',query:{sport,view:'plays'}},{setHeader(){},status(n){status=n;return this;},json(value){body=value;return this;}});return {body,status};};
const row=(id,overrides={})=>({id,sport:'MLB',event_id:id,market_label:id,status:'PLAY',starts_at:new Date(Date.now()+3600000).toISOString(),captured_at:new Date(Date.now()-60000).toISOString(),model_probability:.7,ev_pct:5,...overrides});

test('NBA dashboard cannot present the MLB-only prop card or its results as NBA',async()=>{
 const original=globalThis.fetch,seen=[];
 globalThis.fetch=async input=>{const path=new URL(input).pathname.split('/').pop();seen.push(path);return Response.json(path==='player-prop-card'?{version:'MLB Player Props Card v2',plays:[row('mlb-prop')],recentResults:[{id:1}]}:{});};
 try{const {body,status}=await invoke();assert.equal(status,200);assert.ok(!seen.includes('player-prop-card'));assert.deepEqual(body.playerProps.plays,[]);assert.deepEqual(body.playerProps.recentResults,[]);assert.equal(body.playerProps.availability,'USE_SPORT_RESEARCH');assert.equal(body.playerProps.researchUrl,'/nba.html');}finally{globalThis.fetch=original;}
});

test('disabled or missing-probability PLAY rows cannot retain a BUY label in the market list',()=>{
 const rows=[row('disabled',{productionEligible:false}),row('missing-model',{model_probability:null}),row('old',{captured_at:new Date(Date.now()-7200000).toISOString()})];
 const result=currentDecisionCard({sport:'MLB',markets:rows},{sport:'MLB'});
 assert.deepEqual(result.plays,[]);assert.ok(result.markets.every(r=>r.status==='PASS'));assert.ok(result.markets.every(r=>r.recordedStatus==='PLAY'));
 assert.ok(rows.every(r=>r.status==='PLAY'));
});

test('likelihood ordering never uses value or null-coerced probability as a substitute and does not mutate input',()=>{
 const rows=[row('missing',{model_probability:null,ev_pct:900}),row('likely',{model_probability:.8,ev_pct:1}),row('value',{model_probability:.6,ev_pct:50})];
 assert.deepEqual(rankByWinProbability(rows).map(r=>r.id),['likely','value','missing']);assert.deepEqual(rows.map(r=>r.id),['missing','likely','value']);
});

test('malformed success bodies and malformed rows remain unavailable',()=>{
 for(const card of [{error:'Unavailable'}, {}, {markets:[null]}, {markets:[[]]}, {markets:'bad'}]){
  const result=currentDecisionCard(card,{sport:'MLB'});assert.equal(result.availability,'UNAVAILABLE');assert.equal(result.summary.play,null);
 }
});

test('card-level production disablement applies to every recorded selection',()=>{
 const result=currentDecisionCard({sport:'MLB',productionEligible:false,productionWeight:0,markets:[row('disabled-card')]},{sport:'MLB'});
 assert.equal(result.plays.length,0);assert.equal(result.markets[0].status,'PASS');
});

test('an HTTP 200 error card makes the dashboard data state unavailable',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async input=>Response.json(new URL(input).pathname.endsWith('/market-card')?{error:'Unavailable'}:{});
 try{const {body}=await invoke('MLB');assert.equal(body.summary.dataMode,'DATA_UNAVAILABLE');assert.equal(body.system.sourceHealth.marketCard.ok,false);}finally{globalThis.fetch=original;}
});

test('a failed card is DATA_UNAVAILABLE rather than a verified empty zero-play slate',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async input=>{const path=new URL(input).pathname.split('/').pop();return Response.json({}, {status:['market-card','latest-model-audit'].includes(path)?503:200});};
 try{const {body}=await invoke('MLB');assert.equal(body.summary.dataMode,'DATA_UNAVAILABLE');assert.equal(body.marketCard.availability,'UNAVAILABLE');assert.equal(body.summary.finalPlays,null);assert.match(body.marketCard.reason,/unavailable/i);}finally{globalThis.fetch=original;}
});

test('ranked current plays prefer win likelihood and exclude expired, future-captured and wrong-sport rows',async()=>{
 const original=globalThis.fetch;
 const rows=[row('high-ev',{model_probability:.55,ev_pct:30}),row('likely',{model_probability:.82,ev_pct:2}),row('started',{starts_at:new Date(Date.now()-60000).toISOString()}),row('wrong-sport',{sport:'NBA'}),row('future-capture',{captured_at:new Date(Date.now()+60000).toISOString()}),row('missing-start',{starts_at:null})];
 globalThis.fetch=async input=>{const path=new URL(input).pathname.split('/').pop();return Response.json(path==='market-card'?{sport:'MLB',markets:rows,plays:rows,summary:{play:rows.length,markets:rows.length}}:{});};
 try{const {body}=await invoke('MLB');assert.deepEqual(body.marketCard.plays.map(r=>r.id),['likely','high-ev']);assert.equal(body.summary.finalPlays,2);assert.equal(body.marketCard.rankingBasis,'MODEL_WIN_PROBABILITY');assert.equal(body.marketCard.excludedFromCurrent,4);}finally{globalThis.fetch=original;}
});
