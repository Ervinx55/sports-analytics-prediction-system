import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {createPerformanceController} from '../../sharp-service/performance-view.js';
import {summarizePerformance} from '../../supabase/functions/_shared/performance-metrics.mjs';

const html = readFileSync("sharp-service/dashboard.html", "utf8");

test('Results filter events clear prior success for missing/reversed dates and reject pending results',async()=>{
  const listeners={},root={innerHTML:'',addEventListener(){}};
  const elements=Object.fromEntries(['sport','cohort','kind','market','modelVersion','from','to'].map(name=>[name,{value:''}]));
  const form={elements,reportValidity:()=>!!elements.from.value&&!!elements.to.value,addEventListener:(name,handler)=>listeners[name]=handler};
  const document={getElementById:id=>id==='performanceFilters'?form:root};
  const pending=[],signals=[];
  const makeController=options=>createPerformanceController({...options,fetchImpl:(_url,{signal})=>{signals.push(signal);return new Promise(resolve=>pending.push(resolve));}});
  const FormData=class {constructor(){return Object.entries(elements).map(([name,{value}])=>[name,value]);}};
  const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import[^\n]*\n/,'');
  new Function('document','location','FormData','createPerformanceController',source)(document,{search:'?sport=NFL',hash:''},FormData,makeController);
  const data=summarizePerformance([],{filters:{sport:'NFL',cohort:'ALL'}});data.coverage.sports=[{sport:'NFL',samples:0}];
  pending[0]({ok:true,json:async()=>data});await new Promise(resolve=>setImmediate(resolve));assert.match(root.innerHTML,/NFL/);
  elements.from.value='';listeners.change();
  assert.doesNotMatch(root.innerHTML,/NFL/);assert.match(root.innerHTML,/Invalid filters/);assert.equal(pending.length,1);
  elements.sport.value='NBA';listeners.change();
  assert.doesNotMatch(root.innerHTML,/NFL/);assert.match(root.innerHTML,/Invalid filters/);assert.equal(pending.length,1);
  elements.from.value='2026-10-08';elements.to.value='2026-10-07';elements.cohort.value='PLAY';listeners.change();assert.match(root.innerHTML,/Invalid filters/);assert.equal(pending.length,1);
  elements.from.value='2026-10-01';listeners.change();assert.equal(pending.length,2);assert.match(root.innerHTML,/Loading/);
  elements.to.value='';listeners.change();assert.equal(signals[1].aborted,true);
  elements.cohort.value='SHADOW';listeners.change();pending[1]({ok:true,json:async()=>data});await new Promise(resolve=>setImmediate(resolve));assert.match(root.innerHTML,/Invalid filters/);assert.doesNotMatch(root.innerHTML,/NFL/);assert.equal(pending.length,2);
});

test("dashboard inline script parses", () => {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "dashboard script block must exist");
  assert.doesNotThrow(() => new Function(match[1]));
});

test('failed legacy results hide diagnostic counts instead of displaying empty success',()=>{
  const source=html.slice(html.indexOf('  function renderDecisionResults('),html.indexOf('  function renderCalibration('));
  const nodes=Object.fromEntries(['legacyResultsContent','legacyResultsStatus','rOverallPlay'].map(id=>[id,{hidden:false,textContent:'previous success'}]));
  const render=new Function('$','renderTeamResultRows','renderPropResultRows','renderCombinedPlayRows',source+';return renderDecisionResults;')(id=>nodes[id]??(nodes[id]={}),()=>'',()=>'',()=>'');
  for(const input of [{},{error:'unavailable'},{summary:{},error:'provider failed'}]){render(input);assert.equal(nodes.legacyResultsContent.hidden,true);assert.match(nodes.legacyResultsStatus.textContent,/unavailable; coverage unknown/);assert.equal(nodes.rOverallPlay.textContent,'previous success');}
  nodes.legacyResultsContent.hidden=false;
  render({summary:{team:{},props:{}}},{ok:false,error:'upstream'});
  assert.equal(nodes.legacyResultsContent.hidden,true,'API fabricated empty fallback must stay hidden when source health failed');
});

test("provider health observability is wired into the dashboard", () => {
  for (const id of [
    "providerHealthBadge",
    "phUpstream",
    "ph429",
    "phShared",
    "phStale",
    "phCache",
    "phObjects",
    "providerHealthDetail",
    "providerIncidentList",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  assert.match(
    html,
    /renderProviderHealth\([\s\S]*data\.providerHealth\|\|\{\}[\s\S]*data\.providerUsage\|\|null[\s\S]*\)/
  );
});


test("freshness grades are visible on team markets and player props", () => {
  assert.match(html, /function freshnessPanel\(row\)/);
  assert.match(html, /FRESHNESS/);
  assert.match(html, /Prop market/);
  assert.match(html, /Lineup\/role/);
  assert.match(html, /freshnessPanel\(m\)/);
  assert.match(html, /freshnessPanel\(p\)/);
});


test("TensorFlow shadow probability is visible without production influence", () => {
  assert.match(html, /function tensorflowShadowPanel\(p\)/);
  assert.match(html, /TF SHADOW/);
  assert.match(html, /production weight/);
  assert.match(html, /SHADOW ONLY/);
  assert.match(html, /tensorflowShadowPanel\(p\)/);
});
