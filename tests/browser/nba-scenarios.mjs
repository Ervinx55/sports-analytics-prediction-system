import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {buildNbaJointScenarios} from '../../sharp-service/lib/nba-joint-scenarios.js';

const require=createRequire(process.env.EDGE_LAB_BROWSER_PACKAGE||import.meta.url);
const {chromium}=require('playwright');
const root=resolve('sharp-service'),origin='http://127.0.0.1:8792';
const asOf='2026-11-28T15:00:00.000Z';
const target={eventID:'sgo:fixture',playerID:'JADEN_MCDANIELS_1_NBA',playerName:'Jaden McDaniels',
  teamId:'MINNESOTA_TIMBERWOLVES_NBA',opponentTeamId:'MEMPHIS_GRIZZLIES_NBA',startsAt:'2026-11-29T01:00:00Z'};
const rows=[10,20,30,40].map((points,i)=>({gameId:'game'+i,playerId:target.playerID,teamId:target.teamId,
  startsAt:`2026-11-${20+i}T00:00:00Z`,observedAt:'2026-11-27T00:00:00Z',minutes:30,points,rebounds:5,assists:4}));
let browser,releaseCatalog,releaseAnalysis,holdCatalog=true,holdAnalysis=false;
const errors=[],requests=[];
try{
  browser=await chromium.launch({headless:true,...(process.env.EDGE_LAB_CHROMIUM?{executablePath:process.env.EDGE_LAB_CHROMIUM}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    assert.equal(url.origin,origin,'Unexpected external request');
    if(url.pathname==='/api/edge-vnext'){
      requests.push(Object.fromEntries(url.searchParams));
      assert.equal(url.searchParams.get('mode'),'nba-prop-scenarios');
      if(!url.searchParams.has('eventId')){
        if(holdCatalog)await new Promise(resolve=>{releaseCatalog=resolve;});
        return route.fulfill({contentType:'application/json',body:JSON.stringify({status:'AVAILABLE',targets:[target]})});
      }
      if(holdAnalysis)await new Promise(resolve=>{releaseAnalysis=resolve;});
      const report=buildNbaJointScenarios({rows,target,asOf,market:url.searchParams.get('market'),
        thresholds:url.searchParams.get('thresholds').split(',').map(x=>({threshold:Number(x),direction:url.searchParams.get('direction')})),
        minutesScenarios:(url.searchParams.get('minutes')||'').split(',').filter(Boolean).map(Number)});
      return route.fulfill({contentType:'application/json',body:JSON.stringify(report)});
    }
    const path=resolve(root,'.'+(url.pathname==='/edge-vnext'?'/edge-vnext.html':url.pathname));
    assert.ok(path.startsWith(root+sep));
    try{return route.fulfill({body:await readFile(path),contentType:extname(path)==='.js'?'application/javascript':extname(path)==='.css'?'text/css':'text/html'});}
    catch{return route.fulfill({status:404,body:''});}
  });
  await page.goto(origin+'/edge-vnext#nba-prop-scenarios');
  assert.equal(requests.length,0,'Page must not automatically fetch model or provider data');
  await page.getByRole('button',{name:'Load upcoming NBA players'}).click();
  await page.waitForFunction(()=>document.querySelector('#scenarioStatus').textContent.startsWith('Loading'));
  await page.locator('#scenarioThresholds').fill('15,20,25');
  // A statistical-input edit must not invalidate the independent roster request.
  assert.ok(await page.locator('#scenarioStatus').textContent().then(x=>x.startsWith('Loading')));
  holdCatalog=false;releaseCatalog();
  await page.waitForFunction(()=>!document.querySelector('#scenarioPlayer').disabled);
  assert.ok((await page.locator('#scenarioPlayer option').textContent()).includes('Jaden McDaniels'));
  await page.locator('#scenarioMarket').selectOption('points_assists');
  await page.locator('#scenarioMinutes').fill('24,36');
  await page.getByRole('button',{name:'Analyze exact thresholds'}).click();
  await page.waitForFunction(()=>document.querySelector('#scenarioStatus').textContent.includes('Analysis complete'));
  assert.equal(await page.locator('#scenarioOutput .scenario-result').count(),3);
  assert.ok((await page.locator('#scenarioOutput').textContent()).includes('4 distinct recorded games'));
  assert.ok((await page.locator('#scenarioOutput').textContent()).includes('75.0%'));
  assert.ok((await page.locator('#scenarioOutput').textContent()).includes('24 minutes assumed'));
  assert.equal(requests.at(-1).market,'points_assists');
  assert.equal(requests.at(-1).thresholds,'15,20,25');
  const screenshotDirectory=process.env.EDGE_LAB_SCENARIO_SCREENSHOTS;
  if(screenshotDirectory)await mkdir(screenshotDirectory,{recursive:true});
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:900});
    await page.locator('#nba-prop-scenarios').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal page overflow');
    if(screenshotDirectory)await page.locator('#nba-prop-scenarios').screenshot({path:resolve(screenshotDirectory,`nba-scenarios-${width}.png`)});
  }
  // Editing assumptions during a request invalidates only its analysis result.
  holdAnalysis=true;await page.getByRole('button',{name:'Analyze exact thresholds'}).click();
  await page.waitForFunction(()=>document.querySelector('#scenarioStatus').textContent.startsWith('Checking'));
  await page.locator('#scenarioThresholds').fill('10');
  holdAnalysis=false;releaseAnalysis();
  await page.waitForTimeout(50);
  assert.equal(await page.locator('#scenarioOutput').textContent(),'');
  assert.ok((await page.locator('#scenarioStatus').textContent()).includes('Inputs changed'));
  assert.deepEqual(errors,[]);
  console.log('NBA scenario browser checks passed: exact requests, paired outputs, load/input races, mobile/desktop layout, no automatic data refresh.');
}finally{await browser?.close();}
