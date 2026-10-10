import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeFinalResult} from '../../supabase/functions/_shared/performance-result-sources.mjs';
import {settlePrediction} from '../../supabase/functions/_shared/performance-settlement.mjs';
const fixture = sport => JSON.parse(readFileSync(new URL(`../fixtures/performance/${sport.toLowerCase()}-final-result.json`,import.meta.url)));
const rule = {version:'fixture-explicit-v1',book:'fixture-book',period:'INCLUDING_OVERTIME',tie:'PUSH',cancelled:'VOID',shortened:'UNRESOLVED',nonparticipant:'VOID',appearance:'ANY_APPEARANCE'};
const prediction = (overrides={}) => ({id:'p1',sport:'NFL',eventKey:'espn:nfl:401671789',sourceIds:{provider:'espn',event:'401671789'},book:'fixture-book',marketType:'moneyline',side:'HOME',settlementRule:rule,...overrides});
const result = sport => {const f=fixture(sport);return normalizeFinalResult(f.payload,{sport,source:f.evidence.source,retrievedAt:f.evidence.retrievedAt});};
const grade = (p,r=result('NFL')) => settlePrediction(prediction(p),r);
test('ESPN final identities, score periods and missing update time are preserved',()=>{
 const r=result('NFL'); assert.equal(r.eventKey,'espn:nfl:401671789');assert.equal(r.homeScore,27);assert.equal(r.awayScore,20);assert.deepEqual(r.regulationScores,{home:27,away:20});assert.equal(r.sourceUpdatedAt,null);assert.ok(r.sourceRevision);assert.equal(r.players['espn:nfl:3916387'].stats.passing_yards,273);
});
test('official MLB IDs, game-only stats and source timestamp are preserved',()=>{
 const r=result('MLB');assert.equal(r.eventKey,'mlb:744986');assert.equal(r.homeScore,6);assert.equal(r.awayScore,11);assert.equal(r.sourceUpdatedAt,'2024-08-03T02:53:06.000Z');assert.equal(r.players['mlb:641680'].stats.batting_hits,null);assert.equal(r.players['mlb:641680'].participated,null);
});
test('moneylines, both spread sides, zero lines, totals and pushes use explicit scores',()=>{
 for(const [marketType,side,line,outcome,value] of [['moneyline','HOME',null,'WIN',27],['moneyline','AWAY',null,'LOSS',20],['spread','HOME',-7,'PUSH',20],['spread','AWAY',7,'PUSH',27],['spread','HOME',0,'WIN',27],['spread','AWAY',0,'LOSS',20],['total','OVER',46,'WIN',47],['total','UNDER',48,'WIN',47],['total','OVER',47,'PUSH',47],['total','UNDER',47,'PUSH',47]]){let s=grade({marketType,side,line});assert.equal(s.outcome,outcome);assert.equal(s.actualValue,value);}
});
test('missing/null/blank/boolean/nonfinite scores and lines never become zero',()=>{
 for(const value of [null,undefined,'',true,NaN,Infinity,'9'.repeat(400)]){assert.equal(grade({marketType:'total',side:'OVER',line:value}).outcome,'UNRESOLVED');assert.equal(grade({}, {...result('NFL'),homeScore:value}).outcome,'UNRESOLVED');assert.equal(grade({marketType:'player_passing_yards',side:'OVER',line:value,playerKey:'espn:nfl:3916387',sourceIds:{provider:'espn',event:'401671789',player:'3916387'}}).outcome,'UNRESOLVED');}
});
test('NFL verified passing, rushing and receiving stat fields grade exactly',()=>{
 for(const [id,stat,value] of [['3916387','passing_yards',273],['3916387','passing_touchdowns',1],['3916387','rushing_yards',122],['3916387','rushing_touchdowns',0],['4361050','receiving_yards',111],['4361050','receiving_receptions',9],['4361050','receiving_touchdowns',1]]){const s=grade({playerKey:`espn:nfl:${id}`,sourceIds:{provider:'espn',event:'401671789',player:id},marketType:`player_${stat}`,side:'OVER',line:value});assert.equal(s.actualValue,value);assert.equal(s.outcome,'PUSH');}
});
test('NBA verified counting fields and composite values grade without guessing missing components',()=>{
 const r=result('NBA');const id='4278049'; const p={sport:'NBA',eventKey:r.eventKey,sourceIds:{provider:'espn',event:'401705278',player:id},playerKey:`espn:nba:${id}`,side:'OVER'};
 for(const [stat,value] of [['points',12],['rebounds',6],['assists',0],['steals',0],['blocks',2],['turnovers',1],['three_pointers',0],['points_rebounds_assists',18],['points_rebounds',18],['points_assists',12],['rebounds_assists',6]]){const s=grade({...p,marketType:`player_${stat}`,line:value},r);assert.equal(s.actualValue,value);assert.equal(s.outcome,'PUSH');}
 const missing=structuredClone(r);missing.players[p.playerKey].stats.assists=null;assert.equal(grade({...p,marketType:'player_points_rebounds_assists',line:1},missing).outcome,'UNRESOLVED');
});
test('MLB tested prop fields grade using recorded game values',()=>{
 const r=result('MLB'); for(const stat of ['batting_hits','batting_totalBases','batting_homeRuns','batting_runs','batting_rbi','pitching_strikeOuts']){const player=Object.values(r.players).find(p=>p.stats[stat]!==null);assert.ok(player,stat);let s=grade({sport:'MLB',eventKey:r.eventKey,sourceIds:{provider:'mlb-statsapi',event:'744986',player:player.sourcePlayerId},playerKey:player.playerKey,marketType:`player_${stat}`,side:'UNDER',line:player.stats[stat],settlementRule:{...rule,period:'FULL_GAME'}},r);assert.equal(s.outcome,'PUSH');assert.equal(s.actualValue,player.stats[stat]);}
});
test('missing player stats are unresolved, distinct from an explicit zero',()=>{
 const r=result('NFL'),p={playerKey:'espn:nfl:3916387',sourceIds:{provider:'espn',event:'401671789',player:'3916387'},marketType:'player_receiving_yards',side:'UNDER',line:.5};assert.equal(grade(p,r).outcome,'UNRESOLVED');r.players[p.playerKey].stats.receiving_yards=0;assert.equal(grade(p,r).outcome,'WIN');
});
test('only authoritative explicit nonparticipant with saved VOID rule can void',()=>{
 const r=result('NBA'),entry=Object.values(r.players).find(p=>p.participated===false);assert.ok(entry);const p={sport:'NBA',eventKey:r.eventKey,sourceIds:{provider:'espn',event:r.sourceEventId,player:entry.sourcePlayerId},playerKey:entry.playerKey,marketType:'player_points',side:'OVER',line:.5};assert.equal(grade(p,r).outcome,'VOID');assert.equal(grade({...p,settlementRule:{...rule,nonparticipant:'UNRESOLVED'}},r).outcome,'UNRESOLVED');assert.equal(grade({...p,playerKey:'missing'},r).outcome,'UNRESOLVED');
});
test('cancelled can void only by explicit rule; postponed/live/unknown cannot grade',()=>{
 for(const status of ['POSTPONED','LIVE','UNKNOWN']) assert.equal(grade({}, {...result('NFL'),status}).outcome,'UNRESOLVED');assert.equal(grade({}, {...result('NFL'),status:'CANCELLED'}).outcome,'VOID');assert.equal(grade({settlementRule:{...rule,cancelled:null}}, {...result('NFL'),status:'CANCELLED'}).outcome,'UNRESOLVED');
});
test('regulation ties and overtime scores use saved period and tie policies',()=>{
 const r={...result('NFL'),homeScore:30,awayScore:27,regulationScores:{home:27,away:27},overtime:true};assert.equal(grade({},r).outcome,'WIN');assert.equal(grade({settlementRule:{...rule,period:'REGULATION'}},r).outcome,'PUSH');assert.equal(grade({settlementRule:{...rule,period:'REGULATION',tie:'VOID'}},r).outcome,'VOID');assert.equal(grade({settlementRule:{...rule,period:'REGULATION',tie:null}},r).outcome,'UNRESOLVED');assert.equal(grade({marketType:'total',side:'OVER',line:55,settlementRule:{...rule,period:'REGULATION'}},r).outcome,'LOSS');
});
test('regulation player stats cannot use full game overtime boxscore',()=>{
 assert.equal(grade({playerKey:'espn:nfl:3916387',sourceIds:{provider:'espn',event:'401671789',player:'3916387'},marketType:'player_passing_yards',side:'OVER',line:1,settlementRule:{...rule,period:'REGULATION'}},{...result('NFL'),overtime:true}).outcome,'UNRESOLVED');
});
test('shortened MLB finals require explicit policy and minimum innings',()=>{
 const r={...result('MLB'),shortened:true,completedPeriods:5};const p={sport:'MLB',eventKey:r.eventKey,sourceIds:{provider:'mlb-statsapi',event:'744986'},settlementRule:{...rule,period:'FULL_GAME'}};assert.equal(grade(p,r).outcome,'UNRESOLVED');assert.equal(grade({...p,settlementRule:{...p.settlementRule,shortened:'VOID'}},r).outcome,'VOID');assert.equal(grade({...p,settlementRule:{...p.settlementRule,shortened:'ACTION',minimumPeriods:5}},r).outcome,'LOSS');assert.equal(grade({...p,settlementRule:{...p.settlementRule,shortened:'ACTION',minimumPeriods:9}},r).outcome,'UNRESOLVED');
});
test('exact provider/event/player IDs required; ambiguity and conflicting IDs unresolved',()=>{
 for(const p of [{eventKey:'wrong'},{sport:'NBA'},{sourceIds:{provider:'other',event:'401671789'}},{sourceIds:{provider:'espn',event:'wrong'}},{provenance:{identityAmbiguous:true}}])assert.equal(grade(p).outcome,'UNRESOLVED');const r=result('NFL');r.identityAmbiguous=true;assert.equal(grade({},r).outcome,'UNRESOLVED');assert.equal(grade({marketType:'player_passing_yards',playerKey:'espn:nfl:3916387',sourceIds:{provider:'espn',event:'401671789',player:'3139477'},side:'OVER',line:1}).outcome,'UNRESOLVED');
});
test('unknown sport/market/appearance/period/rule combinations stay unresolved',()=>{
 for(const p of [{sport:'NHL'},{sport:'TENNIS'},{sport:'SOCCER'},{marketType:'player_unknown'},{settlementRule:{version:'v1'}},{settlementRule:{...rule,period:'FIRST_HALF'}},{settlementRule:{...rule,appearance:'STARTER'}}])assert.equal(grade(p).outcome,'UNRESOLVED');
});
test('correction source revision changes; retrieval time does not create revision',()=>{
 const f=fixture('NFL'),a=result('NFL');const same=normalizeFinalResult(f.payload,{sport:'NFL',source:'espn',retrievedAt:'2026-10-07T00:00:00Z'});assert.equal(a.sourceRevision,same.sourceRevision);f.payload.header.competitions[0].competitors[0].score='19';const corrected=normalizeFinalResult(f.payload,{sport:'NFL',source:'espn'});assert.notEqual(a.sourceRevision,corrected.sourceRevision);assert.equal(grade({},corrected).outcome,'LOSS');assert.equal(grade({}).outcome,'WIN');assert.equal(grade({},corrected).sourceRevision,corrected.sourceRevision);
});
test('ESPN malformed status, duplicate competitors and duplicate stat keys are not authoritative',()=>{
 const f=fixture('NFL'); f.payload.header.competitions[0].status.type.completed=false;assert.equal(normalizeFinalResult(f.payload,{sport:'NFL',source:'espn'}).status,'UNKNOWN');f.payload.header.competitions[0].competitors.push(f.payload.header.competitions[0].competitors[0]);assert.equal(normalizeFinalResult(f.payload,{sport:'NFL',source:'espn'}).identityAmbiguous,true);
 const g=fixture('NFL');g.payload.boxscore.players[0].statistics[0].keys[2]='passingYards';const r=normalizeFinalResult(g.payload,{sport:'NFL',source:'espn'});assert.equal(grade({playerKey:'espn:nfl:3916387',sourceIds:{provider:'espn',event:'401671789',player:'3916387'},marketType:'player_passing_yards',side:'OVER',line:1},r).outcome,'UNRESOLVED');
});
test('unverified new sport adapters remain unavailable',()=>{
 for(const sport of ['NHL','SOCCER','TENNIS'])assert.equal(normalizeFinalResult(fixture('NFL').payload,{sport,source:'espn'}).status,'UNKNOWN');
});
test('legacy MLB pitching_strikeouts stat maps the exact strikeOuts field',()=>{
 const r=result('MLB'),player=Object.values(r.players).find(p=>p.stats.pitching_strikeOuts!==null);assert.equal(grade({sport:'MLB',eventKey:r.eventKey,sourceIds:{provider:'mlb-statsapi',event:r.sourceEventId,player:player.sourcePlayerId},playerKey:player.playerKey,marketType:'player_pitching_strikeouts',side:'OVER',line:player.stats.pitching_strikeOuts,settlementRule:{...rule,period:'FULL_GAME'}},r).outcome,'PUSH');
});
test('saved policy is bound to exact captured book',()=>{
 for(const book of [null,'other-book'])assert.equal(grade({book}).outcome,'UNRESOLVED');assert.equal(grade({settlementRule:{...rule,book:null}}).outcome,'UNRESOLVED');
});
test('zero event/player IDs and malformed count stats cannot become settleable',()=>{
 const f=fixture('NBA');f.payload.header.id='0';f.payload.header.competitions[0].id='0';assert.equal(normalizeFinalResult(f.payload,{sport:'NBA',source:'espn'}).eventKey,null);
 const g=fixture('NBA'),group=g.payload.boxscore.players[0].statistics[0],row=group.athletes[0];row.stats[group.keys.indexOf('points')]='-1';const r=normalizeFinalResult(g.payload,{sport:'NBA',source:'espn'});assert.equal(r.players['espn:nba:'+row.athlete.id].stats.points,null);row.stats[group.keys.indexOf('points')]='1.5';assert.equal(normalizeFinalResult(g.payload,{sport:'NBA',source:'espn'}).players['espn:nba:'+row.athlete.id].stats.points,null);
});
test('duplicate NBA three pointer stat keys cannot grade as a real zero',()=>{
 const g=fixture('NBA'),group=g.payload.boxscore.players[0].statistics[0],row=group.athletes[0];group.keys[group.keys.length-1]='threePointFieldGoalsMade-threePointFieldGoalsAttempted';const r=normalizeFinalResult(g.payload,{sport:'NBA',source:'espn'});assert.equal(r.players['espn:nba:'+row.athlete.id].stats.three_pointers,null);
});
test('CFB result-only verified schema uses distinct provider IDs and never creates a prediction',()=>{
 const r=result('CFB');assert.equal(r.eventKey,'espn:cfb:401628334');assert.equal(r.status,'FINAL');assert.equal(r.awayScore,27);assert.equal(r.homeScore,20);assert.equal(r.players['espn:cfb:4431580'].stats.passing_yards,378);
 const p={sport:'CFB',eventKey:r.eventKey,sourceIds:{provider:'espn',event:r.sourceEventId}};assert.equal(grade(p,r).outcome,'LOSS');assert.equal(grade({...p,playerKey:'espn:cfb:4431580',sourceIds:{...p.sourceIds,player:'4431580'},marketType:'player_passing_yards',side:'OVER',line:378},r).outcome,'PUSH');assert.equal(r.modelAvailable,undefined);
});
test('MLB reached inning does not falsely imply a completed full inning in a shortened final',()=>{
 const f=fixture('MLB');Object.assign(f.payload.liveData.linescore,{currentInning:5,inningState:'Top',outs:3});const r=normalizeFinalResult(f.payload,{sport:'MLB',source:'mlb-statsapi'});assert.equal(r.completedPeriods,4);assert.equal(r.shortened,true);assert.equal(grade({sport:'MLB',eventKey:r.eventKey,sourceIds:{provider:'mlb-statsapi',event:r.sourceEventId},settlementRule:{...rule,period:'FULL_GAME',shortened:'ACTION',minimumPeriods:5}},r).outcome,'UNRESOLVED');f.payload.liveData.linescore.inningState='Bottom';assert.equal(normalizeFinalResult(f.payload,{sport:'MLB',source:'mlb-statsapi'}).completedPeriods,5);
});
test('malformed indexed stat containers and passing opportunities normalize unknown without throwing',()=>{
 const f=fixture('NFL'),g=f.payload.boxscore.players[0].statistics[0];g.athletes[0].stats[0]=26;assert.doesNotThrow(()=>normalizeFinalResult(f.payload,{sport:'NFL',source:'espn'}));
 const n=fixture('NBA');n.payload.boxscore.players[0].statistics[0].keys={points:0};assert.doesNotThrow(()=>normalizeFinalResult(n.payload,{sport:'NBA',source:'espn'}));assert.equal(normalizeFinalResult(n.payload,{sport:'NBA',source:'espn'}).players['espn:nba:4278049'].stats.points,null);
});
test('null/HTML/malformed provider payloads remain unknown without throwing',()=>{
 for(const sport of ['MLB','NBA','NFL'])for(const payload of [null,undefined,'<html>timeout</html>',[],{}, {header:{id:'1',competitions:[null]}}]){const r=normalizeFinalResult(payload,{sport,source:sport==='MLB'?'mlb-statsapi':'espn'});assert.equal(r.status,'UNKNOWN');}
 const f=fixture('NFL');f.payload.header.competitions[0].competitors[0].linescores[0]=null;assert.doesNotThrow(()=>normalizeFinalResult(f.payload,{sport:'NFL',source:'espn'}));assert.equal(normalizeFinalResult(f.payload,{sport:'NFL',source:'espn'}).shortened,null);
});
test('unverified provider and missing duration facts never settle even if caller IDs agree',()=>{
 const r=result('NFL');assert.equal(grade({}, {...r,shortened:undefined}).outcome,'UNRESOLVED');assert.equal(grade({sourceIds:{provider:'unverified',event:r.sourceEventId}}, {...r,source:'unverified'}).outcome,'UNRESOLVED');
});
test('provider league identity prevents cross-sport relabeling and MLB side swaps',()=>{
 const f=fixture('NFL');assert.equal(normalizeFinalResult(f.payload,{sport:'NBA',source:'espn'}).status,'UNKNOWN');delete f.payload.header.league;assert.equal(normalizeFinalResult(f.payload,{sport:'NFL',source:'espn'}).status,'UNKNOWN');
 const m=fixture('MLB');m.payload.gameData.teams.home.sport.id=11;assert.equal(normalizeFinalResult(m.payload,{sport:'MLB',source:'mlb-statsapi'}).status,'UNKNOWN');const swapped=fixture('MLB');swapped.payload.liveData.boxscore.teams.home.team.id=111;assert.equal(normalizeFinalResult(swapped.payload,{sport:'MLB',source:'mlb-statsapi'}).identityAmbiguous,true);
});
const mlbDurationResult = change => {const f=fixture('MLB');Object.assign(f.payload.liveData.linescore,change);return normalizeFinalResult(f.payload,{sport:'MLB',source:'mlb-statsapi'});};
const mlbDurationGrade = (r,policy='VOID') => grade({sport:'MLB',eventKey:r.eventKey,sourceIds:{provider:'mlb-statsapi',event:r.sourceEventId},marketType:'total',side:'OVER',line:10,settlementRule:{...rule,period:'FULL_GAME',shortened:policy,minimumPeriods:9}},r);
test('interrupted scheduled final inning obeys shortened VOID and ACTION policies',()=>{
 for(const [inningState,outs] of [['Top',1],['Top',3],['Middle',3],['Bottom',1]]){const r=mlbDurationResult({currentInning:9,scheduledInnings:9,inningState,outs});assert.equal(r.shortened,true);assert.equal(mlbDurationGrade(r).outcome,'VOID');assert.equal(mlbDurationGrade(r,'ACTION').outcome,'UNRESOLVED');}
});
test('missing or invalid MLB duration evidence stays unresolved instead of proving full duration',()=>{
 for(const change of [{outs:null},{outs:undefined},{outs:4},{outs:-1},{outs:1.5},{outs:true},{inningState:null},{inningState:undefined},{inningState:'unknown'},{inningState:'Middle',outs:0},{inningState:'End',outs:1},{currentInning:null},{scheduledInnings:null},{inningState:'Top',outs:3,teams:{home:{runs:null},away:{runs:6}}},{inningState:'Bottom',outs:1,teams:{home:{runs:11},away:{runs:null}}}]){const r=mlbDurationResult(change);assert.equal(r.shortened,null,JSON.stringify(change));assert.equal(mlbDurationGrade(r).outcome,'UNRESOLVED');}
});
test('completed away wins, skipped home bottom halves and home walkoffs preserve full-game grading',()=>{
 for(const [inningState,outs,home,away] of [['Bottom',3,6,11],['End',3,6,11],['Top',3,11,6],['Middle',3,11,6],['Bottom',0,11,6],['Bottom',1,11,6],['Bottom',2,11,6]]){const r=mlbDurationResult({currentInning:9,scheduledInnings:9,inningState,outs,teams:{home:{runs:home},away:{runs:away}}});assert.equal(r.shortened,false,JSON.stringify([inningState,outs]));assert.equal(mlbDurationGrade(r).outcome,'WIN');}
 const interruptedTop=mlbDurationResult({currentInning:9,scheduledInnings:9,inningState:'Top',outs:1,teams:{home:{runs:11},away:{runs:6}}});assert.equal(interruptedTop.shortened,true);assert.equal(mlbDurationGrade(interruptedTop).outcome,'VOID');
});
