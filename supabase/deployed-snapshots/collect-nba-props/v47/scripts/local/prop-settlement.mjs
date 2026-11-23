const at=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
export function propOutcome(row,body,eventId,retrievedAt,scoreboardEvent=null){
 const c=body?.header?.competitions?.[0],s=c?.status;
 let period=s?.period,periodSource='summary';
 if(period===undefined){
  const sc=scoreboardEvent?.competitions?.[0],ss=sc?.status;
  if(String(scoreboardEvent?.id)!==String(eventId)||scoreboardEvent?.competitions?.length!==1||String(sc?.id)!==String(eventId)||!Number.isFinite(at(sc?.date))||at(sc.date)!==at(c?.date)||ss?.type?.completed!==true||ss.type.name!=='STATUS_FINAL'||ss.type.state!=='post'||sc.competitors?.length!==2||new Set(sc.competitors.map(t=>String(t.id))).size!==2||!sc.competitors.every(t=>c?.competitors?.some(u=>String(u.id)===String(t.id))))return null;
  period=ss.period;periodSource='corroborating scoreboard';
 }
 if(String(body?.header?.id)!==String(eventId)||body.header.competitions?.length!==1||String(c?.id)!==String(eventId)||s?.type?.completed!==true||s.type.name!=='STATUS_FINAL'||s.type.state!=='post'||!Number.isInteger(period)||period<4)return null;
 const start=at(c.date),receipt=at(row.receivedAt),retrieved=at(retrievedAt);
 if(![start,receipt,retrieved,at(row.startsAt)].every(Number.isFinite)||Math.abs(start-at(row.startsAt))>900000||receipt>=Math.min(start,at(row.startsAt))||retrieved<=start||receipt>retrieved)return null;
 const team=String(row.context?.teamId??''),opponent=String(row.context?.opponentTeamId??'');
 if(!team||!opponent||team===opponent||c.competitors?.length!==2||new Set(c.competitors.map(t=>String(t.id))).size!==2||!c.competitors.every(t=>[team,opponent].includes(String(t.id))))return null;
 const matches=[];
 for(const group of body.boxscore?.players??[])for(const block of group.statistics??[])for(const player of block.athletes??[])if(String(player.athlete?.id)===String(row.playerID))matches.push({group,block,player});
 if(matches.length!==1)return null;
 const {group,block,player}=matches[0],label={points:'PTS',rebounds:'REB',assists:'AST'}[row.market];
 if(String(group.team?.id)!==team||player.didNotPlay===true||!label||!Array.isArray(block.labels)||block.labels.filter(x=>x===label).length!==1||!['OVER','UNDER'].includes(row.side)||typeof row.line!=='number'||!Number.isFinite(row.line))return null;
 const raw=player.stats?.[block.labels.indexOf(label)],minutes=player.stats?.[block.labels.indexOf('MIN')];
 if(typeof raw!=='string'||!/^\d+$/.test(raw)||typeof minutes!=='string'||!/^\d+(?::[0-5]\d)?$/.test(minutes)||Number(minutes.split(':')[0])+Number(minutes.split(':')[1]??0)/60<=0)return null;
 const actual=Number(raw);if(!Number.isSafeInteger(actual))return null;
 return {identity:row.identity,officialStartAt:c.date,officialEventId:String(eventId),playerID:String(row.playerID),actual,outcome:actual===row.line?'PUSH':(row.side==='OVER'?actual>row.line:actual<row.line)?'WIN':'LOSS',retrievedAt,source:'ESPN final boxscore',period,periodSource,researchOnly:true,rule:'OBSERVED_FULL_GAME_STAT_ONLY',bookSettlementVerified:false};
}
