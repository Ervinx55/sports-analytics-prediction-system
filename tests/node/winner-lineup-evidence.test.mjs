import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {nbaOfficialLineupEvidence,nbaInjuryEvidence,nflInactiveEvidence,createWinnerLineupCollector} from '../../sharp-service/lib/winner-lineup-evidence.js';
import {normalizeLineupEvidence} from '../../sharp-service/lib/winner-capture-policy.js';
import {createWinnerSourceLoader,createWinnerHandler} from '../../sharp-service/handlers/winner-forecasts.js';
const schedule=JSON.parse(fs.readFileSync(new URL('../fixtures/winner-lineups/nba-schedule.json',import.meta.url)));
const daily=JSON.parse(fs.readFileSync(new URL('../fixtures/winner-lineups/nba-expected.json',import.meta.url)));
const fetchedAt='2026-11-17T17:35:29.000Z',issuedAt='2026-11-17T17:36:00.000Z';
const event={sport:'NBA',eventID:'espn:401',identityVerified:true,status:'SCHEDULED',startsAt:'2026-11-18T00:30:00Z',home:{id:'28',abbreviation:'TOR'},away:{id:'18',abbreviation:'NYK'}};
const source=(url,text,at=fetchedAt)=>{const rawSha256=createHash('sha256').update(text).digest('hex');return{source_hash:createHash('sha256').update(JSON.stringify({sourceUrl:url,rawSha256})).digest('hex'),source_url:url,fetched_at:at,body:{rawText:text,rawSha256}};};
const scheduleHtml='<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify(schedule)+'</script>';
const args=()=>({events:[event],scheduleHtml,scheduleSource:source('https://www.nba.com/games?date=2026-11-17',scheduleHtml),lineupPayload:structuredClone(daily),lineupSource:source('https://stats.nba.com/js/data/leaders/00_daily_lineups_20261117.json',JSON.stringify(daily)),issuedAt});
const confirm=a=>{for(const side of ['homeTeam','awayTeam'])for(const p of a.lineupPayload.games[0][side].players)p.lineupStatus='Confirmed';return a;};

test('actual official expected feed preserves raw timezone-less timestamps without claiming confirmed starters',()=>{
 const result=nbaOfficialLineupEvidence(args());assert.equal(result.evidence.length,1);
 const e=result.evidence[0];assert.equal(e.kind,'EXPECTED_STARTERS');assert.equal(e.status,'EXPECTED');assert.equal(e.publishedAt,null);assert.equal(e.publicationTimeKnown,false);
 assert.equal(e.rows.length,10);assert.equal(e.rows[0].sourceTimestampRaw,'2026-11-17T12:31:35');assert.equal(e.officialGameId,'0022600253');
 const normalized=normalizeLineupEvidence(event,result.evidence,issuedAt);assert.equal(normalized.verified,false);assert.equal(normalized.observations.length,1);assert.equal(normalized.observations[0].publishedAt,null);
 assert.equal(normalized.observations[0].sourceHash,e.sourceHash);
});

test('only five explicitly confirmed starter positions per official team can verify through a real pregame receipt',()=>{
 const a=confirm(args());a.lineupPayload.games[0].homeTeam.players.push({personId:999,teamId:1610612761,lineupStatus:'Confirmed',rosterStatus:'Active',position:'',timestamp:'2026-11-17T12:31:35'});
 const result=nbaOfficialLineupEvidence(a),e=result.evidence[0];assert.equal(e.kind,'CONFIRMED_STARTERS');assert.equal(e.homePlayerIds.length,5);assert.equal(e.awayPlayerIds.length,5);
 assert.equal(e.homePlayerIds.includes('999'),false);assert.equal(normalizeLineupEvidence(event,result.evidence,issuedAt).verified,true);
});

test('official confirmed enum alone cannot accept final, duplicate, wrong-team, wrong-kickoff or post-start evidence',()=>{
 for(const mutate of [a=>a.lineupPayload.games[0].gameStatus=3,a=>a.lineupPayload.games[0].gameStatusText='Postponed',a=>a.lineupPayload.games[0].homeTeam.players[0].teamId=123,a=>a.lineupPayload.games[0].homeTeam.players[1].personId=a.lineupPayload.games[0].homeTeam.players[0].personId,a=>a.lineupPayload.games[0].homeTeam.players[1].position='SG',a=>a.events=[{...event,startsAt:'2026-11-18T00:31:00Z'}],a=>a.lineupSource.fetched_at=event.startsAt,a=>a.scheduleSource.fetched_at=event.startsAt,a=>a.lineupPayload.games.push(structuredClone(a.lineupPayload.games[0]))]){
  const a=confirm(args());mutate(a);const result=nbaOfficialLineupEvidence(a);assert.equal(normalizeLineupEvidence(a.events[0],result.evidence,issuedAt).verified,false);
 }
 const a=confirm(args());const html=JSON.parse(JSON.stringify(schedule));html.props.pageProps.gameCardFeed.modules[0].cards[0].cardData.gameStatus=2;a.scheduleHtml='<script id="__NEXT_DATA__">'+JSON.stringify(html)+'</script>';
 assert.equal(nbaOfficialLineupEvidence(a).evidence.length,0);
});

test('receipt-based confirmation is narrowly bound to official feed URL and exact official schedule proof',()=>{
 const e=nbaOfficialLineupEvidence(confirm(args())).evidence[0];
 for(const changed of [{sourceUrl:'https://example.test/lineups'},{receiptContract:'OTHER'},{identityEvidence:{...e.identityEvidence,startsAt:'2026-11-18T00:31:00Z'}},{identitySource:{...e.identitySource,sourceUrl:'https://example.test/schedule'}},{homeTeamId:'wrong'}])assert.equal(normalizeLineupEvidence(event,[{...e,...changed}],issuedAt).verified,false);
});

test('NBA injury context matches exact game and teams, preserves PDF provenance, and never confirms participation',()=>{
 const report={url:'https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-17_12_30PM.pdf',sha256:'c'.repeat(64),publishedAt:'2026-11-17T17:30:00Z',retrievedAt:fetchedAt,rows:[{gameDate:'11/17/2026',gameTime:'07:30 (ET)',matchup:'NYK@TOR',team:'Toronto Raptors',player:'Example, Player',status:'Available',submission:'SUBMITTED'}]};
 const observations=nbaInjuryEvidence({events:[event],report,source:source('https://sports-analytics-prediction-system-tau.vercel.app/api/nbaavailability',JSON.stringify(report)),issuedAt});
 assert.equal(observations.length,1);assert.equal(observations[0].kind,'OFFICIAL_INJURY_REPORT');assert.equal(observations[0].pdfSha256,report.sha256);assert.equal(observations[0].rows[0].status,'Available');assert.equal(normalizeLineupEvidence(event,observations,issuedAt).verified,false);
 assert.equal(nbaInjuryEvidence({events:[event],report:{...report,publishedAt:'2026-11-17T15:00:00Z'},source:source('https://example.test',JSON.stringify(report)),issuedAt}).length,0);
 assert.equal(nbaInjuryEvidence({events:[event],report:{...report,rows:report.rows.map(r=>({...r,gameTime:'08:00 (ET)'}))},source:source('https://example.test',JSON.stringify(report)),issuedAt}).length,0);
});

const nflEvent={sport:'NFL',eventID:'nflverse:2026_10_WAS_NYG',identityVerified:true,status:'SCHEDULED',season:2026,week:10,gameDate:'2026-11-12',startsAt:'2026-11-13T01:15:00Z',home:{id:'NYG',abbreviation:'NYG'},away:{id:'WAS',abbreviation:'WAS'}};
const nflUrl='https://www.nfl.com/news/week-10-thursday-night-inactives-washington-commanders-at-new-york-giants';
const article={'@type':'NewsArticle',publisher:{name:'NFL'},url:nflUrl,datePublished:'2026-11-12T23:54:44.235Z',dateModified:'2026-11-12T23:54:44.235Z',headline:'Week 10 Thursday night inactives: Washington Commanders at New York Giants',articleBody:'COMMANDERS\n\nQB Athan Kaliakmanis (emergency third QB)\nTE Colson Yankoff\n\nGIANTS\n\nCB Paulson Adebo\nCB Nikko Reed'};
const nflArgs=(doc=article,at='2026-11-13T00:00:00Z')=>{const html='<script type="application/ld+json">'+JSON.stringify(doc)+'</script>';return{events:[nflEvent],html,source:source(nflUrl,html,at),issuedAt:at};};

test('official NFL game-day inactive lists verify only the listed names, keeping emergency QB distinct',()=>{
 const result=nflInactiveEvidence(nflArgs());assert.equal(result.length,1);assert.equal(result[0].kind,'NFL_OFFICIAL_INACTIVES');assert.equal(result[0].status,'VERIFIED_INACTIVE_LISTS');assert.equal(result[0].completeActiveRoster,false);
 assert.equal(result[0].rows.find(p=>p.playerName==='Athan Kaliakmanis').designation,'EMERGENCY_THIRD_QB');assert.equal(normalizeLineupEvidence(nflEvent,result,'2026-11-13T00:01:00Z').verified,false);
});

test('NFL prior-week, post-start, future-modified and partial inactive reports never claim full verified lists',()=>{
 assert.equal(nflInactiveEvidence({...nflArgs(),events:[{...nflEvent,week:11}]}).length,0);
 assert.equal(nflInactiveEvidence(nflArgs(article,'2026-11-13T02:00:00Z')).length,0);
 assert.equal(nflInactiveEvidence(nflArgs({...article,dateModified:'2026-11-13T03:00:00Z'})).length,0);
 const partial=nflInactiveEvidence(nflArgs({...article,articleBody:'COMMANDERS\nTE Colson Yankoff'}));assert.ok(partial.length===0||partial[0].status==='PARTIAL_INACTIVE_LIST');
 const malformed=nflInactiveEvidence(nflArgs({...article,articleBody:article.articleBody.replace('TE Colson Yankoff','Unparsed player entry')}));assert.equal(malformed[0].status,'PARTIAL_INACTIVE_LIST');assert.equal(malformed[0].completeInactiveLists,false);
});

test('game-day NFL collector discovers only exact official article paths and archives both receipts',async()=>{
 const calls=[];const collect=createWinnerLineupCollector({now:()=>Date.parse('2026-11-13T00:00:00Z'),fetchImpl:async url=>{calls.push(url);if(url.endsWith('/series/around-the-nfl-news'))return new Response(`<a href="${nflUrl}">Official inactive lists</a><a href="https://evil.test/news/week-10-inactives">Ignore</a><a href="/news/week-9-inactives">Old week</a>`);return new Response(nflArgs().html);}});
 const result=await collect({events:[nflEvent]});assert.equal(calls.length,2);assert.equal(calls[1],nflUrl);assert.equal(result.sources.length,2);assert.equal(result.coverage.nflInactiveGames,1);assert.equal(result.lineupEvidence[0].completeActiveRoster,false);
 assert.ok(result.sources.some(s=>s.source_hash===result.lineupEvidence[0].sourceHash));
});

test('collector only requests fixed bounded official sources, returns unavailable without inventing lineups',async()=>{
 const urls=[];const collect=createWinnerLineupCollector({now:()=>Date.parse(issuedAt),fetchImpl:async url=>{urls.push(url);return new Response('',{status:503});}});
 const result=await collect({events:[event],signal:new AbortController().signal});assert.equal(result.lineupEvidence.length,0);assert.equal(result.sources.length,0);assert.ok(urls.length<=3);assert.equal(result.coverage.nbaConfirmedGames,0);assert.ok(result.coverage.unavailable.length>0);
 assert.ok(urls.every(u=>u.startsWith('https://www.nba.com/games?date=')||u.startsWith('https://stats.nba.com/js/data/leaders/00_daily_lineups_')||u==='https://sports-analytics-prediction-system-tau.vercel.app/api/nbaavailability'));
});

test('hosted source loader archives official receipts and the handler preserves expected lineup context in immutable inputs',async()=>{
 const calls=[];const fetchImpl=async url=>{calls.push(url);
  if(url.startsWith('https://www.nba.com/games?'))return new Response(scheduleHtml);
  if(url.startsWith('https://stats.nba.com/'))return new Response(JSON.stringify(daily));
  if(url.includes('/api/nbaavailability'))return new Response('{}');
  if(url.includes('site.api.espn.com'))return new Response(JSON.stringify({events:url.includes('dates=20261117')?[{id:'401',date:event.startsAt,season:{year:2027},status:{type:{state:'pre'}},competitions:[{competitors:[{homeAway:'home',team:{id:'28',abbreviation:'TOR'}},{homeAway:'away',team:{id:'18',abbreviation:'NY'}}]}]}]:[]}));
  return new Response('',{status:503});
 };
 const load=createWinnerSourceLoader({env:{},now:()=>Date.parse(issuedAt),fetchImpl});const collected=await load({action:'refresh'});
 assert.equal(collected.lineupEvidence.length,1);assert.equal(collected.coverage.lineups.nbaExpectedGames,1);assert.equal(collected.coverage.lineups.nbaConfirmedGames,0);
 const e=collected.lineupEvidence[0];assert.ok(collected.sources.some(s=>s.source_hash===e.sourceHash&&s.fetched_at===e.fetchedAt));assert.ok(collected.sources.some(s=>s.source_hash===e.identitySource.sourceHash));
 collected.groups.NBA.history.games=Array.from({length:4},(_,i)=>({eventId:String(i),startsAt:`2026-11-${10+i}T00:00:00Z`,home:'TOR',away:'NYK',homeScore:110,awayScore:100,completed:true}));
 let saved;const handler=createWinnerHandler({env:{SUPABASE_SERVICE_ROLE_KEY:'test-key'},now:()=>Date.parse(issuedAt),loadSources:async()=>collected,store:{pending:async()=>[],append:async payload=>{saved=payload;return{captured:payload.p_forecasts.length};}}});
 const res={status(n){this.code=n;return this;},setHeader(){},json(body){this.body=body;return this;}};await handler({method:'POST',headers:{authorization:'Bearer test-key'},body:{action:'refresh'}},res);
 assert.equal(res.code,200);assert.equal(saved.p_forecasts.length,1);const forecast=saved.p_forecasts[0].forecast;
 assert.equal(forecast.lineup.verified,false);assert.equal(forecast.lineup.observations.length,1);assert.equal(forecast.lineup.observations[0].sourceHash,e.sourceHash);assert.equal(forecast.productionWeight,0);
 const input=saved.p_sources.find(s=>s.source_hash===saved.p_forecasts[0].input_hash);assert.ok(Date.parse(input.fetched_at)<=Date.parse(forecast.issuedAt));
});

test('public status exposes only numeric current lineup and schedule-resolution counts',async()=>{
 const handler=createWinnerHandler({env:{SUPABASE_SERVICE_ROLE_KEY:'test'},store:{status:async()=>({schedule_resolutions:2,cohorts:[{sport:'NFL',capture_window:'EARLY',schedule_resolved_games:2,raw:'private'}],latest:{generatedAt:issuedAt,coverage:{lineups:{nbaCheckedGames:5,nbaExpectedGames:5,nbaConfirmedGames:0,nbaInjuryGames:5,nflCheckedGames:0,nflInactiveGames:0,nflOutsideGameDayWindow:13,unavailable:[{source:'private-url'}],raw:'private'}}}})}});
 const res={status(n){this.code=n;return this;},setHeader(){},json(body){this.body=body;return this;}};await handler({method:'GET'},res);
 assert.equal(res.code,200);assert.equal(res.body.schedule_resolutions,2);assert.equal(res.body.cohorts[0].schedule_resolved_games,2);assert.equal(res.body.latest.lineups.nbaExpectedGames,5);assert.equal(res.body.latest.lineups.nbaConfirmedGames,0);assert.equal(JSON.stringify(res.body).includes('private'),false);
});
