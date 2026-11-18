import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNbaGames} from '../../sharp-service/lib/nba-vnext-baseline.js';
import {forecastGames} from '../../sharp-service/lib/cfb-model.js';
import nbaHandler from '../../sharp-service/lib/edge-vnext-handler.js';
import nflHandler from '../../sharp-service/api/nflmodel.js';
import {parseCsv,teamSnapshot,leagueBaselines,projectEvent} from '../../sharp-service/lib/nfl-model.js';
import {createCfbHandler} from '../../sharp-service/handlers/cfb-forecasts.js';
import {normalizeEspnGame} from '../../sharp-service/lib/cfb-sources.js';
import {buildTeamScoringContext as build} from '../../sharp-service/lib/team-scoring-context.js';
import {NFL_SCHEDULE_REVISIONS} from '../../sharp-service/lib/winner-schedule-revisions.js';
import {projectWinnerBaseline} from '../../sharp-service/lib/winner-prospective-models.js';
const cutoffAt = '2026-11-17T20:00:00Z';
const nbaEvent = {eventId:'target',startsAt:'2026-11-18T01:00:00Z',home:{teamId:'ATL',teamName:'Atlanta'},away:{teamId:'BOS',teamName:'Boston'}};
const nbaGame = (eventId, startsAt, homeScore=110, awayScore=100, extra={}) => ({eventId,startsAt,home:'ATL',away:'BOS',homeScore,awayScore,completed:true,...extra});
const context = (games, extra={}) => build({sport:'NBA',event:nbaEvent,games,cutoffAt,...extra});
const history = side => side.windows.find(window => window.key === 'history');

test('NBA means preserve zero, orient both teams and expose real sample counts', () => {
  const games = [nbaGame('one','2026-11-14T23:00Z',0,20),nbaGame('two','2026-11-15T23:00Z',80,100,{home:'BOS',away:'ATL'})];
  const result = context(games);
  assert.equal(history(result.home).pointsFor,50);
  assert.equal(history(result.home).pointsAgainst,50);
  assert.equal(history(result.away).pointsFor,50);
  assert.equal(history(result.away).pointsAgainst,50);
  assert.deepEqual(result.home.windows.map(w => [w.key,w.gameCount,w.requestedGames]),[['history',2,null],['last5',2,5],['last10',2,10]]);
  assert.equal(result.observedAt,null);
  assert.equal(result.adjustmentApplied,false);
  assert.equal(result.purpose,'EXPLANATION_ONLY');
  assert.match(result.scope,/21/);
  assert.equal(context([games[0]]).home.windows[0].pointsFor,0);
});

test('NBA scoring excludes target slate, old, live, future and malformed scores', () => {
  const good = nbaGame('good','2026-11-16T23:00Z',90,80);
  const result = context([good,
    nbaGame('same-slate','2026-11-17T17:00Z',250,0),
    nbaGame('old','2026-10-26T23:00Z',250,0),
    nbaGame('future','2026-11-19T23:00Z',250,0),
    nbaGame('live','2026-11-15T23:00Z',250,0,{completed:false}),
    nbaGame('missing','2026-11-15T23:00Z',null,0),
    nbaGame('boolean','2026-11-15T23:00Z',true,0),
    nbaGame('blank','2026-11-15T23:00Z','',0),
    nbaGame('negative','2026-11-15T23:00Z',-1,0),
    nbaGame('self','2026-11-15T23:00Z',50,50,{away:'ATL'})]);
  assert.deepEqual(history(result.home).gameIds,['good']);
  assert.equal(history(result.home).pointsFor,90);
  assert.equal(history(result.home).latestGameAt,'2026-11-16T23:00:00.000Z');
});

test('recent windows use newest eligible games without filling missing history', () => {
  const games=Array.from({length:12},(_,i)=>nbaGame(String(i),`2026-11-${String(i+1).padStart(2,'0')}T23:00Z`,i,20));
  const result=context(games.reverse());
  assert.deepEqual(result.home.windows.map(w=>[w.gameCount,w.pointsFor]),[[12,5.5],[5,9],[10,6.5]]);
  const empty=context([]);
  for(const side of [empty.home,empty.away])for(const window of side.windows){
    assert.equal(window.pointsFor,null);assert.equal(window.pointsAgainst,null);assert.equal(window.gameCount,0);
    assert.deepEqual(window.gameIds,[]);assert.equal(window.latestGameAt,null);assert.ok(window.missingReason);
  }
});

test('duplicate scores are counted once and conflicting identities or scores are excluded', () => {
  const good=nbaGame('one','2026-11-14T23:00Z',80,90), bad=nbaGame('two','2026-11-15T23:00Z',100,110);
  for(const change of [{homeScore:120},{away:'NYK'},{completed:false},{homeScore:null}]){
    const result=context([good,{...good},bad,{...bad,...change}]);
    assert.deepEqual(history(result.home).gameIds,['one']);
    assert.equal(history(result.home).pointsFor,80);
  }
});

test('scoring context rejects nonpregame requests and future source receipts', () => {
  const games=[nbaGame('one','2026-11-14T23:00Z')];
  for(const extra of [{cutoffAt:nbaEvent.startsAt},{cutoffAt:'invalid'},{observedAt:'2026-11-17T21:00Z'},{event:{...nbaEvent,away:nbaEvent.home}}]){
    const result=context(games,extra);assert.equal(history(result.home).pointsFor,null);assert.ok(history(result.home).missingReason);
  }
  const received=context(games,{observedAt:'2026-11-17T19:30Z'});
  assert.equal(received.observedAt,'2026-11-17T19:30:00.000Z');
  assert.equal(history(received.home).gameCount,1);
});

const nflGame=(week,gameday,home_score='20',away_score='10',extra={})=>({game_id:`2026_${String(week).padStart(2,'0')}_CHI_GB`,season:'2026',week:String(week),game_type:'REG',gameday,gametime:'13:00',home_team:'GB',away_team:'CHI',home_score,away_score,result:home_score===null?null:String(Number(home_score)-Number(away_score)),...extra});
const nflTarget=nflGame(11,'2026-11-22',null,null);
const nflEvent={eventId:'board-id',startsAt:'2026-11-22T18:00:00Z',season:2026,home:{teamId:'GB',teamName:'Green Bay'},away:{teamId:'CHI',teamName:'Chicago'}};
test('NFL scope is current-season regular games before target date and week', () => {
  const games=[nflTarget,nflGame(9,'2026-11-08','0','10'),nflGame(10,'2026-11-15','30','10'),
    nflGame(8,'2025-11-02','99','0',{game_id:'2025_08_CHI_GB',season:'2025'}),
    nflGame(11,'2026-11-16','99','0'),nflGame(12,'2026-11-22','99','0'),
    nflGame(3,'2026-09-20','99','0',{game_type:'POST'}),nflGame(4,'2026-09-27','99','0',{result:'0'})];
  const result=build({sport:'NFL',event:nflEvent,games,cutoffAt});
  assert.equal(history(result.home).pointsFor,15);assert.equal(history(result.home).pointsAgainst,10);
  assert.equal(history(result.home).gameCount,2);assert.equal(history(result.away).pointsFor,10);
  assert.match(result.scope,/regular/i);assert.match(result.scope,/current season/i);
  assert.equal(result.home.windows[1].gameCount,2);
});

test('NFL missing or conflicting exact target schedule binding withholds averages', () => {
  const previous=nflGame(10,'2026-11-15');
  for(const games of [[previous],[previous,nflTarget,{...nflTarget,gametime:'16:00'}],
    [previous,nflTarget,{...nflTarget,season:'2025'}],[previous,nflTarget,{...nflTarget,home_team:'MIN'}]]){
    const result=build({sport:'NFL',event:nflEvent,games,cutoffAt});
    assert.equal(history(result.home).pointsFor,null);assert.match(history(result.home).missingReason,/identity|schedule/i);
  }
});

function revisedNflFixture(revision) {
  const games=[8,9,10,11].map(week=>({
    game_id:`2026_${String(week).padStart(2,'0')}_${revision.away}_${revision.home}`,season:'2026',week:String(week),game_type:'REG',
    gameday:week===11?revision.gameDate:`2026-11-${String(1+(week-8)*7).padStart(2,'0')}`,
    gametime:week===11&&revision.home==='PHI'?'16:25':'13:00',home_team:revision.home,away_team:revision.away,
    home_score:week===11?'':'24',away_score:week===11?'':'20',result:week===11?'':'4',location:'Home'
  }));
  const event={eventId:revision.sourceEventId,startsAt:revision.startsAt,season:revision.season,
    home:{teamId:revision.home,teamName:revision.homeName},away:{teamId:revision.away,teamName:revision.awayName}};
  return {sport:'NFL',event,games,cutoffAt};
}

test('only the two pinned NFL kickoff revisions restore exact scoring samples with official evidence', () => {
  for(const revision of NFL_SCHEDULE_REVISIONS){
    const input=revisedNflFixture(revision),before=structuredClone(input);
    const originalEvent={eventID:revision.baseEventID,startsAt:revision.oldStartsAt,season:revision.season,week:revision.week,gameDate:revision.gameDate,
      home:{id:revision.home,abbreviation:revision.home},away:{id:revision.away,abbreviation:revision.away},neutralSite:false,sourceIds:{nflverse:revision.providerGameID}};
    const infer=()=>projectWinnerBaseline({sport:'NFL',event:originalEvent,history:{complete:true,schedule:input.games},issuedAt:cutoffAt});
    const prediction=infer(),result=build(input);
    assert.equal(history(result.home).gameCount,3,revision.sourceEventId+' must use the verified corrected kickoff');
    assert.equal(history(result.home).pointsFor,24);assert.equal(history(result.home).pointsAgainst,20);
    assert.equal(history(result.away).pointsFor,20);assert.equal(result.observedAt,null);
    assert.match(result.source,/NFL official schedule/);assert.match(result.scope,/verified.*schedule correction/i);
    assert.equal(result.targetScheduleEvidence.revisionHash,revision.revisionHash);
    for(const key of ['announcementUrl','scheduleUrl','announcementFetchedAt','scheduleFetchedAt','oldStartsAt','startsAt']){
      assert.equal(result.targetScheduleEvidence[key],revision[key]);
    }
    assert.deepEqual(input,before);assert.deepEqual(infer(),prediction);
  }
});

test('official scoring fallback rejects wrong provider identity, teams, times and evidence cutoff', () => {
  for(const revision of NFL_SCHEDULE_REVISIONS){
    for(const change of [
      input=>{input.event.eventId='unreviewed-event';},
      input=>{input.event.home.teamId='DAL';},
      input=>{input.event.away.teamId='MIN';},
      input=>{input.event.season=2025;},
      input=>{input.event.startsAt=new Date(Date.parse(revision.startsAt)+60000).toISOString();},
      input=>{input.cutoffAt='2026-11-17T17:34:49.780Z';},
      input=>{input.cutoffAt='2026-11-17T17:34:49.834Z';},
      input=>{input.games.pop();},
      input=>{input.games.at(-1).gameday='2026-11-21';},
      input=>{input.games.at(-1).gametime='15:00';},
      input=>{input.games.at(-1).week='12';}
    ]){
      const input=revisedNflFixture(revision);change(input);const result=build(input);
      assert.equal(history(result.home).pointsFor,null);assert.ok(history(result.home).missingReason);
      assert.equal(result.targetScheduleEvidence,undefined);
    }
  }
});

test('official scoring fallback never revives a conflicting target or overrides exact schedule matching', () => {
  for(const revision of NFL_SCHEDULE_REVISIONS){
    for(const change of [{gametime:revision.home==='PHI'?'13:00':'16:25'},{home_team:'DAL'},{season:'2025'},{game_type:'POST'}]){
      const input=revisedNflFixture(revision);input.games.push({...input.games.at(-1),...change});
      const result=build(input);assert.equal(history(result.home).gameCount,0);assert.equal(result.targetScheduleEvidence,undefined);
    }
    const exact=revisedNflFixture(revision);exact.games.at(-1).gametime=revision.home==='PHI'?'13:00':'16:25';
    const normal=build(exact);assert.equal(history(normal.home).gameCount,3);assert.equal(normal.targetScheduleEvidence,undefined);
    // Two different valid schedule IDs at the same exact kickoff remain ambiguous.
    exact.games.push({...exact.games.at(-1),game_id:`2026_12_${revision.away}_${revision.home}`,week:'12'});
    const ambiguous=build(exact);assert.equal(history(ambiguous.home).gameCount,0);assert.equal(ambiguous.targetScheduleEvidence,undefined);
  }
});

const cfbGame=(id,startsAt,extra={})=>({id,season:2026,startsAt,homeID:'1',awayID:'2',homeName:'Home',awayName:'Away',homeScore:30,awayScore:10,completed:true,cancelled:false,neutralSite:false,fbsVerified:true,fetchedAt:'2026-11-17T19:00:00Z',...extra});
const cfbEvent={eventId:'cfb-target',startsAt:'2026-11-18T01:00Z',season:2026,fbsVerified:true,home:{teamId:'1',teamName:'Home'},away:{teamId:'2',teamName:'Away'}};
test('CFB uses current-season FBS history and its completion buffer, not all scored games', () => {
  const result=build({sport:'CFB',event:cfbEvent,cutoffAt,games:[
    cfbGame('accepted','2026-11-15T23:30Z',{homeScore:0}),
    cfbGame('late','2026-11-16T23:30Z',{homeScore:99}),
    cfbGame('non-fbs','2026-11-10T20:00Z',{fbsVerified:false}),
    cfbGame('old-season','2025-11-10T20:00Z',{season:2025}),
    cfbGame('cancelled','2026-11-10T20:00Z',{cancelled:true}),
    cfbGame('unknown-venue','2026-11-10T20:00Z',{neutralSite:null}),
    cfbGame('future-receipt','2026-11-10T20:00Z',{fetchedAt:'2026-11-17T21:00Z'})]});
  assert.deepEqual(history(result.home).gameIds,['accepted']);assert.equal(history(result.home).pointsFor,0);
  assert.match(result.scope,/FBS/);assert.equal(result.observedAt,'2026-11-17T19:00:00.000Z');
});

test('adding scoring descriptions leaves NBA and CFB forecasts and inputs unchanged', () => {
  const games=Array.from({length:5},(_,i)=>nbaGame(String(i),`2026-11-${String(i+1).padStart(2,'0')}T23:00Z`,105+i,100));
  const input={historicalGames:games,upcomingGames:[{eventId:'target',startsAt:nbaEvent.startsAt,home:'ATL',away:'BOS'}],asOf:cutoffAt,historyComplete:true};
  const before=structuredClone(input),report=projectNbaGames(input),original=structuredClone(report);
  const enriched={...report,rows:report.rows.map(row=>({...row,teamScoringContext:context(games)}))};
  assert.deepEqual(input,before);assert.deepEqual(report,original);
  const {teamScoringContext,...forecast}=enriched.rows[0];assert.deepEqual(forecast,original.rows[0]);
  const cfbHistory=Array.from({length:8},(_,i)=>cfbGame(String(i),`2026-09-${String(i+1).padStart(2,'0')}T17:00Z`));
  const target=cfbGame('cfb-target',cfbEvent.startsAt,{completed:false}),cfg={k:24,homeAdvantage:35,carry:.75};
  const cfbBefore=forecastGames(cfbHistory,[target],cfg,cutoffAt);
  build({sport:'CFB',event:cfbEvent,games:cfbHistory,cutoffAt});
  assert.deepEqual(forecastGames(cfbHistory,[target],cfg,cutoffAt),cfbBefore);
});

test('NBA API adds scoring context after inference using the existing scoreboard requests', async t => {
  const OriginalDate=globalThis.Date,originalFetch=globalThis.fetch;
  globalThis.Date=class extends OriginalDate { constructor(...args){super(...(args.length?args:[cutoffAt]));}static now(){return OriginalDate.parse(cutoffAt);} };
  t.after(()=>{globalThis.Date=OriginalDate;globalThis.fetch=originalFetch;});
  const collected=[];let requests=0;
  globalThis.fetch=async input=>{
    const url=new URL(String(input));assert.equal(url.hostname,'site.api.espn.com');requests++;
    const date=url.searchParams.get('dates'),upcoming=date==='20261117';
    const startsAt=upcoming?nbaEvent.startsAt:`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6)}T23:00:00Z`;
    if(!upcoming)collected.push(nbaGame(date,startsAt));
    return {ok:true,json:async()=>({events:[{id:date,date:startsAt,status:{type:{completed:!upcoming,state:upcoming?'pre':'post'}},competitions:[{competitors:[{homeAway:'home',team:{abbreviation:'ATL'},score:upcoming?'0':'110'},{homeAway:'away',team:{abbreviation:'BOS'},score:upcoming?'0':'100'}]}]}]})};
  };
  const response={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await nbaHandler({method:'GET',query:{mode:'nba',live:'1',date:'2026-11-17'}},response);
  const row=response.body.rows[0];assert.ok(row.teamScoringContext,'NBA API must attach context after inference');
  assert.equal(requests,22);assert.equal(history(row.teamScoringContext.home).pointsFor,110);
  assert.equal(history(row.teamScoringContext.home).gameCount,21);
  assert.equal(row.teamScoringContext.observedAt,'2026-11-17T20:00:00.000Z');
  const expected=projectNbaGames({historicalGames:collected,upcomingGames:[{eventId:'20261117',startsAt:'2026-11-18T01:00:00.000Z',home:'ATL',away:'BOS',homeScore:null,awayScore:null,completed:false}],asOf:cutoffAt,historyComplete:true});
  const {teamScoringContext,...unchanged}=row;assert.deepEqual(unchanged,expected.rows[0]);
  assert.equal(response.body.productionEligible,false);
});

test('NFL API exposes the same scoring sample on events and markets without changing forecasts', async t => {
  t.mock.method(Date,'now',()=>Date.parse(cutoffAt));
  const originalFetch=globalThis.fetch,originalCache=globalThis.__edgeLabNflDataCache;
  globalThis.__edgeLabNflDataCache=new Map();
  t.after(()=>{globalThis.fetch=originalFetch;globalThis.__edgeLabNflDataCache=originalCache;});
  const schedule=[nflGame(9,'2026-11-08','0','10'),nflGame(10,'2026-11-15','30','10'),nflTarget].map(game=>({...game,location:'Home',roof:'dome',home_qb_name:'Jordan Love',away_qb_name:'Caleb Williams',home_rest:'7',away_rest:'7'}));
  const csv=rows=>{const keys=Object.keys(rows[0]);return [keys.join(','),...rows.map(row=>keys.map(key=>row[key]??'').join(','))].join('\n');};
  const scheduleCsv=csv(schedule);
  const stats=[{season:'2026',week:'10',team:'GB',season_type:'REG',game_id:'2026_10_CHI_GB',opponent_team:'CHI',attempts:'30',carries:'25',sacks_suffered:'2',passing_epa:'4',rushing_epa:'1'},
    {season:'2026',week:'10',team:'CHI',season_type:'REG',game_id:'2026_10_CHI_GB',opponent_team:'GB',attempts:'30',carries:'25',sacks_suffered:'2',passing_epa:'1',rushing_epa:'0'}];
  const depthCharts=[{dt:cutoffAt,team:'GB',player_name:'Jordan Love',pos_abb:'QB',pos_rank:'1'},{dt:cutoffAt,team:'CHI',player_name:'Caleb Williams',pos_abb:'QB',pos_rank:'1'}];
  const quote=(odds,line=null)=>({consensus:{odds,line},books:{draftkings:{odds,line,available:true},fanduel:{odds,line,available:true}}});
  const event={eventID:'nfl-game',league:'NFL',startsAt:nflEvent.startsAt,matchup:{home:{name:'Green Bay Packers',short:'GB'},away:{name:'Chicago Bears',short:'CHI'}},markets:{moneyline:{home:quote(-200),away:quote(180)},total:{over:quote(-110,44),under:quote(-110,44)}}};
  globalThis.fetch=async input=>{
    const url=String(input);
    if(url.includes('/api/board'))return new Response(JSON.stringify({events:[event]}));
    if(url.includes('nfldata/master/data/games.csv'))return new Response(scheduleCsv);
    if(url.includes('stats_team_week_2026.csv'))return new Response(csv(stats));
    if(url.includes('stats_team_week_2025.csv'))return new Response(Object.keys(stats[0]).join(','));
    if(url.includes('depth_charts_2026.csv'))return new Response(csv(depthCharts));
    throw Error('Unexpected source: '+url);
  };
  const response={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await nflHandler({method:'GET',query:{season:'2026'}},response);
  assert.equal(response.code,200);const actual=response.body.events[0];assert.equal(actual.available,true);
  assert.ok(actual.teamScoringContext,'NFL event must include scoring context');
  assert.equal(history(actual.teamScoringContext.home).pointsFor,15);assert.equal(history(actual.teamScoringContext.home).gameCount,2);
  assert.equal(actual.teamScoringContext.observedAt,null);assert.match(actual.teamScoringContext.scope,/current season/i);
  assert.ok(response.body.markets.length>0);
  for(const market of response.body.markets)assert.deepEqual(market.teamScoringContext,actual.teamScoringContext);
  const parsedSchedule=parseCsv(scheduleCsv),snapshots=new Map(['GB','CHI'].map(team=>[team,teamSnapshot(parsedSchedule,stats,2026,team)]));
  const expected=projectEvent({event,schedule:parsedSchedule,stats,depthCharts,snapshots,baseline:leagueBaselines([...snapshots.values()]),season:2026,
    weatherContext:{available:true,controlledEnvironment:true,source:'nflverse_roof',roof:'dome',totalAdjustmentPoints:0,warning:null},sourceHealth:response.body.sourceHealth,asOf:'2026-11-17T20:00:00.000Z'});
  const {teamScoringContext,...unchanged}=actual;assert.deepEqual(unchanged,expected);
  assert.equal(response.body.productionEligible,false);
});

test('CFB API and new captures carry scoring evidence without changing the frozen Elo forecast', async () => {
  const startsAt='2026-11-18T01:00:00.000Z';
  const event=(id,date,completed)=>({id,date,season:{year:2026},competitions:[{neutralSite:false,status:{type:{completed}},competitors:[{homeAway:'home',team:{id:'1',displayName:'Home',location:'Home'},score:completed?'30':'0'},{homeAway:'away',team:{id:'2',displayName:'Away',location:'Away'},score:completed?'10':'0'}]}]});
  const events=[...Array.from({length:8},(_,i)=>event('h'+i,`2026-09-${String(i+1).padStart(2,'0')}T17:00:00Z`,true)),event('target',startsAt,false)];
  const games=events.map(e=>({...normalizeEspnGame(e,cutoffAt),fbsVerified:true}));
  const source={membership:{2026:['1','2']},schedules:['1','2'].map(teamID=>({teamID,season:2026,fetchedAt:cutoffAt,games})),games,complete:true,conflicts:[]};
  const config={k:24,homeAdvantage:35,carry:.75},docs=new Map([['source-current',source],['frozen-model',{modelVersion:'frozen',config}]]);let captured;
  const json=(body,status=200)=>({ok:true,status,text:async()=>body===null?'':JSON.stringify(body),json:async()=>body});
  const handler=createCfbHandler({env:{SUPABASE_SERVICE_ROLE_KEY:'key',SPORTS_ODDS_API_KEY:'provider'},now:()=>Date.parse(cutoffAt),optimize:async()=>({effectiveLimit:100}),
    providerFetch:async()=>({ageMs:0,fetchedAt:Date.parse(cutoffAt),payload:{data:[{eventID:'sgo-target',leagueID:'NCAAF',status:{startsAt},teams:{home:{teamID:'H',names:{long:'Home'}},away:{teamID:'A',names:{long:'Away'}}}}]}}),
    fetchImpl:async(input,options)=>{
      const url=new URL(input),body=options.body?JSON.parse(options.body):null;
      if(url.hostname==='site.api.espn.com'){const id=url.pathname.split('/').at(-2),post=url.searchParams.get('seasontype')==='3';return json({team:{id},requestedSeason:{year:2026,type:post?3:2},events:post?[]:events});}
      if(url.pathname.endsWith('/claim_cfb_collection'))return json(true);
      if(url.pathname.endsWith('/capture_cfb_forecasts')){captured=body.p_rows;return json([]);}
      if(url.pathname.endsWith('/record_cfb_capture_scope'))return json(null);
      if(url.pathname.endsWith('/cfb_research_performance'))return json({captured:0,n:0,capturedEspnIDs:[]});
      if(url.pathname.endsWith('/cfb_prospective_forecasts'))return json([]);
      if(options.method==='DELETE')return json(null,204);
      if(options.method==='POST'){docs.set(body.doc_key,body.body);return json(null,201);}
      const key=url.searchParams.get('doc_key')?.slice(3);return json(docs.has(key)?[{body:docs.get(key)}]:[]);
    }});
  const response={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:'POST',headers:{authorization:'Bearer key'},body:{action:'refresh'}},response);
  assert.equal(response.code,200);const actual=response.body.forecasts[0];assert.ok(actual.teamScoringContext,'CFB forecast must include scoring context');
  assert.equal(history(actual.teamScoringContext.home).pointsFor,30);assert.equal(history(actual.teamScoringContext.home).pointsAgainst,10);
  assert.equal(history(actual.teamScoringContext.home).gameCount,8);assert.match(actual.teamScoringContext.scope,/FBS/);
  assert.deepEqual(captured[0].forecast.teamScoringContext,actual.teamScoringContext);
  const target={...games.at(-1),sgoID:'sgo-target',sgoHomeID:'H',sgoAwayID:'A'};
  const expected=forecastGames(games,[target],config,cutoffAt).forecasts[0];
  for(const [key,value] of Object.entries(expected))assert.deepEqual(actual[key],value,key+' must remain unchanged');
  assert.deepEqual(docs.get('frozen-model'),{modelVersion:'frozen',config});assert.equal(response.body.productionEligible,false);
});
