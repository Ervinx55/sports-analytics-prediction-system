import test from 'node:test';
import assert from 'node:assert/strict';
import {groupLiveDecisions,groupLiveCards} from '../../sharp-service/nba-live.js';

const now=Date.parse('2026-11-27T17:00:00Z');
const at=offset=>new Date(now+offset).toISOString();
const implied=odds=>odds>0?100/(100+odds):-odds/(100-odds);
const fair=(odds,opposite)=>implied(odds)/(implied(odds)+implied(opposite));
function row(patch={}){
 return {contract:'nba-reviewed-live-v1',sport:'NBA',eventID:'sgo:fixture',playerID:'DERRICK_WHITE_1_NBA',
  startsAt:at(3600000),market:'rebounds',side:'OVER',line:3.5,book:'draftkings',odds:-110,oppositeOdds:-110,
  quoteAt:at(0),oppositeQuoteAt:at(0),issuedAt:at(0),forecastAt:at(0),validUntil:at(300000),
  status:'PLAY',productionEligible:true,productionWeight:1,approvalId:'reviewed',reasons:[],
  modelHash:'minutes-hash',validationProtocol:'minutes-v1',modelProbability:.6,marketProbability:.5,
  decisionId:'current',...patch};
}
const body=rows=>({contract:'nba-reviewed-live-v1',generatedAt:at(0),decisions:rows});
const groups=rows=>groupLiveDecisions(body(rows),now);

test('identical duplicate observations render once and source records remain unchanged',()=>{
 const record=row(),data=body([record,structuredClone(record),structuredClone(record)]),before=JSON.stringify(data);
 const result=groupLiveDecisions(data,now);
 assert.equal(result.length,1);assert.equal(result[0].rows.length,1);assert.equal(result[0].latest.length,1);
 assert.equal(result[0].status,'BUY');assert.equal(JSON.stringify(data),before);
});

test('a changed price replaces the old snapshot in one selection and retains its history',()=>{
 const old=row({decisionId:'old',issuedAt:at(-2000),quoteAt:at(-2500),oppositeQuoteAt:at(-2500)});
 const current=row({odds:-120,marketProbability:fair(-120,-110)});
 const [group]=groups([old,current]);assert.equal(groups([old,current]).length,1);
 assert.equal(group.representative,current);assert.equal(group.representative.odds,-120);
 assert.equal(group.latest.length,1);assert.equal(group.rows.length,2);
 assert.equal(group.current.has(old),false);assert.equal(group.current.has(current),true);
});

test('latest unavailable quote never resurrects an earlier available BUY',()=>{
 const old=row({decisionId:'old',issuedAt:at(-2000),quoteAt:at(-2500),oppositeQuoteAt:at(-2500)});
 const unavailable=row({status:'PASS',available:false,odds:null,productionEligible:false,productionWeight:0,approvalId:null});
 const [group]=groups([old,unavailable]);
 assert.equal(group.representative.available,false);assert.equal(group.current.size,0);
 assert.notEqual(group.status,'BUY');assert.equal(group.rows.length,2);
});

test('later evaluation of an older quote cannot hide a newer unavailable quote from another model',()=>{
 const unavailable=row({modelHash:'baseline-hash',validationProtocol:'baseline-v1',decisionId:'newer-quote',
  quoteAt:at(-1000),oppositeQuoteAt:at(-1000),issuedAt:at(-900),available:false,status:'PASS',
  odds:null,productionEligible:false,productionWeight:0,approvalId:null});
 const laterEvaluation=row({decisionId:'older-quote-later-evaluation',quoteAt:at(-5000),oppositeQuoteAt:at(-5000),issuedAt:at(0)});
 const [group]=groups([unavailable,laterEvaluation]);
 assert.equal(group.representative,unavailable);assert.equal(group.representative.available,false);
 assert.equal(group.current.size,0);assert.notEqual(group.status,'BUY');
 assert.equal(group.latest.length,2,'each model evaluation remains available in details');
});

test('contradictory simultaneous prices suppress BUY regardless of input order',()=>{
 const a=row(),b=row({decisionId:'conflicting-price',odds:-120,marketProbability:fair(-120,-110)});
 for(const records of [[a,b],[b,a]]){
  const [group]=groups(records);assert.equal(group.conflicting,true);assert.equal(group.current.size,0);
  assert.equal(group.status,'UNVERIFIED');assert.equal(group.rows.length,2);
 }
});

test('contradictory simultaneous decisions for one model cannot choose a favorable status',()=>{
 const buy=row(),pass=row({decisionId:'same-instant-pass',status:'PASS',productionEligible:false,productionWeight:0,approvalId:null});
 for(const records of [[buy,pass],[pass,buy]]){
  const [group]=groups(records);assert.equal(group.conflicting,true);assert.equal(group.current.size,0);
  assert.equal(group.status,'UNVERIFIED');
 }
});

test('newer rejection supersedes the previous BUY while retaining its original status in history',()=>{
 const old=row({decisionId:'old',issuedAt:at(-1000)}),pass=row({status:'PASS',productionEligible:false,productionWeight:0,approvalId:null,reasons:['MODEL_NOT_APPROVED']});
 const [group]=groups([old,pass]);assert.equal(group.status,'AVOID');assert.equal(group.current.size,0);
 assert.deepEqual(group.latest,[pass]);assert.equal(old.status,'PLAY');assert.ok(group.rows.includes(old));
});

test('distinct model protocols and versions stay separate within one exact selection',()=>{
 const records=[row(),row({modelHash:'baseline-hash',validationProtocol:'baseline-v1'}),row({validationProtocol:'minutes-v2'})];
 const [group]=groups(records);assert.equal(group.rows.length,3);assert.equal(group.latest.length,3);
 assert.equal(groupLiveCards([group]).length,1);
});

test('sides, books and alternate lines stay distinct selections under one player market',()=>{
 const records=[row(),row({side:'UNDER'}),row({book:'fanduel'}),row({line:4.5}),row({line:0})];
 const selections=groups(records),cards=groupLiveCards(selections);
 assert.equal(selections.length,5);assert.equal(cards.length,1);assert.equal(cards[0].selections.length,5);
 assert.deepEqual(new Set(selections.map(group=>group.representative.line)),new Set([0,3.5,4.5]));
});

test('sport, event, scheduled start, subject, market and explicit periods keep distinct cards',()=>{
 const patches=[{}, {sport:'WNBA'}, {eventID:'other'}, {startsAt:at(7200000)}, {playerID:'PAYTON_PRITCHARD_1_NBA'},
  {market:'assists'}, {marketScope:'FIRST_HALF'}, {periodID:'1q'}, {period:'2q'}];
 const result=groups(patches.map(patch=>row(patch)));
 assert.equal(result.length,patches.length);assert.equal(groupLiveCards(result).length,patches.length);
});

test('malformed explicit periods cannot silently become verified full-game selections',()=>{
 for(const scope of [123,{},[],true]){
  const [group]=groups([row({marketScope:scope})]);
  assert.equal(group.exact,false,JSON.stringify(scope));assert.equal(group.current.size,0);
  assert.equal(group.status,'UNVERIFIED');
 }
});

test('unidentified records do not collide with each other or clear a BUY',()=>{
 for(const patch of [{eventID:null},{playerID:null},{startsAt:null},{market:null},{book:null},{side:'INVALID'},{line:'3.5'}]){
  const result=groups([row(patch),row({...patch,decisionId:'other'})]);
  assert.equal(result.length,2);assert.ok(result.every(group=>!group.exact&&group.current.size===0&&group.status==='UNVERIFIED'));
 }
 assert.deepEqual(groups([null,undefined,[],false,'bad record']),[]);
});

test('expired verification, decision, price, forecast or pregame window cannot remain BUY',()=>{
 for(const patch of [{validUntil:at(0)},{startsAt:at(0)},{issuedAt:at(-600000)},
  {quoteAt:at(-600000)},{oppositeQuoteAt:at(-600000)},{forecastAt:at(-600000)},
  {quoteAt:at(1)},{available:false},{approvalId:null},{productionWeight:0},{modelProbability:'0.6'}]){
  const [group]=groups([row(patch)]);assert.equal(group.current.size,0,JSON.stringify(patch));assert.notEqual(group.status,'BUY');
 }
 for(const generatedAt of [at(-30000),at(1),null,'invalid']){
  const [group]=groupLiveDecisions({...body([row()]),generatedAt},now);
  assert.equal(group.status,'UNVERIFIED');assert.equal(group.current.size,0);
 }
});
