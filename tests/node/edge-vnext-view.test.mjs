import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildEdgeBoard} from '../../sharp-service/lib/edge-vnext-board.js';

test('legacy probability table labels market-only references and unvalidated blends at the displayed value',async()=>{
 const elements=new Map();
 const get=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
 const now=new Date().toISOString(),startsAt=new Date(Date.now()+3600000).toISOString();
 const data=buildEdgeBoard({now,nflResponse:{league:'NFL',generatedAt:now,markets:[
  {eventID:'market',startsAt,marketType:'moneyline',modelProbability:.75,marketFairProbability:.75,probabilitySource:'market_only',independentContributionWeight:0},
  {eventID:'blend',startsAt,marketType:'total',modelProbability:.55,marketFairProbability:.5,probabilitySource:'market_blend',independentContributionWeight:.125}
 ]}});
 const html=fs.readFileSync(new URL('../../sharp-service/edge-vnext.html',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const context=vm.createContext({document:{getElementById:get},location:{origin:'https://example.test'},URL,fetch:async()=>({ok:true,json:async()=>data})});
 vm.runInContext(script,context);
 await get('refresh').onclick();
 assert.match(get('models').innerHTML,/Market reference only/);
 assert.match(get('models').innerHTML,/Market \+ model blend/);
 assert.match(get('models').innerHTML,/12.5% independent model contribution/);
 assert.match(get('models').innerHTML,/75.0%/);
 assert.doesNotMatch(get('models').innerHTML,/>75.0%<div/);
});
