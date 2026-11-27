import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deepDiveHtml,preserveDeepDives,selectionKey,recordedDecisionPresentation} from '../../sharp-service/deep-dive.js';
test('expanded disclosure and keyboard focus survive a rerender',async()=>{
 const row={eventID:'refresh',playerID:'p',marketType:'points',side:'over',line:20.5},key=selectionKey(row);
 let focused=false;
 const element={open:true,dataset:{deepDive:key},querySelector:()=>({focus(){focused=true;}})};
 const active={closest:()=>element};const root={querySelectorAll:()=>[element],contains:()=>true};
 globalThis.document={activeElement:active};
 try{preserveDeepDives(root);assert.match(deepDiveHtml(row),/ open>/);await Promise.resolve();assert.equal(focused,true);element.open=false;preserveDeepDives(root);assert.doesNotMatch(deepDiveHtml(row),/ open>/);}finally{delete globalThis.document;}
});
test('dashboard explanation follows the same recorded-decision prerequisite as its badge',()=>{
 assert.match(recordedDecisionPresentation({status:'PLAY'}).title,/NOT CLEARED/);
 assert.match(recordedDecisionPresentation({status:'PLAY',tracking:{tracked:true,issuedAt:new Date(Date.now()-1000).toISOString()}}).title,/PLAY — recorded/);
 assert.match(recordedDecisionPresentation({model_decision:'PASS'}).title,/PASS/);
});
test('disclosure summary matches current and legacy decision presentation labels',()=>{
 for(const label of ['BUY','AVOID','PLAY','PASS'])assert.match(deepDiveHtml({}, {presentation:{title:label+' — recorded decision'}}),new RegExp('<summary>Why '+label+'\\?'));
 assert.match(deepDiveHtml({status:'PLAY'}),/<summary>Why not cleared\?/);
 assert.match(deepDiveHtml({}, {presentation:{title:'HISTORICAL — not current'}}),/<summary>Why not cleared\?/);
});
test('every targeted renderer imports the shared disclosure and inline modules parse',()=>{
 for(const path of ['decision-display.js','nba-live-view.js','nba.html','nfl.html','research.js','dashboard.html']){
  const source=readFileSync(new URL('../../sharp-service/'+path,import.meta.url),'utf8');
  assert.match(source,/^\s*import\b[^;\n]*\bfrom\s+['"]\.\/deep-dive\.js['"]/m,path+' must actually import the disclosure renderer');
  if(path.endsWith('.html'))for(const match of source.matchAll(/<script type="module">([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(match[1].replace(/^import .*;$/gm,'')));
 }
 const controller=readFileSync(new URL('../../sharp-service/nba-live.js',import.meta.url),'utf8');
 assert.match(controller,/import\(['"]\.\/nba-live-view\.js['"]\)/);
});

test('NBA page does not override reviewed live decisions with a blanket PASS claim',()=>{
 const html=readFileSync(new URL('../../sharp-service/nba.html',import.meta.url),'utf8');
 const live=readFileSync(new URL('../../sharp-service/nba-live-view.js',import.meta.url),'utf8');
 const nav=readFileSync(new URL('../../sharp-service/edge-navigation.js',import.meta.url),'utf8');
 assert.doesNotMatch(html,/Every priced NBA market currently says|There are no cleared NBA plays/);
 assert.match(html,/data-nba-live-mount/);assert.match(html,/src="\/nba-live.js"/);
 assert.match(live,/BUY requires current approval/);assert.match(live,/Expired or unverified decisions do not clear a play/);
 assert.match(html,/src="\/edge-navigation\.js"/);
 assert.match(nav,/\[['"]Overview['"],\s*['"]\/dashboard['"]\]/);
});

test('direct quote source is shown without inventing a failed health check',()=>{
 const html=readFileSync(new URL('../../sharp-service/nba.html',import.meta.url),'utf8');
 assert.match(html,/data.oddsProvider\|\|data.source/);
 assert.match(html,/Health not supplied/);
 assert.doesNotMatch(html,/renderTeam\(\{events:\[\],markets:\[\]\}\)/);
});
