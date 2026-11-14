import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEspnGame, normalizeSgoGame, reconcileGames, reconcileUpcomingGames, parseMembership, validateSchedule} from '../../sharp-service/lib/cfb-sources.js';
const at='2026-11-14T15:00:00Z';
const espn=(extra={})=>({id:'e1',date:'2026-11-07T17:00:00Z',season:{year:2026},competitions:[{neutralSite:false,status:{type:{completed:true}},competitors:[{homeAway:'home',team:{id:'1',displayName:'Home Hawks',location:'Home'},score:'20'},{homeAway:'away',team:{id:'2',displayName:'Away Eagles',location:'Away'},score:'14'}]}],...extra});
const sgo=()=>({eventID:'s1',leagueID:'NCAAF',status:{startsAt:'2026-11-07T17:00:00Z',finalized:true},teams:{home:{teamID:'HOME_NCAAF',names:{long:'Home Hawks',medium:'Home'},score:20},away:{teamID:'AWAY_NCAAF',names:{long:'Away Eagles',medium:'Away'},score:14}}});
test('CFB normalizes explicit results and rejects missing/invalid scores',()=>{
 const a=normalizeEspnGame(espn(),at);assert.equal(a.homeScore,20);assert.equal(a.neutralSite,false);assert.equal(a.homeID,'1');
 const e=espn();e.competitions[0].competitors[0].score='';assert.equal(normalizeEspnGame(e,at).homeScore,null);
 e.competitions[0].neutralSite=undefined;assert.equal(normalizeEspnGame(e,at).neutralSite,null);
 const s=sgo();s.teams.home.score=false;assert.equal(normalizeSgoGame(s,at).homeScore,null);
});
test('CFB reconciliation needs unique both-team/time match and agreeing final scores',()=>{
 const a=normalizeEspnGame(espn(),at),b=normalizeSgoGame(sgo(),at);
 assert.equal(reconcileGames([b],[a]).matched.length,1);
 assert.equal(reconcileGames([b],[a,{...a,id:'e2'}]).matched.length,0);
 assert.equal(reconcileGames([{...b,homeScore:21}],[a]).conflicts.length,1);
 assert.equal(reconcileGames([{...b,startsAt:'2026-11-08T17:00:00Z'}],[a]).matched.length,0);
});
test('CFB reviewed App State identity requires the exact season and both provider team IDs',()=>{
 const a={id:'PR29AtWAUYhuiYBmURmf',league:'NCAAF',season:2026,startsAt:'2026-11-14T23:00Z',homeID:'MARSHALL_NCAAF',awayID:'APPALACHIAN_STATE_NCAAF',homeAliases:['Marshall'],awayAliases:['Appalachian State']};
 const b={id:'401869928',season:2026,startsAt:a.startsAt,homeID:'276',awayID:'2026',homeAliases:['Marshall'],awayAliases:['App State']};
 assert.equal(reconcileGames([a],[b]).matched.length,1);
 for(const patch of [{awayID:'other'},{season:2025},{awayAliases:['Arkansas State']},{startsAt:'2026-11-14T21:00Z'}])assert.equal(reconcileGames([{...a,...patch}],[b]).matched.length,0);
 assert.equal(reconcileGames([a],[{...b,awayID:'other'}]).matched.length,0);
});
test('CFB exact reviewed Hawaii kickoff permits research but preserves the conflicting provider time',()=>{
 const a={id:'BKBP22DuBmOzmKmFX6FO',league:'NCAAF',season:2026,startsAt:'2026-11-15T03:00:00Z',homeID:'HAWAII_NCAAF',awayID:'NORTH_DAKOTA_STATE_NCAAF',homeAliases:["Hawai'i"],awayAliases:['North Dakota State']};
 const b={id:'401864537',season:2026,startsAt:'2026-11-15T04:00:00Z',homeID:'62',awayID:'2449',homeAliases:["Hawai'i"],awayAliases:['North Dakota State']};
 const result=reconcileGames([a],[b]).matched[0];assert.ok(result);assert.equal(result.startsAt,b.startsAt);assert.equal(result.providerStartsAt,a.startsAt);assert.equal(result.quoteComparisonEligible,false);assert.equal(result.scheduleVerification.sources.length,2);
 assert.equal(a.startsAt,'2026-11-15T03:00:00Z');
 for(const patch of [{id:'other'},{homeID:'other'},{startsAt:'2026-11-15T02:00Z'},{season:2025}])assert.equal(reconcileGames([{...a,...patch}],[b]).matched.length,0);
 assert.equal(reconcileGames([a],[{...b,startsAt:'2026-11-15T05:00Z'}]).matched.length,0);
 assert.equal(reconcileGames([{...a,startsAt:b.startsAt}],[b]).matched[0].quoteComparisonEligible,true);
 for(const time of ['2026-11-15T03:15Z','2026-11-15T03:45Z'])assert.equal(reconcileUpcomingGames([a],[b],Date.parse(time)).matched.length,1);
 assert.equal(reconcileUpcomingGames([a],[b],Date.parse('2026-11-15T04:00Z')).matched.length,0);
});
test('CFB membership verifies season, URL authority, count and completeness',()=>{
 const ref='http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/teams/1';
 assert.deepEqual(parseMembership({count:1,pageCount:1,items:[{$ref:ref}]},2026),['1']);
 assert.throws(()=>parseMembership({count:2,pageCount:2,items:[{$ref:ref}]},2026));
 assert.throws(()=>parseMembership({count:1,pageCount:1,items:[{$ref:ref}]},2025));
 assert.throws(()=>parseMembership({count:1,pageCount:1,items:[{$ref:ref.replace('sports.core.api.espn.com','evil.example')}]},2026));
});
test('CFB schedules require requested team and season, preserve postseason and reject duplicates',()=>{
 const payload={team:{id:'1'},requestedSeason:2026,events:[espn()]};
 assert.equal(validateSchedule(payload,'1',2026,at).games.length,1);
 assert.throws(()=>validateSchedule(payload,'9',2026,at));
 assert.throws(()=>validateSchedule({...payload,events:[espn(),espn()]},'1',2026,at));
 assert.throws(()=>validateSchedule({...payload,events:[espn({season:{year:2025}})]},'1',2026,at));
});
