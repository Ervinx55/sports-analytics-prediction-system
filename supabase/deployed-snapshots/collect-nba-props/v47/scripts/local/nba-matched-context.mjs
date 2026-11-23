// Same windows and player-summed possessions as ml/nba_defense_fit.py.
const at=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
const num=v=>typeof v==='number'&&Number.isFinite(v);
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
function matchingSample(history,q){
 if(!['points','rebounds','assists'].includes(q.market)||![at(q.startsAt),at(q.cutoff)].every(Number.isFinite)||at(q.cutoff)>=at(q.startsAt)||q.teamId===q.opponentTeamId)throw Error('Invalid request');
 const ids=new Set();for(const g of history){if(ids.has(g.id))throw Error('Duplicate history');ids.add(g.id);if(!Number.isFinite(at(g.observedAt))||at(g.observedAt)>at(q.cutoff))throw Error('Historical availability unknown');}
 const games=history.filter(g=>at(g.startsAt)+8*3600000<=at(q.startsAt)&&g.startsAt.slice(0,10)<q.startsAt.slice(0,10)).sort((a,b)=>at(a.startsAt)-at(b.startsAt)||Number(a.id)-Number(b.id));
 const own=games.filter(g=>g.teams.some(t=>t.id===q.teamId)),opp=games.filter(g=>g.teams.some(t=>t.id===q.opponentTeamId));
 const players=own.flatMap(g=>g.players.filter(p=>p.id===q.playerId&&p.teamId===q.teamId&&p.minutes>0).map(p=>({...p,gameId:g.id}))).slice(-10);
 if(Math.min(own.length,players.length)<3)throw Error('Insufficient matching sample');
 return {games,own,opp,players};
}
export function baselineFeatures(history,q){
 const {own,players}=matchingSample(history,q),baseline=mean(players.map(p=>p[q.market]));
 if(!num(baseline))throw Error('Invalid baseline');
 return {baseline,minutes:{observedMean:mean(players.map(p=>p.minutes)),sample:players.length,projected:null,method:'last 10 positive-minute same-team games; not a confirmed minutes projection'},historicalStarts:players.filter(p=>p.starter===true).length,coverage:{ownGames:own.length,playerGames:players.length},historyIds:own.map(g=>g.id),cutoff:q.cutoff};
}
export function matchedFeatures(history,q){
 const {games,own,opp,players}=matchingSample(history,q);
 if(opp.length<3)throw Error('Insufficient matching sample');
 const efficiency=(gs,id,defense)=>100*gs.reduce((s,g)=>s+g.teams.find(t=>defense?t.id!==id:t.id===id).points,0)/gs.reduce((s,g)=>s+mean(g.teams.map(t=>t.possessions)),0);
 const baseline=mean(players.map(p=>p[q.market]));
 const features={level:baseline,recentDelta:mean(players.slice(-5).map(p=>p[q.market]))-baseline,teamForm:mean(own.slice(-5).map(g=>Number(g.teams.find(t=>t.id===q.teamId).points>g.teams.find(t=>t.id!==q.teamId).points))),ownOffense:efficiency(own,q.teamId,false),opponentDefense:efficiency(opp,q.opponentTeamId,true)};
 if(!Object.values(features).every(num))throw Error('Invalid features');
 return {features,baseline,minutes:{observedMean:mean(players.map(p=>p.minutes)),sample:players.length,projected:null,method:'last 10 positive-minute same-team games; not a confirmed minutes projection'},historicalStarts:players.filter(p=>p.starter===true).length,coverage:{ownGames:own.length,opponentGames:opp.length,playerGames:players.length},historyIds:games.map(g=>g.id),cutoff:q.cutoff};
}
export function projectCandidate(x,m,market){
 if(market==='assists')return x.baseline;
 if(!m||m.productionWeight!==0||!Array.isArray(m.features)||!m.features.length||!Array.isArray(m.coefficients)||m.coefficients.length!==m.features.length+1||m.center?.length!==m.features.length||m.scale?.length!==m.features.length||!m.coefficients.every(num)||!m.center.every(num)||!m.scale.every(v=>num(v)&&v>0)||!m.features.every(f=>num(x.features[f])))throw Error('Invalid model artifact');
 return Math.max(0,x.baseline+m.coefficients[0]+m.features.reduce((s,f,i)=>s+(x.features[f]-m.center[i])/m.scale[i]*m.coefficients[i+1],0));
}
export function injuryEvidence(body,q,observedAt){
 const rows=String(body?.team?.id)===q.teamId?(body.athletes??[]).filter(p=>String(p.id)===q.playerId):[];
 const reports=rows.length===1?(rows[0].injuries??[]).filter(r=>Number.isFinite(at(r.date))&&at(r.date)<=at(observedAt)).map(r=>({status:r.status??null,reportedAt:r.date,detail:r.shortComment??r.longComment??null})):[];
 return {source:'ESPN current roster',observedAt,sourceTimestamp:body?.timestamp??null,playerMatched:rows.length===1,reports,availability:'UNKNOWN',note:'Reported injuries are evidence, not confirmed participation or projected minutes. An empty list does not mean healthy.'};
}
export function parseMatchedSummary(body,expectedId,observedAt,seasonEnd){
 const c=body?.header?.competitions?.[0];
 if(String(body?.header?.id)!==String(expectedId)||String(c?.id)!==String(expectedId)||body.header.competitions.length!==1||Number(body.header.season?.year)!==seasonEnd||Number(body.header.season?.type)!==2||c.status?.type?.name!=='STATUS_FINAL'||c.status.type.completed!==true||c.status.type.state!=='post'||!Number.isFinite(at(c.date))||at(c.date)>=at(observedAt)||c.competitors?.length!==2)throw Error('Invalid final summary');
 const teams=c.competitors.map(t=>({id:String(t.id),points:Number(t.score),possessions:0})),players=[],seen=new Set();
 if(new Set(teams.map(t=>t.id)).size!==2||teams.some(t=>!Number.isSafeInteger(t.points)||t.points<0))throw Error('Invalid teams');
 for(const group of body.boxscore?.players??[]){const team=teams.find(t=>t.id===String(group.team?.id));if(!team)throw Error('Unknown team');
 for(const block of group.statistics??[])for(const p of block.athletes??[]){if(p.didNotPlay===true)continue;
 const id=String(p.athlete?.id);if(!/^\d+$/.test(id)||seen.has(id))throw Error('Duplicate player');seen.add(id);
 const raw=label=>{if(block.labels?.filter(x=>x===label).length!==1)throw Error('Missing stat');return p.stats?.[block.labels.indexOf(label)];};
 const integer=label=>{const v=raw(label);if(typeof v!=='string'||!/^\d+$/.test(v))throw Error('Incomplete stat');return Number(v);};
 const attempts=label=>{const v=raw(label);if(typeof v!=='string'||!/^\d+-\d+$/.test(v))throw Error('Incomplete shooting');return Number(v.split('-')[1]);};
 const min=raw('MIN');if(typeof min!=='string'||!/^\d+(?::[0-5]\d)?$/.test(min))throw Error('Invalid minutes');
 const minutes=Number(min.split(':')[0])+Number(min.split(':')[1]??0)/60;if(minutes>70)throw Error('Invalid minutes');
 team.possessions+=attempts('FG')+.44*attempts('FT')-integer('OREB')+integer('TO');
 players.push({id,teamId:team.id,minutes,points:integer('PTS'),rebounds:integer('REB'),assists:integer('AST'),starter:p.starter===true});
 }}
 for(const t of teams)if(t.possessions<=0||players.filter(p=>p.teamId===t.id).reduce((s,p)=>s+p.points,0)!==t.points)throw Error('Incomplete boxscore');
 return {id:String(expectedId),startsAt:c.date,observedAt,teams,players};
}
