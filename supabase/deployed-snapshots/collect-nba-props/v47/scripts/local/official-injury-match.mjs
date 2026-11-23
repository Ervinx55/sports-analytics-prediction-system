const norm=v=>typeof v==='string'?v.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,''):'';
const at=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
export function matchOfficialInjury(report,q){
 const unknown=reason=>({status:'UNKNOWN',reason,participationConfirmed:false});
 const issued=at(q.issuedAt),start=at(q.startsAt),published=at(report?.publishedAt),received=at(report?.retrievedAt);
 if(![issued,start,published,received].every(Number.isFinite)||issued>=start||published>received||received>issued||issued-published>5400000)return unknown('OFFICIAL_REPORT_UNAVAILABLE_OR_STALE');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:true}).formatToParts(new Date(start)).map(p=>[p.type,p.value]));
 const date=`${parts.month}/${parts.day}/${parts.year}`;
 const teamAlias=n=>norm(n)==='losangelesclippers'?'laclippers':norm(n);
 const nbaMatchup=v=>typeof v==='string'?v.split('@').map(t=>({GS:'GSW',NO:'NOP',SA:'SAS',NY:'NYK',UTAH:'UTA'}[t]??t)).join('@'):null;
 const teams=(report.rows??[]).filter(r=>r.gameDate===date&&r.matchup===nbaMatchup(q.matchup)&&teamAlias(r.team)===teamAlias(q.teamName));
 const source={sourceUrl:report.url,sourceSha256:report.sha256,publishedAt:report.publishedAt,retrievedAt:report.retrievedAt,participationConfirmed:false};
 if(!teams.length)return {...unknown('TEAM_REPORT_NOT_FOUND'),...source};
 if(teams.some(r=>r.submission==='NOT_YET_SUBMITTED'))return {...unknown('TEAM_NOT_YET_SUBMITTED'),...source};
 if(!norm(q.firstName)||!norm(q.lastName))return {...unknown('PLAYER_NAME_UNVERIFIED'),...source};
 const player=norm(`${q.lastName},${q.firstName}`);
 const matched=teams.filter(r=>norm(r.player)===player&&player);
 if(matched.length!==1){
  // A suffix resemblance is a reconciliation hint, never proof of identity.
  const base=v=>norm(String(v).replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi,''));
  const similar=teams.some(r=>base(r.player)===base(`${q.lastName},${q.firstName}`));
  return {...unknown(matched.length?'AMBIGUOUS_PLAYER':similar?'PLAYER_NAME_REQUIRES_ID_RECONCILIATION':'PLAYER_NOT_LISTED_IN_TEAM_REPORT'),...source};
 }
 const r=matched[0],t=/^(\d{2}):(\d{2})\s*\(ET\)$/.exec(r.gameTime??'');
 if(!t||Math.abs((Number(parts.hour)%12)*60+Number(parts.minute)-(Number(t[1])%12)*60-Number(t[2]))>15||!['Out','Doubtful','Questionable','Probable','Available'].includes(r.status))return {...unknown('GAME_TIME_OR_STATUS_UNVERIFIED'),...source};
 return {...source,status:r.status,reason:r.reason,matchedPlayer:r.player,matchedTeam:r.team,matchup:r.matchup};
}

