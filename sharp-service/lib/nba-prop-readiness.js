// A provider quote and historical averages do not establish a pregame player
// projection. This reports the current missing evidence; it cannot authorize BUY.
const REQUIRED_EVIDENCE = Object.freeze([
 'PROJECTED_MINUTES_UNAVAILABLE',
 'ROTATION_UNCONFIRMED',
 'PLAYER_INJURY_CLEARANCE_UNVERIFIED',
 'MATCHUP_AND_ROLE_ADJUSTMENTS_UNVALIDATED',
 'PROP_CALIBRATION_UNVALIDATED'
]);

function readinessForPlayer(event, player, now) {
 const binding=player.explanationBinding, startsAt=Date.parse(event.startsAt);
 const pregame=Number.isFinite(startsAt)&&startsAt>now;
 const identity=Boolean(binding?.contract==='sgo-event-roster-v1'&&
  binding.eventID===event.eventID&&binding.playerID===player.prop?.playerID&&
  typeof binding.playerID==='string'&&binding.playerID.length>0&&
  Date.parse(binding.startsAt)===startsAt&&
  [binding.teamId,binding.opponentTeamId].every(id=>typeof id==='string'&&id.endsWith('_NBA'))&&
  binding.teamId!==binding.opponentTeamId);
 const reasons=[...(!pregame?['PREGAME_EVENT_UNVERIFIED']:[]),...(!identity?['PLAYER_EVENT_IDENTITY_UNVERIFIED']:[]),...REQUIRED_EVIDENCE];
 return {
  contract:'nba-prop-readiness-v1',status:'AVOID_UNVERIFIED',
  identityStatus:identity?'PROVIDER_ROSTER_MATCHED':'UNVERIFIED',
  projectedMinutes:null,modelProbability:null,expectedValue:null,
  productionEligible:false,productionWeight:0,reasons,
  summary:(identity?'Provider roster identity is matched. ':'Player identity for this game is unverified. ')+
   'Prop prediction is withheld: projected playing time, confirmed rotation, and player injury clearance are unavailable. Matchup and role adjustments and prop calibration have not been validated. No prop play is cleared.'
 };
}

export function withNbaPropReadiness(body, now=Date.now()) {
 const reasonCounts={};let evaluatedPlayerMarkets=0;
 const events=(body.events??[]).map(event=>({...event,players:(event.players??[]).map(player=>{
  const propReadiness=readinessForPlayer(event,player,now);
  evaluatedPlayerMarkets++;
  for(const reason of propReadiness.reasons)reasonCounts[reason]=(reasonCounts[reason]??0)+1;
  return {...player,propReadiness};
 })}));
 return {...body,events,productionEligible:false,productionWeight:0,
  propReadiness:{contract:'nba-prop-readiness-summary-v1',status:'NOT_CLEARED',
   checkedAt:new Date(now).toISOString(),evaluatedPlayerMarkets,eligiblePlayerMarkets:0,reasonCounts,
   productionEligible:false,productionWeight:0}};
}
