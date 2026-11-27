import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const require=createRequire(process.env.EDGE_LAB_BROWSER_PACKAGE||import.meta.url);
const {chromium}=require('playwright');
const root=resolve('sharp-service'),origin='http://127.0.0.1:8791';
const now=Date.now(),stamp=new Date(now).toISOString(),startsAt=new Date(now+3600000).toISOString();
const priorAt=new Date(now-86400000).toISOString();
const literal='Fixture <img data-scoring-injection src=x onerror="window.__scoringInjection=true"> & <b>literal</b>';
const homeName='Home <b>literal</b>',awayName='Away & visitors';
const window=(key,label,pointsFor,pointsAgainst,gameCount,requestedGames=null)=>({
 key,label,pointsFor,pointsAgainst,gameCount,requestedGames,
 gameIds:Array.from({length:gameCount},(_,i)=>'game-'+i),latestGameAt:gameCount?priorAt:null,
 missingReason:gameCount?null:'No verified prior completed games.'
});
function scoring(sport,{sparse=false}={}){
 const homeWindows=sparse?[window('history','Available history',0,7,1),window('last5','Last 5 games',0,7,1,5),window('last10','Last 10 games',0,7,1,10)]:[
  window('history','Available history',111.25,104.5,12),window('last5','Last 5 games',112.2,103.8,5,5),window('last10','Last 10 games',110.7,104.2,10,10)
 ];
 const awayWindows=sparse?[window('history','Available history',null,null,0),window('last5','Last 5 games',null,null,0,5),window('last10','Last 10 games',null,null,0,10)]:[
  window('history','Available history',108.5,110.25,8),window('last5','Last 5 games',106.4,112,5,5),window('last10','Last 10 games',108.5,110.25,8,10)
 ];
 return {contract:'team-scoring-context-v1',purpose:'EXPLANATION_ONLY',adjustmentApplied:false,sport,cutoffAt:stamp,
  source:literal,observedAt:stamp,scope:'Verified completed games before the forecast cutoff; descriptive context only.',
  home:{teamId:'HOME',teamName:homeName,windows:homeWindows},away:{teamId:'AWAY',teamName:awayName,windows:awayWindows}};
}
const nbaRow={eventId:'nba-fixture',home:'HOME',away:'AWAY',startsAt,homeWinProbability:.625,awayWinProbability:.375,
 projectedHomeMargin:3.8,reasons:['EXPERIMENTAL_NOT_VALIDATED'],productionEligible:false,productionWeight:0,teamScoringContext:scoring('NBA')};
const nba={status:'EXPERIMENTAL',reason:'No production BUY enabled',scoreboardCoverage:{daysAvailable:21,daysRequested:21},
 backtest:{status:'RESEARCH',evaluatedGames:100,brier:.2,ece:.04},rows:[nbaRow,{...nbaRow,eventId:'nba-zero',home:'Zero sample',away:'Missing sample',teamScoringContext:scoring('NBA',{sparse:true})}],
 rankings:{winners:[{team:'HOME',probability:.625}],value:[]},evaluationSummary:{games:2,matchedGames:0,gamesWithSharpPairs:0,pricedSides:0,reasonCounts:{}}};
const nflMarket={eventID:'nfl-fixture',startsAt,home:'HOME',away:'AWAY',matchup:'AWAY @ HOME',marketType:'moneyline',label:'HOME',line:null,
 probabilitySource:'market_only',independentContributionWeight:0,modelProbability:.625,marketFairProbability:.625,
 edgePercentagePoints:0,decision:'PASS',status:'SHADOW',productionEligible:false,productionWeight:0,
 note:'Market reference only; no independent influence.',reason:'Production influence has not been earned.',teamScoringContext:scoring('NFL')};
const nfl={generatedAt:stamp,oddsProvider:'Fixture source',productionEligible:false,
 markets:[{...nflMarket,teamScoringContext:undefined}],events:[
  {eventID:nflMarket.eventID,teamScoringContext:scoring('NFL')},
  {eventID:'nfl-blocked',startsAt,available:false,matchup:{home:{name:'Blocked home'},away:{name:'Blocked away'}},
   reason:'Conflicting starter evidence.',teamScoringContext:scoring('NFL',{sparse:true})}
 ]};
const board={generatedAt:stamp,sports:{NFL:{state:'SHADOW'}},rows:[{...nflMarket,eventId:nflMarket.eventID,modelProbability:null,edgePercentagePoints:null,decision:'AVOID'}]};
const cfbForecast={eventID:'college-game',homeID:'HOME',awayID:'AWAY',homeName,awayName,startsAt,homeProbability:.625,awayProbability:.375,
 period:'game',marketType:'moneyline',modelVersion:'cfb-fixture',inputCutoff:stamp,generatedAt:stamp,homeRating:1550,awayRating:1500,homeAdvantage:35,
 neutralSite:false,homeCount:12,awayCount:8,latestResultAt:priorAt,productionEligible:false,teamScoringContext:scoring('NCAAF')};
const cfb={contract:'cfb-research-v1',status:'RESEARCH_NOT_CLEARED',generatedAt:stamp,modelVersion:'cfb-fixture',
 evaluation:{holdout:{n:558,brier:.21,accuracy:.668}},forecasts:[cfbForecast]};
const games={fetchedAt:stamp,source:'SportsGameOdds',providerObservations:[{league:'NCAAF',provider:'SportsGameOdds',fetchedAt:stamp}],events:[{
 eventID:'college-game',league:'NCAAF',startsAt,status:{},matchup:{home:{id:'HOME',name:homeName},away:{id:'AWAY',name:awayName}},
 markets:{moneyline:Object.fromEntries(['home','away'].map(side=>[side,{oddID:`points-${side}-game-ml-${side}`,books:{pinnacle:{odds:-110,line:null,available:true,updatedAt:stamp}}}]))}
 }]};

let browser;
const errors=[],unexpectedRequests=[];
try{
 browser=await chromium.launch({headless:true,...(process.env.EDGE_LAB_CHROMIUM?{executablePath:process.env.EDGE_LAB_CHROMIUM}:{})});
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 // Every page request is fulfilled from this worktree or the bounded fixtures below.
 // Unknown API paths and external requests fail closed; no provider quota is used.
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin){unexpectedRequests.push(url.href);return route.abort();}
  if(url.pathname.startsWith('/api/')){
   let data;
   if(url.pathname==='/api/edge-vnext')data=url.searchParams.get('mode')==='nba'?nba:url.searchParams.get('mode')==='board'?board:null;
   else if(url.pathname==='/api/nflmodel')data=nfl;
   else if(url.pathname==='/api/dashboard'&&url.searchParams.get('cfb')==='1')data=cfb;
   else if(url.pathname==='/api/board'){
    assert.equal(url.searchParams.get('leagues'),'NCAAF');data=games;
   }
   if(!data){unexpectedRequests.push(url.href);return route.fulfill({status:500,json:{error:'Unexpected fixture endpoint'}});}
   return route.fulfill({json:data});
  }
  const pathname=url.pathname==='/edge-vnext'?'/edge-vnext.html':url.pathname;
  const file=resolve(root,'.'+pathname);
  if(!file.startsWith(root+sep)){unexpectedRequests.push(url.href);return route.fulfill({status:404});}
  try{return await route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]||'text/plain',body:await readFile(file)});}
  catch{unexpectedRequests.push(url.href);return route.fulfill({status:404});}
 });
 async function noOverflow(label){
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' page overflow');
 }
 async function screenshot(name){
  if(!process.env.EDGE_LAB_SCREENSHOT_DIR)return;
  const directory=resolve(process.env.EDGE_LAB_SCREENSHOT_DIR);await mkdir(directory,{recursive:true});
  await page.screenshot({path:resolve(directory,name+'.png'),fullPage:true});
 }
 async function checkScoring(block,{sparse=false}={}){
  await block.waitFor();
  const box=await block.boundingBox();
  assert.ok(box&&box.width>=220,'Historical scoring needs a readable width; actual '+box?.width+'px');
  assert.ok(box.x>=0&&box.x+box.width<=page.viewportSize().width,
   'Scoring context must fit the viewport without horizontal scrolling: '+JSON.stringify(box));
  const summary=await block.locator('.team-scoring-summary').innerText();
  assert.ok(summary.includes(homeName));assert.ok(summary.includes(awayName));
  if(sparse){assert.match(summary,/0\.0/);assert.match(summary,/7\.0/);assert.match(summary,/Unavailable/i);}
  else for(const value of ['111.3','104.5','108.5','110.3'])assert.ok(summary.includes(value),'Missing average '+value);
  const detail=block.locator('details');
  if(await detail.getAttribute('open')===null)await detail.locator('summary').click();
  const expanded=await block.boundingBox();
  assert.ok(expanded.x>=0&&expanded.x+expanded.width<=page.viewportSize().width,
   'Expanded scoring context must remain fully visible: '+JSON.stringify(expanded));
  const all=await block.innerText();
  assert.ok(all.includes(literal),'Source markup must remain literal text');
  assert.match(all,/Last 5/i);assert.match(all,/Last 10/i);
  assert.match(all,/cutoff/i);
  if(sparse)assert.match(all,/No verified prior completed games/);
  else{
   for(const value of ['112.2','103.8','110.7','104.2','106.4'])assert.ok(all.includes(value),'Missing recent average '+value);
   assert.match(all,/12 games/);assert.match(all,/8 games/);
   assert.match(all,/5 of 5 games/);assert.match(all,/8 of 10 games/);
  }
  assert.equal(await block.locator('img,b').count(),0,'Context values must not create HTML elements');
  assert.equal(await page.evaluate(()=>window.__scoringInjection===true),false);
 }
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});
  await page.goto(origin+'/edge-vnext');
  await page.getByRole('button',{name:'Refresh NBA model and prices'}).click();
  await checkScoring(page.locator('#nbaRows .team-scoring').nth(0));
  await checkScoring(page.locator('#nbaRows .team-scoring').nth(1),{sparse:true});
  const nbaCells=await page.locator('#nbaRows tr').first().locator('td').allTextContents();
  assert.ok(nbaCells.includes('62.5%'));assert.ok(nbaCells.includes('37.5%'));assert.ok(nbaCells.includes('3.8 points'));
  assert.match(await page.locator('#nbaStatus').innerText(),/No production BUY enabled/);
  await page.getByRole('button',{name:'Refresh NFL model (manual)'}).click();
  await checkScoring(page.locator('#models .team-scoring').first());
  assert.match(await page.locator('#models').innerText(),/62\.5%/);
  assert.match(await page.locator('#models').innerText(),/Market reference only/);
  assert.match(await page.locator('#models').innerText(),/AVOID \(shadow\)/);
  assert.match(await page.locator('#models tr').first().locator('td').nth(1).innerText(),/^—/);
  await noOverflow('Probability Lab '+width);
  await screenshot('probability-lab-'+width);

  await page.goto(origin+'/nfl.html');
  const nflCard=page.locator('#cards article').first();
  await checkScoring(nflCard.locator('.team-scoring'));
  const stats=await nflCard.locator('.stats').innerText();
  assert.match(stats,/Independent forecast\s+Unavailable/);
  assert.match(stats,/Market-implied chance \(no vig\)\s+62\.5%/);
  assert.match(await nflCard.innerText(),/SHADOW/);assert.match(await nflCard.innerText(),/NOT CLEARED/);
  assert.match(await nflCard.innerText(),/independent model contribution is 0%/);
  const blockedCard=page.locator('#cards article').nth(1);
  await checkScoring(blockedCard.locator('.team-scoring'),{sparse:true});
  assert.match(await blockedCard.innerText(),/FORECAST UNAVAILABLE/);
  assert.match(await blockedCard.innerText(),/Conflicting starter evidence/);
  assert.equal(await blockedCard.locator('.stats').count(),0,'Context cannot restore a blocked forecast');
  await noOverflow('NFL '+width);
  await screenshot('nfl-'+width);

  await page.goto(origin+'/research.html?sport=NCAAF&kind=games');
  const cfbCard=page.locator('#cfb-summary article').first();
  await checkScoring(cfbCard.locator('.team-scoring'));
  assert.ok((await cfbCard.innerText()).includes(homeName+': 62.5%'));
  assert.ok((await cfbCard.innerText()).includes(awayName+': 37.5%'));
  assert.match(await cfbCard.innerText(),/NOT CLEARED/);
  await noOverflow('CFB '+width);
  await screenshot('cfb-'+width);
  const researchMarket=page.locator('#cards > .research-market').first();
  await researchMarket.locator(':scope > summary').click();
  await researchMarket.locator('.target-research-details > summary').first().click();
  await page.locator('#cards').getByRole('button',{name:'Why isn’t this cleared?'}).first().click();
  await checkScoring(page.locator('#detail-body .team-scoring'));
  assert.match(await page.locator('#detail-body').innerText(),/NOT CLEARED/);
  assert.ok(await page.locator('#detail').evaluate(element=>element.scrollWidth<=element.clientWidth),'CFB detail overflow '+width);
  await noOverflow('CFB detail '+width);
  await screenshot('cfb-detail-'+width);
  await page.getByRole('button',{name:'Close quote details'}).click();
 }

 // Missing context changes the explanation only; market and model values remain fixed.
 delete nba.rows[0].teamScoringContext;
 await page.goto(origin+'/edge-vnext');
 await page.getByRole('button',{name:'Refresh NBA model and prices'}).click();
 const missing=page.locator('#nbaRows tr').first();
 await page.locator('#nbaRows .team-scoring').first().waitFor();
 assert.match(await page.locator('#nbaRows .team-scoring').first().innerText(),/Unavailable/i);
 assert.match(await missing.innerText(),/62\.5%/);assert.match(await missing.innerText(),/37\.5%/);
 assert.match(await missing.innerText(),/EXPERIMENTAL_NOT_VALIDATED/);
 assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
 console.log('PASS: team scoring on NBA/NFL Probability Lab, NFL cards and CFB cards/details at desktop and 390px; PF/PA, recent samples, zero versus missing, escaped literals, no overflow, unchanged probabilities and research-only states. All requests mocked.');
}finally{await browser?.close();}
