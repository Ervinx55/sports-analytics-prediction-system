import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {reviewedDateWindow,reviewedDay} from '../../sharp-service/reviewed-picks-contract.js';

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
const nflReviews={contract:'edge-reviewed-picks-v1',sport:'NFL',generatedAt:stamp,date:reviewedDay(now),
 dateWindow:reviewedDateWindow('NFL',now),timezone:'America/Chicago',picks:[
  {id:'history-nix',playerId:'BO_NIX_1_NFL',playerName:'Bo Nix',marketType:'passing_yards',side:'UNDER',line:214.5},
  {id:'history-warren',playerId:'JAYLEN_WARREN_1_NFL',playerName:'Jaylen Warren',marketType:'receiving_yards',side:'OVER',line:16.5}
 ].map(pick=>({...pick,sport:'NFL',eventId:'reported-history-fixture',startsAt:priorAt,marketScope:'FULL_GAME',
  book:null,odds:null,issuedAt:null,recordedAt:stamp,priceLimit:null,decision:'REPORTED_SELECTION',
  historyOnly:true,reportedDecision:'BUY',sourceLabel:'Reported selection',matchup:'Historical away at Historical home',
  reviewUpdate:{decision:'AVOID',issuedAt:new Date(now-26*3600000).toISOString(),note:'Later review avoided changed terms; original book and price were not recovered.'}
 }))};
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

// A fixed midday clock keeps the NBA reviewed-game fixture inside today's CT
// window even when CI runs near midnight. These are synthetic journal records.
const gameNow=Date.parse(reviewedDay(now)+'T18:00:00Z'),gameStamp=new Date(gameNow).toISOString(),gameStart=new Date(gameNow+3600000).toISOString();
const reviewedGame={id:'102752',sport:'NBA',eventId:'sgo:denver-games-fixture',startsAt:gameStart,playerId:null,playerName:null,
 marketType:'spread',marketScope:'FULL_GAME',side:'AWAY',line:-9.5,book:'betmgm',odds:-110,priceLimit:-110,
 decision:'BUY',issuedAt:new Date(gameNow-60000).toISOString(),recordedAt:gameStamp,sourceLabel:'Manual review',
 historyOnly:false,reportedDecision:null,matchup:'Denver Nuggets at Utah Jazz',reviewNote:'Synthetic reviewed-game fixture.'};
const reviewedProp={...reviewedGame,id:'prop-fixture',playerId:'JADEN_MCDANIELS_1_NBA',playerName:'Jaden McDaniels',marketType:'points',side:'OVER',line:19.5};
const gameReviews=(sport,picks=[])=>({contract:'edge-reviewed-picks-v1',sport,generatedAt:gameStamp,date:reviewedDay(gameNow),dateWindow:reviewedDateWindow(sport,gameNow),timezone:'America/Chicago',picks});
const nbaGameReviews=gameReviews('NBA',[reviewedGame,reviewedProp]);
const nflGameReviews=gameReviews('NFL',[
 {...reviewedGame,id:'nfl-game',sport:'NFL',matchup:'Buffalo Bills at Kansas City Chiefs',line:3.5},
 {...reviewedProp,id:'nfl-prop',sport:'NFL',playerId:'BO_NIX_1_NFL',playerName:'Bo Nix',marketType:'passing_yards',line:214.5}
]);
const nbaMatchups=[
 {away:{id:'ATLANTA_HAWKS_NBA',name:'Atlanta Hawks'},home:{id:'BOSTON_CELTICS_NBA',name:'Boston Celtics'}},
 {away:{id:'OKLAHOMA_CITY_THUNDER_NBA',name:'Oklahoma City Thunder'},home:{id:'GOLDEN_STATE_WARRIORS_NBA',name:'Golden State Warriors'}}
];
const gameQuotes=sport=>({fetchedAt:gameStamp,source:'SportsGameOdds',providerObservations:[{league:sport,provider:'SportsGameOdds',fetchedAt:gameStamp}],events:sport==='EPL'?[]:(sport==='NBA'?nbaMatchups:[{away:{id:'BUFFALO_BILLS_NFL',name:'Buffalo Bills'},home:{id:'KANSAS_CITY_CHIEFS_NFL',name:'Kansas City Chiefs'}}]).map((matchup,index)=>({
 eventID:sport+'-games-fixture-'+index,league:sport,startsAt:gameStart,status:{},matchup,
 markets:{moneyline:Object.fromEntries(['home','away'].map(side=>[side,{oddID:`points-${side}-game-ml-${side}`,books:Object.fromEntries(['pinnacle','draftkings'].map(book=>[book,{odds:-110,line:null,available:true,updatedAt:gameStamp}]))}]))}
}))});
const propQuotes={contract:'nba-multibook-research-v1',source:'SportsGameOdds',generatedAt:gameStamp,events:[{
 eventID:'sgo:portrait-fixture',provider:'SportsGameOdds',startsAt:gameStart,matchup:nbaMatchups[0],players:[{
  prop:{playerID:'DERRICK_WHITE_1_NBA',playerName:'Derrick White',statID:'rebounds',over:{books:{draftkings:{line:3.5,odds:123,available:true,updatedAt:gameStamp}}},under:{books:{draftkings:{line:3.5,odds:-145,available:true,updatedAt:gameStamp}}}}
 }]
}]};

let browser;
let testingReviewedGames=false,holdGameQuotes=false,releaseGameQuotes,failedTeamLogo=null;
const errors=[],unexpectedRequests=[],reviewRequests=[];
try{
 browser=await chromium.launch({headless:true,...(process.env.EDGE_LAB_CHROMIUM?{executablePath:process.env.EDGE_LAB_CHROMIUM}:{})});
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 // Every page request is fulfilled from this worktree or the bounded fixtures below.
 // Unknown API paths and external requests fail closed; no provider quota is used.
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin){
   // Known remote NFL logos are the only external image requests in this fixture.
   // Fail them deliberately to exercise the shipped text fallback, without network.
   if(url.origin==='https://a.espncdn.com'&&/^\/i\/teamlogos\/nfl\/(?:500|500-dark)\/[a-z0-9]+\.png$/.test(url.pathname))return route.abort();
   unexpectedRequests.push(url.href);return route.abort();
  }
  if(url.href===failedTeamLogo)return route.fulfill({status:404,body:''});
  if(url.pathname.startsWith('/api/')){
   let data;
   if(url.pathname==='/api/edge-vnext')data=url.searchParams.get('mode')==='nba'?nba:url.searchParams.get('mode')==='board'?board:null;
   else if(url.pathname==='/api/nflmodel')data=nfl;
   else if(testingReviewedGames&&url.pathname==='/api/nbaprops'&&url.searchParams.get('view')==='research')data=propQuotes;
   else if(url.pathname==='/api/dashboard'&&url.searchParams.get('reviewedPicks')==='1'){
    const sport=url.searchParams.get('sport');reviewRequests.push(sport);
    if(testingReviewedGames&&sport==='NBA')data=nbaGameReviews;
    else if(sport==='NFL')data=testingReviewedGames?nflGameReviews:nflReviews;
    else if(sport==='NCAAF')data={contract:'edge-reviewed-picks-v1',sport,generatedAt:stamp,date:reviewedDay(now),dateWindow:reviewedDateWindow(sport,now),timezone:'America/Chicago',picks:[]};
   }
   else if(url.pathname==='/api/dashboard'&&url.searchParams.get('cfb')==='1')data=cfb;
   else if(url.pathname==='/api/board'){
    const sport=url.searchParams.get('leagues');
    if(testingReviewedGames&&['NBA','NFL','EPL'].includes(sport)){
     if(sport==='NBA'&&holdGameQuotes)await new Promise(resolve=>{releaseGameQuotes=resolve;});
     data=gameQuotes(sport);
    }else{assert.equal(sport,'NCAAF');data=games;}
   }
   if(!data){unexpectedRequests.push(url.href);return route.fulfill({status:500,json:{error:'Unexpected fixture endpoint'}});}
   return route.fulfill({json:data});
  }
  const pathname=url.pathname==='/edge-vnext'?'/edge-vnext.html':url.pathname;
  const file=resolve(root,'.'+pathname);
  if(!file.startsWith(root+sep)){unexpectedRequests.push(url.href);return route.fulfill({status:404});}
  try{return await route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]||'text/plain',body:await readFile(file)});}
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
 async function readableGameCard(card,label){
  const layout=await card.evaluate(element=>{
   const identity=element.querySelector('.target-player-identity'),copy=identity.querySelector('.target-player-copy');
   const heading=copy.querySelector('.player-name'),selection=copy.querySelector('.target-card-selection'),book=copy.querySelector('.target-card-book');
   const box=node=>{const {x,y,width,height}=node.getBoundingClientRect();return {x,y,width,height};};
   return {identity:box(identity),copy:box(copy),heading:box(heading),selection:box(selection),book:box(book),
    text:heading.textContent,selectionText:selection.textContent,bookText:book.textContent,
    fonts:{heading:parseFloat(getComputedStyle(heading).fontSize),selection:parseFloat(getComputedStyle(selection).fontSize),book:parseFloat(getComputedStyle(book).fontSize)},
    clipped:[copy,heading,selection,book,...heading.querySelectorAll('.team-name')].some(node=>node.scrollWidth>node.clientWidth+1),
    logos:heading.querySelectorAll('.team-logo-badge').length,portraits:identity.querySelectorAll('.target-player-portrait').length};
  });
  assert.ok(layout.identity.width>=180,label+' must reserve readable card space: '+JSON.stringify(layout));
  assert.ok(layout.copy.width>=layout.identity.width-2,label+' game text must use the full identity width, including without a portrait: '+JSON.stringify(layout));
  for(const key of ['heading','selection','book']){
   assert.ok(layout[key].width>=layout.copy.width-2,label+' '+key+' must not inherit a fixed portrait track');
   assert.ok(layout[key].x>=0&&layout[key].x+layout[key].width<=page.viewportSize().width+1,label+' '+key+' must stay inside the viewport');
  }
  assert.equal(layout.clipped,false,label+' game labels must wrap without clipping');
  assert.equal(layout.logos,2,label+' needs a distinct identity for each team');
  assert.equal(layout.portraits,0,label+' must not borrow a player portrait');
  return layout;
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
  const reviews=page.locator('#reviewed-picks');
  await reviews.locator('[data-reviewed-pick="history-warren"]').waitFor();
  assert.equal(await reviews.locator('[data-reviewed-pick]').count(),2);
  assert.equal(await reviews.locator('.reviewed-active-count').innerText(),'2 saved reviews · 0 upcoming BUYs');
  assert.equal(await reviews.locator('.reviewed-buy').count(),0,'Reported history cannot imply current BUY clearance');
  for(const pick of nflReviews.picks){
   const row=reviews.locator(`[data-reviewed-pick="${pick.id}"]`);
   assert.equal(await row.locator('.player-row-heading').innerText(),pick.playerName);
   assert.match(await row.locator(':scope > summary').innerText(),/Reported prior BUY/);
   assert.match(await row.locator(':scope > summary').innerText(),/Game started/);
   assert.match(await row.locator(':scope > summary').innerText(),/Original book and price unavailable/);
   assert.ok((await row.locator('.player-row-market').innerText()).includes(String(pick.line)));
  }
  const savedReview=reviews.locator('[data-reviewed-pick="history-nix"]');
  await savedReview.locator(':scope > summary').click();
  await savedReview.locator('.target-research-details > summary').click();
  assert.match(await savedReview.innerText(),/Original review time unavailable/);
  assert.match(await savedReview.innerText(),/Later review: AVOID at changed terms/);
  assert.match(await savedReview.innerText(),/Later review avoided changed terms/);
  await reviews.getByRole('button',{name:'Refresh NFL reviewed picks',exact:true}).click();
  await reviews.locator('[data-reviewed-refresh][aria-busy="false"]').waitFor();
  assert.equal(await savedReview.getAttribute('open'),'');
  assert.equal(await savedReview.locator('.target-research-details').getAttribute('open'),'');
  assert.equal(await reviews.locator('.reviewed-active-count').innerText(),'2 saved reviews · 0 upcoming BUYs');
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
  const unknownGame=researchMarket.locator('.quote-option').first();
  await readableGameCard(unknownGame,'Unmapped CFB game '+width);
  assert.deepEqual(await unknownGame.locator('.player-name .team-name').allTextContents(),[awayName,homeName]);
  for(const fallback of await unknownGame.locator('.player-name .team-logo-fallback').all())assert.equal(await fallback.isVisible(),true,'Unmapped teams need a visible fallback alongside their full names');
  assert.equal(await unknownGame.locator('.player-name .team-logo:visible').count(),0,'Unmapped teams cannot borrow another team logo');
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

 // Games exposes the same reviewed journal record, scoped independently from
 // research quotes and player reviews, including during a slow quote refresh.
 testingReviewedGames=true;await page.addInitScript(epoch=>{Date.now=()=>epoch;},gameNow);
 await page.setViewportSize({width:390,height:844});
 await page.goto(origin+'/research.html?kind=games&sport=NBA');
 const gameReviewSection=page.locator('#reviewed-games'),denverReview=gameReviewSection.locator('[data-reviewed-pick="102752"]');
 await denverReview.waitFor();await page.locator('#cards > .research-market').first().waitFor();
 assert.equal(await gameReviewSection.locator('[data-reviewed-pick]').count(),1);
 assert.match(await denverReview.locator(':scope > summary').innerText(),/Denver Nuggets -9\.5 · Full game/);
 assert.match(await denverReview.locator(':scope > summary').innerText(),/BetMGM · Recorded -110/);
 assert.match(await denverReview.locator(':scope > summary').innerText(),/REVIEWED BUY/);
 assert.equal(await gameReviewSection.locator('.reviewed-active-count').innerText(),'1 upcoming BUYs');
 assert.doesNotMatch(await gameReviewSection.innerText(),/Jaden McDaniels/);
 const reviewBox=await gameReviewSection.boundingBox(),quoteBox=await page.locator('#research-board').boundingBox();
 assert.ok(reviewBox.y+reviewBox.height<=quoteBox.y,'reviewed game BUY must be above research quotes');
 await denverReview.locator(':scope > summary').click();
 assert.match(await denverReview.innerText(),/Price limit: -110 or better/);await noOverflow('Reviewed NBA Games 390');
 await screenshot('reviewed-games-390');
 holdGameQuotes=true;await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#refresh').disabled);
 const requestCount=reviewRequests.length;
 await gameReviewSection.getByRole('button',{name:'Refresh NBA reviewed games',exact:true}).click();
 await gameReviewSection.locator('[data-reviewed-refresh][aria-busy="false"]').waitFor();
 assert.ok(reviewRequests.length>requestCount);assert.equal(await gameReviewSection.locator('[data-reviewed-pick]').count(),1);
 assert.equal(await denverReview.getAttribute('open'),'');
 holdGameQuotes=false;assert.equal(typeof releaseGameQuotes,'function');releaseGameQuotes();
 await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
 await page.locator('[data-sport="NFL"]').click();await gameReviewSection.locator('[data-reviewed-pick="nfl-game"]').waitFor();
 assert.equal(await gameReviewSection.locator('[data-reviewed-pick]').count(),1);
 assert.match(await gameReviewSection.innerText(),/Buffalo Bills \+3\.5 · Full game/);
 assert.doesNotMatch(await gameReviewSection.innerText(),/Denver Nuggets|Jaden McDaniels|Bo Nix/);await noOverflow('Reviewed NFL Games 390');
 await page.locator('[data-sport="NBA"]').click();await denverReview.waitFor();assert.equal(await gameReviewSection.locator('[data-reviewed-pick]').count(),1);

 // Reproduce the reported long-name layout at real mobile widths. Checking only
 // page overflow misses the bug: all text fits by wrapping into a 54/64px column.
 const atlantaMarket=page.locator('#cards > .research-market').filter({hasText:'Atlanta Hawks'});
 const longMarket=page.locator('#cards > .research-market').filter({hasText:'Oklahoma City Thunder'});
 await atlantaMarket.waitFor();await longMarket.waitFor();
 for(const market of [atlantaMarket,longMarket])if(await market.getAttribute('open')===null)await market.locator(':scope > summary').click();
 const moreQuotes=atlantaMarket.locator('.more-quotes');await moreQuotes.locator(':scope > summary').click();
 if(await denverReview.getAttribute('open')===null)await denverReview.locator(':scope > summary').click();
 const atlantaQuote=atlantaMarket.locator('.quote-option').first(),longQuote=longMarket.locator('.quote-option').first();
 const baseFonts=(await readableGameCard(atlantaQuote,'NBA original text')).fonts;
 const rootTextSize=await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).fontSize));
 for(const width of [320,390,440])for(const scale of [1,2]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(({scale,rootTextSize})=>{document.documentElement.style.fontSize=scale===1?'':rootTextSize*scale+'px';},{scale,rootTextSize});
  const label='NBA games '+width+'px at '+scale*100+'% text';
  const layout=await readableGameCard(atlantaQuote,label);
  for(const [key,font] of Object.entries(baseFonts))assert.ok(Math.abs(layout.fonts[key]-font*scale)<.5,label+' fixture must actually double '+key+' text, not merely resize the viewport');
  assert.deepEqual(await atlantaQuote.locator('.player-name .team-name').allTextContents(),['Atlanta Hawks','Boston Celtics']);
  assert.match(layout.selectionText,/^(?:Atlanta Hawks|Boston Celtics) moneyline$/);
  assert.match(layout.bookText,/(?:Pinnacle|DraftKings) · -110/);
  assert.match(await atlantaQuote.locator('.target-card-reason').innerText(),/Game quote comparison only\. Use the cleared plays page for model decisions\./,'The explanation stays complete');
  assert.match(await atlantaQuote.locator('.target-card-meta').innerText(),/NOT CLEARED/);
  assert.equal(await atlantaQuote.locator('.target-card-metrics strong').first().innerText(),'N/A','Presentation cannot add an independent model probability');
  await readableGameCard(atlantaMarket.locator('.group-quotes .quote-option').last(),label+' alternate quote');
  await readableGameCard(longQuote,label+' long matchup');
  await readableGameCard(denverReview.locator('.reviewed-pick-card'),label+' reviewed game');
  const compact=longMarket.locator(':scope > summary .game-matchup'),summary=longMarket.locator(':scope > summary');
  await summary.click(); // The compact identity is intentionally hidden while expanded.
  const compactBox=await compact.boundingBox(),summaryBox=await summary.boundingBox();
  assert.ok(compactBox.width>=summaryBox.width*.5,label+' compact matchup needs readable team-name space');
  assert.deepEqual(await compact.locator('.team-name').allTextContents(),['Oklahoma City Thunder','Golden State Warriors']);
  await summary.click();
  await noOverflow(label);
  await screenshot('game-team-layout-'+width+'-'+scale*100);
 }
 await page.evaluate(()=>{document.documentElement.style.fontSize='';});
 await page.setViewportSize({width:390,height:844});
 // First prove a bundled logo loaded; then make the same official request fail
 // on reload. The actual image error handler must preserve both readable names.
 await atlantaQuote.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>[...document.querySelectorAll('#cards .quote-option .player-name .team-logo')].some(img=>img.complete&&img.naturalWidth>0));
 const failedLogo=atlantaQuote.locator('.team-identity').filter({hasText:'Boston Celtics'}).locator('.team-logo');
 failedTeamLogo=await failedLogo.evaluate(img=>img.src);
 assert.match(new URL(failedTeamLogo).pathname,/^\/assets\/team-logos\//,'NBA logos are bundled assets');
 await page.reload();await atlantaMarket.waitFor();
 await atlantaMarket.locator(':scope > summary').click();await atlantaQuote.scrollIntoViewIfNeeded();
 const failedIdentity=atlantaQuote.locator('.team-identity').filter({hasText:'Boston Celtics'});
 await failedIdentity.locator('.team-logo-fallback').waitFor({state:'visible'});
 assert.equal(await failedIdentity.locator('.team-logo').isVisible(),false,'Failed logos must not leave a broken image visible');
 assert.equal(await failedIdentity.locator('.team-name').innerText(),'Boston Celtics');
 await readableGameCard(atlantaQuote,'NBA failed-logo fallback');await noOverflow('NBA failed-logo fallback');
 failedTeamLogo=null;

 // Player cards keep the real portrait in the first track and readable text in
 // the second. A fix to the shared identity selector must not remove headshots.
 await page.goto(origin+'/research.html?kind=props&sport=NBA');
 const propMarket=page.locator('#cards > .research-market').first();await propMarket.waitFor();
 await propMarket.locator(':scope > summary').click();
 const propCard=propMarket.locator('.quote-option').first(),portrait=propCard.locator('.target-player-portrait');
 assert.equal(await portrait.getAttribute('src'),'/assets/players/derrick-white.png');
 assert.equal(await portrait.getAttribute('alt'),'Derrick White portrait');
 for(const width of [320,390,440]){
  await page.setViewportSize({width,height:844});await portrait.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>{const img=document.querySelector('#cards .target-player-portrait');return img.complete&&img.naturalWidth>0;});
  const photoBox=await portrait.boundingBox(),copyBox=await propCard.locator('.target-player-copy').boundingBox();
  assert.ok(photoBox.width>=50&&photoBox.width<=80,'Player portrait keeps its dedicated mobile track');
  assert.ok(copyBox.x>=photoBox.x+photoBox.width,'Player text remains beside the headshot');
  assert.ok(copyBox.width>=140,'Player name retains readable space at '+width+'px');
  assert.equal(await propCard.locator('.player-name').innerText(),'Derrick White');
  assert.equal(await propCard.locator('.game-matchup,.team-logo').count(),0,'Player cards must not acquire game identity markup');
  await noOverflow('Player headshot '+width);
 }

 const beforeUnsupported=reviewRequests.length;
 await page.goto(origin+'/research.html?kind=games&sport=EPL');await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
 assert.equal(await page.locator('#reviewed-games').isVisible(),false);assert.equal(await page.locator('#reviewed-games [data-reviewed-pick]').count(),0);
 assert.equal(reviewRequests.length,beforeUnsupported,'unsupported game leagues cannot call the reviewed-picks feed');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
 console.log('PASS: team scoring and reviewed Games, including sport switching and refresh; full-width game text at 320/390/440px with normal/200% text; long matchups, loaded/failed/unmapped logos, alternate quotes, and unchanged player headshots. Probabilities remain research-only. All requests mocked.');
}finally{await browser?.close();}
