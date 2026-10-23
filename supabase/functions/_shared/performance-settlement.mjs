import {gradeMarket} from './team-market-grading.mjs';
import {RESULT_STATS,resultNumber} from './performance-result-sources.mjs';
const text=v=>typeof v==='string'&&v.trim() ? v : null;
/** Pure grading. Worker allocates append-only revision/supersedesRevision and settledAt, never this function. */
export function settlePrediction(p,r) {
 const rule=p?.settlementRule;
 const s={predictionId:p?.id??null,revision:null,supersedesRevision:null,outcome:'UNRESOLVED',actualValue:null,awayScore:r?.awayScore??null,homeScore:r?.homeScore??null,source:r?.source??null,sourceUpdatedAt:r?.sourceUpdatedAt??null,sourceRevision:r?.sourceRevision??null,retrievedAt:r?.retrievedAt??null,settledAt:null,ruleVersion:rule?.version??null,reason:null};
 const unresolved=reason=>({...s,reason}),voided=reason=>({...s,outcome:'VOID',reason});
 if(!r||!p||!RESULT_STATS[p.sport])return unresolved('UNSUPPORTED_SPORT');
 if(r.source!==(p.sport==='MLB'?'mlb-statsapi':'espn'))return unresolved('UNSUPPORTED_RESULT_SOURCE');
 if(r.identityAmbiguous===true||p.provenance?.identityAmbiguous===true)return unresolved('AMBIGUOUS_IDENTITY');
 if(!text(p.eventKey)||p.eventKey!==r.eventKey||p.sport!==r.sport||!text(p.sourceIds?.event)||p.sourceIds.event!==r.sourceEventId||p.sourceIds.provider!==r.source)return unresolved('IDENTITY_MISMATCH');
 const prop=typeof p.marketType==='string'&&p.marketType.startsWith('player_'),stat=prop?p.marketType.slice(7):null;
 if(prop?!RESULT_STATS[p.sport].includes(stat):!['moneyline','spread','total'].includes(p.marketType))return unresolved('UNSUPPORTED_MARKET');
 const side=typeof p.side==='string'?p.side.toLowerCase():null;
 if(!(prop||p.marketType==='total'?['over','under']:['home','away']).includes(side))return unresolved('INVALID_SIDE');
 const line=resultNumber(p.line);if(p.marketType!=='moneyline'&&line===null)return unresolved('MISSING_LINE');
 // These are explicit policy tokens, not bookmaker defaults. Save authoritative book policy at capture.
 if(!text(rule?.version)||!text(p.book)||rule.book!==p.book||!['PUSH','VOID','UNRESOLVED'].includes(rule.tie)||!['VOID','UNRESOLVED'].includes(rule.cancelled)||!['VOID','UNRESOLVED','ACTION'].includes(rule.shortened)||!['VOID','UNRESOLVED'].includes(rule.nonparticipant)||rule.appearance!=='ANY_APPEARANCE'||!(p.sport==='MLB'?['FULL_GAME']:['REGULATION','INCLUDING_OVERTIME']).includes(rule.period))return unresolved('UNKNOWN_SETTLEMENT_RULE');
 let player;
 if(prop) {
   player=r.players?.[p.playerKey];
   if(!text(p.playerKey)||!text(p.sourceIds?.player)||!player||player.playerKey!==p.playerKey||player.sourcePlayerId!==p.sourceIds.player)return unresolved('PLAYER_IDENTITY_MISMATCH');
   if(player.ambiguous===true)return unresolved('AMBIGUOUS_PLAYER_IDENTITY');
 }
 if(r.status==='CANCELLED')return rule.cancelled==='VOID'?voided('CANCELLED'):unresolved('CANCELLATION_POLICY');
 if(r.status!=='FINAL')return unresolved('NOT_FINAL');
 if(typeof r.shortened!=='boolean')return unresolved('UNKNOWN_EVENT_DURATION');
 if(r.shortened===true) {
   if(rule.shortened==='VOID')return voided('SHORTENED_EVENT');
   if(rule.shortened!=='ACTION'||!Number.isSafeInteger(rule.minimumPeriods)||rule.minimumPeriods<=0||!Number.isSafeInteger(r.completedPeriods)||r.completedPeriods<rule.minimumPeriods)return unresolved('SHORTENED_POLICY');
 }
 if(prop) {
   if(player.participated===false)return rule.nonparticipant==='VOID'?voided('NONPARTICIPANT'):unresolved('NONPARTICIPANT_POLICY');
   if(player.participated!==true)return unresolved('UNKNOWN_PARTICIPATION');
   if(rule.period==='REGULATION'&&r.overtime!==false)return unresolved('REGULATION_STAT_UNAVAILABLE');
   const components={points_rebounds_assists:['points','rebounds','assists'],points_rebounds:['points','rebounds'],points_assists:['points','assists'],rebounds_assists:['rebounds','assists']}[stat];
   let actual=resultNumber(player.stats?.[stat]);
   if(components)actual=components.every(k=>resultNumber(player.stats?.[k])!==null)?components.reduce((n,k)=>n+resultNumber(player.stats[k]),0):null;
   if(actual===null)return unresolved('MISSING_STAT');
   const diff=side==='over'?actual-line:line-actual;
   return {...s,actualValue:actual,outcome:diff===0?'PUSH':diff>0?'WIN':'LOSS'};
 }
 const scores=rule.period==='REGULATION'?r.regulationScores:{home:r.homeScore,away:r.awayScore};
 if(!scores||![scores.home,scores.away].every(v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0))return unresolved('MISSING_SCORE');
 s.homeScore=scores.home;s.awayScore=scores.away;
 if(p.marketType==='moneyline'&&scores.home===scores.away){if(rule.tie==='VOID')return voided('TIED_MONEYLINE');if(rule.tie!=='PUSH')return unresolved('TIE_POLICY');}
 const graded=gradeMarket({market_type:p.marketType,market_side:side,line},scores.away,scores.home);
 return graded?{...s,actualValue:graded.actualValue,outcome:graded.outcome==='W'?'WIN':graded.outcome==='L'?'LOSS':graded.outcome}:unresolved('UNSUPPORTED_MARKET');
}
