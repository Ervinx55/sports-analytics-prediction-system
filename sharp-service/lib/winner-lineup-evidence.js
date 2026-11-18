import {createHash} from 'node:crypto';

const INJURY_URL='https://sports-analytics-prediction-system-tau.vercel.app/api/nbaavailability';
const NFL_NEWS='https://www.nfl.com/news/series/around-the-nfl-news';
const POSITIONS=['PG','SG','SF','PF','C'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const time=value=>typeof value==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
const id=value=>/^\d+$/.test(String(value??''));
const parts=value=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
const day=value=>{const p=parts(value);return `${p.year}-${p.month}-${p.day}`;};
const nbaAlias=value=>({NY:'NYK',GS:'GSW',SA:'SAS',NO:'NOP',WSH:'WAS',UTAH:'UTA',PHO:'PHX'}[value]??value);
const normalized=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const TEAM_NAMES={ATL:'Atlanta Hawks',BOS:'Boston Celtics',BKN:'Brooklyn Nets',CHA:'Charlotte Hornets',CHI:'Chicago Bulls',CLE:'Cleveland Cavaliers',DAL:'Dallas Mavericks',DEN:'Denver Nuggets',DET:'Detroit Pistons',GSW:'Golden State Warriors',HOU:'Houston Rockets',IND:'Indiana Pacers',LAC:'LA Clippers',LAL:'Los Angeles Lakers',MEM:'Memphis Grizzlies',MIA:'Miami Heat',MIL:'Milwaukee Bucks',MIN:'Minnesota Timberwolves',NOP:'New Orleans Pelicans',NYK:'New York Knicks',OKC:'Oklahoma City Thunder',ORL:'Orlando Magic',PHI:'Philadelphia 76ers',PHX:'Phoenix Suns',POR:'Portland Trail Blazers',SAC:'Sacramento Kings',SAS:'San Antonio Spurs',TOR:'Toronto Raptors',UTA:'Utah Jazz',WAS:'Washington Wizards'};
const NFL_HEADINGS={ARI:'CARDINALS',ATL:'FALCONS',BAL:'RAVENS',BUF:'BILLS',CAR:'PANTHERS',CHI:'BEARS',CIN:'BENGALS',CLE:'BROWNS',DAL:'COWBOYS',DEN:'BRONCOS',DET:'LIONS',GB:'PACKERS',HOU:'TEXANS',IND:'COLTS',JAX:'JAGUARS',KC:'CHIEFS',LAC:'CHARGERS',LA:'RAMS',LAR:'RAMS',LV:'RAIDERS',MIA:'DOLPHINS',MIN:'VIKINGS',NE:'PATRIOTS',NO:'SAINTS',NYG:'GIANTS',NYJ:'JETS',PHI:'EAGLES',PIT:'STEELERS',SEA:'SEAHAWKS',SF:'49ERS',TB:'BUCCANEERS',TEN:'TITANS',WAS:'COMMANDERS'};
const validEvent=(e,issuedAt)=>e?.identityVerified===true&&e.status==='SCHEDULED'&&Number.isFinite(time(e.startsAt))&&time(issuedAt)<time(e.startsAt);
const validSource=(s,issuedAt)=>/^[a-f0-9]{64}$/.test(s?.source_hash??'')&&Number.isFinite(time(s.fetched_at))&&time(s.fetched_at)<=time(issuedAt)&&time(issuedAt)-time(s.fetched_at)<=600000;
const sourceEvidence=s=>({sourceUrl:s.source_url,sourceHash:s.source_hash,sha256:s.source_hash,fetchedAt:s.fetched_at});
function nextData(html){const matches=[...String(html).matchAll(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/g)];if(matches.length!==1)throw Error('NBA_SCHEDULE_INVALID');return JSON.parse(matches[0][1]).props?.pageProps;}

export function nbaOfficialLineupEvidence({events=[],scheduleHtml,scheduleSource,lineupPayload,lineupSource,issuedAt}){
 const evidence=[],unavailable=[];
 if(!validSource(scheduleSource,issuedAt)||!validSource(lineupSource,issuedAt))return {evidence,unavailable:['OFFICIAL_LINEUP_RECEIPT_UNAVAILABLE']};
 const dateMatch=/^https:\/\/www\.nba\.com\/games\?date=(\d{4}-\d{2}-\d{2})$/.exec(scheduleSource.source_url);
 if(!dateMatch||lineupSource.source_url!==`https://stats.nba.com/js/data/leaders/00_daily_lineups_${dateMatch[1].replaceAll('-','')}.json`)return {evidence,unavailable:['OFFICIAL_LINEUP_SOURCE_INVALID']};
 let page;try{page=nextData(scheduleHtml);}catch{return {evidence,unavailable:['OFFICIAL_SCHEDULE_INVALID']};}
 if(page?.selectedDate!==dateMatch[1]||!Array.isArray(page?.gameCardFeed?.modules)||!Array.isArray(lineupPayload?.games)||lineupPayload.games.length>20)return {evidence,unavailable:['OFFICIAL_LINEUP_FORMAT_INVALID']};
 const cards=page.gameCardFeed.modules.flatMap(m=>m.cards??[]).map(c=>c.cardData).filter(c=>c?.gameId);
 for(const event of events.filter(e=>e.sport==='NBA'&&validEvent(e,issuedAt)&&day(e.startsAt)===dateMatch[1]).slice(0,20)){
  const matches=cards.filter(c=>nbaAlias(c.homeTeam?.teamTricode)===event.home.abbreviation&&nbaAlias(c.awayTeam?.teamTricode)===event.away.abbreviation&&time(c.gameTimeUtc)===time(event.startsAt));
  if(matches.length!==1){unavailable.push({eventID:event.eventID,reason:'OFFICIAL_SCHEDULE_IDENTITY_UNAVAILABLE'});continue;}
  const card=matches[0],games=lineupPayload.games.filter(g=>g.gameId===card.gameId);
  if(games.length!==1){unavailable.push({eventID:event.eventID,reason:games.length?'OFFICIAL_LINEUP_GAME_AMBIGUOUS':'OFFICIAL_LINEUP_GAME_UNAVAILABLE'});continue;}
  if(!/^\d{10}$/.test(card.gameId)||cards.filter(c=>c.gameId===card.gameId).length!==1||card.gameStatus!==1||card.period!==0||card.actualStartTimeUTC||games[0].gameStatus!==1||/CANCEL|POSTPON|SUSPEND|DELAY/i.test([card.gameStatusText,games[0].gameStatusText].join(' '))||[scheduleSource,lineupSource].some(s=>time(s.fetched_at)>=time(event.startsAt))){unavailable.push({eventID:event.eventID,reason:'OFFICIAL_LINEUP_NOT_PREGAME'});continue;}
  const game=games[0],rows=[],starters={};let valid=true;
  for(const side of ['home','away']){
   const team=game[side+'Team'],official=card[side+'Team'];
   if(!id(team?.teamId)||String(team.teamId)!==String(official.teamId)||nbaAlias(team.teamAbbreviation)!==event[side].abbreviation||!Array.isArray(team.players)||team.players.length>30){valid=false;break;}
   const seen=new Set();
   for(const p of team.players){
    if(!id(p.personId)||String(p.teamId)!==String(team.teamId)||seen.has(String(p.personId))){valid=false;break;}seen.add(String(p.personId));
    rows.push({side,team:team.teamAbbreviation,officialTeamId:String(team.teamId),playerId:String(p.personId),playerName:typeof p.playerName==='string'&&p.playerName.length<=120?p.playerName:null,position:p.position,lineupStatus:p.lineupStatus,rosterStatus:p.rosterStatus,sourceTimestampRaw:typeof p.timestamp==='string'?p.timestamp:null});
   }
   const five=rows.filter(p=>p.side===side&&POSITIONS.includes(p.position));
   if(five.length!==5||new Set(five.map(p=>p.position)).size!==5||five.some(p=>p.rosterStatus!=='Active'||!['Expected','Confirmed'].includes(p.lineupStatus))){valid=false;break;}
   starters[side]=five;
  }
  if(!valid||new Set(rows.map(p=>p.playerId)).size!==rows.length){unavailable.push({eventID:event.eventID,reason:'OFFICIAL_LINEUP_PLAYER_IDENTITY_INVALID'});continue;}
  const confirmed=[...starters.home,...starters.away].every(p=>p.lineupStatus==='Confirmed');
  const identityEvidence={gameId:card.gameId,startsAt:card.gameTimeUtc,gameStatus:1,period:0,home:{officialId:String(card.homeTeam.teamId),abbreviation:event.home.abbreviation,canonicalId:event.home.id},away:{officialId:String(card.awayTeam.teamId),abbreviation:event.away.abbreviation,canonicalId:event.away.id}};
  evidence.push({eventID:event.eventID,kind:confirmed?'CONFIRMED_STARTERS':'EXPECTED_STARTERS',status:confirmed?'VERIFIED':'EXPECTED',source:'NBA_OFFICIAL',...sourceEvidence(lineupSource),receiptContract:'NBA_OFFICIAL_DAILY_LINEUPS_V1',publishedAt:null,publicationTimeKnown:false,officialGameId:card.gameId,identitySource:{...sourceEvidence(scheduleSource)},identityEvidence,startsAt:event.startsAt,homeTeamId:event.home.id,awayTeamId:event.away.id,homePlayerIds:starters.home.map(p=>p.playerId),awayPlayerIds:starters.away.map(p=>p.playerId),rows,reason:confirmed?null:'OFFICIAL_STARTERS_EXPECTED_NOT_CONFIRMED'});
 }
 return {evidence,unavailable};
}

export function nbaInjuryEvidence({events=[],report,source,issuedAt}){
 if(!validSource(source,issuedAt)||!/^https:\/\/ak-static\.cms\.nba\.com\/referee\/injury\/Injury-Report_[\w.-]+\.pdf$/.test(report?.url??'')||!/^[a-f0-9]{64}$/.test(report?.sha256??'')||!Array.isArray(report?.rows)||report.rows.length>1000)return[];
 const published=time(report.publishedAt),retrieved=time(report.retrievedAt);
 if(!Number.isFinite(published)||!Number.isFinite(retrieved)||published>retrieved||retrieved>time(source.fetched_at)||time(issuedAt)-published>5400000)return[];
 const evidence=[];
 for(const event of events.filter(e=>e.sport==='NBA'&&validEvent(e,issuedAt)).slice(0,20)){
  const p=parts(event.startsAt),date=`${p.month}/${p.day}/${p.year}`,matchup=event.away.abbreviation+'@'+event.home.abbreviation;
  const names=['home','away'].map(side=>normalized(TEAM_NAMES[event[side].abbreviation]));
  const rows=report.rows.filter(r=>{const clock=/^(\d{2}):(\d{2})\s*\(ET\)$/.exec(r.gameTime??'');return r.gameDate===date&&String(r.matchup).split('@').map(nbaAlias).join('@')===matchup&&names.includes(normalized(String(r.team).replace('Los Angeles Clippers','LA Clippers')))&&clock&&Number(clock[1])%12===Number(p.hour)%12&&Number(clock[2])===Number(p.minute)&&['Out','Doubtful','Questionable','Probable','Available','UNKNOWN'].includes(r.status);}).slice(0,100);
  if(!rows.length)continue;
  evidence.push({eventID:event.eventID,kind:'OFFICIAL_INJURY_REPORT',status:'OBSERVED',source:'NBA_OFFICIAL',...sourceEvidence(source),sourceUrl:report.url,pdfSha256:report.sha256,publishedAt:report.publishedAt,reportRetrievedAt:report.retrievedAt,rows,reason:'INJURY_REPORT_DOES_NOT_CONFIRM_STARTERS',participationConfirmed:false});
 }
 return evidence;
}

function articles(html){return [...String(html).matchAll(/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)].flatMap(m=>{try{const p=JSON.parse(m[1]);return Array.isArray(p)?p:[p];}catch{return[];}}).filter(p=>p?.['@type']==='NewsArticle');}
function inactiveRows(body,heading,team){
 const lines=String(body).split(/\r?\n/).map(s=>s.trim()).filter(Boolean),starts=lines.map((s,i)=>s===heading?i:-1).filter(i=>i>=0);if(starts.length!==1)return{rows:[],complete:false};
 const rows=[];let complete=true;
 for(let i=starts[0]+1;i<lines.length&&rows.length<16;i++){
  const line=lines[i];if(Object.values(NFL_HEADINGS).includes(line)||/^(EARLY|LATE|SUNDAY|MONDAY|THURSDAY|MUNICH|INTERNATIONAL)\b/.test(line))break;
  const match=/^([A-Z]{1,5}(?:\/[A-Z]{1,3})?)\s+([\p{L}\p{M}.'’ -]+?)(?:\s*\(([^)]*)\))?$/u.exec(line);if(!match){complete=false;break;}
  rows.push({team,playerName:match[2].trim(),position:match[1],designation:/emergency|designated third/i.test(match[3]??'')?'EMERGENCY_THIRD_QB':'INACTIVE',sourceNote:match[3]??null});
 }
 if(rows.length>=16||new Set(rows.map(r=>normalized(r.playerName))).size!==rows.length)return{rows:[],complete:false};
 return {rows,complete};
}
export function nflInactiveEvidence({events=[],html,source,issuedAt}){
 if(!validSource(source,issuedAt)||!/^https:\/\/www\.nfl\.com\/news\/[a-z0-9-]*inactives[a-z0-9-]*$/.test(source?.source_url??''))return[];
 const docs=articles(html).filter(a=>a.url===source.source_url&&a.publisher?.name==='NFL'&&/\binactives\b/i.test(a.headline??''));if(docs.length!==1)return[];
 const article=docs[0],published=time(article.datePublished),modified=time(article.dateModified??article.datePublished),week=Number(/\bWeek\s+(\d{1,2})\b/i.exec(article.headline??'')?.[1]);
 if(!Number.isFinite(published)||!Number.isFinite(modified)||published>modified||modified>time(source.fetched_at)||typeof article.articleBody!=='string'||article.articleBody.length>100000)return[];
 const evidence=[];
 for(const event of events.filter(e=>e.sport==='NFL'&&validEvent(e,issuedAt)).slice(0,20)){
  const publishedParts=parts(published),season=Number(publishedParts.year)-(Number(publishedParts.month)<3?1:0);
  if(week!==event.week||season!==event.season||day(published)!==day(event.startsAt)||event.gameDate!==day(event.startsAt)||time(source.fetched_at)>=time(event.startsAt)||time(event.startsAt)-time(source.fetched_at)>3*3600000)continue;
  const home=inactiveRows(article.articleBody,NFL_HEADINGS[event.home.abbreviation],event.home.abbreviation),away=inactiveRows(article.articleBody,NFL_HEADINGS[event.away.abbreviation],event.away.abbreviation);
  if(!home.rows.length&&!away.rows.length)continue;
  const completeInactiveLists=Boolean(home.rows.length&&away.rows.length&&home.complete&&away.complete);
  evidence.push({eventID:event.eventID,kind:'NFL_OFFICIAL_INACTIVES',status:completeInactiveLists?'VERIFIED_INACTIVE_LISTS':'PARTIAL_INACTIVE_LIST',source:'NFL_OFFICIAL',...sourceEvidence(source),publishedAt:article.datePublished,sourceUpdatedAt:article.dateModified??article.datePublished,rows:[...away.rows,...home.rows],startsAt:event.startsAt,homeTeamId:event.home.id,awayTeamId:event.away.id,completeInactiveLists,listedNamesVerified:true,completeActiveRoster:false,participationConfirmed:false,reason:'INACTIVE_LIST_DOES_NOT_CONFIRM_ACTIVE_ROSTER_OR_STARTERS'});
 }
 return evidence;
}

async function fetchSnapshot(url,{fetchImpl,now,signal,timeoutMs}){
 const response=await fetchImpl(url,{cache:'no-store',redirect:'error',headers:{accept:'application/json,text/html'},signal:AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)])});
 if(!response.ok)throw Error('LINEUP_SOURCE_UNAVAILABLE');
 const maxBytes=3*1024*1024;if(Number(response.headers?.get?.('content-length'))>maxBytes)throw Error('LINEUP_SOURCE_TOO_LARGE');
 const chunks=[];let size=0;
 if(response.body?.getReader){const reader=response.body.getReader();try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('LINEUP_SOURCE_TOO_LARGE');}chunks.push(Buffer.from(r.value));}}finally{reader.releaseLock();}}
 else{const text=await response.text();if(Buffer.byteLength(text)>maxBytes)throw Error('LINEUP_SOURCE_TOO_LARGE');chunks.push(Buffer.from(text));}
 const text=Buffer.concat(chunks).toString('utf8'),rawSha256=sha(text);
 return{source_hash:sha(JSON.stringify({sourceUrl:url,rawSha256})),source_url:url,fetched_at:new Date(now()).toISOString(),body:{rawText:text,rawSha256}};
}

// Diagnostics describe this collection attempt; they never replace source evidence
// or make an expected lineup / inactive-name list eligible as confirmed starters.
export function lineupReadiness(events,evidence,unavailable,issuedAt){
 const readiness=events.filter(e=>['NBA','NFL'].includes(e.sport)).map(event=>{
  const observations=evidence.filter(e=>e.eventID===event.eventID),confirmed=observations.some(e=>e.kind==='CONFIRMED_STARTERS'&&e.status==='VERIFIED'),expected=observations.some(e=>e.kind==='EXPECTED_STARTERS'),inactives=observations.some(e=>e.kind==='NFL_OFFICIAL_INACTIVES'&&e.completeInactiveLists===true);
  const result={sport:event.sport,eventID:event.eventID,startsAt:event.startsAt,status:'UNAVAILABLE',reason:null,injuryReportObserved:observations.some(e=>e.kind==='OFFICIAL_INJURY_REPORT'),inactiveListsVerified:inactives,participationConfirmed:false};
  if(event.sport==='NBA'){
   if(time(event.startsAt)-time(issuedAt)>86400000){result.status='NOT_DUE';result.reason='NBA_OUTSIDE_LINEUP_WINDOW';}
   else if(confirmed){result.status='VERIFIED_PREGAME_STARTERS';result.participationConfirmed=true;}
   else if(expected){result.status='EXPECTED_STARTERS';result.reason='OFFICIAL_STARTERS_EXPECTED_NOT_CONFIRMED';}
   else{
    const date=day(event.startsAt),urls=[`https://www.nba.com/games?date=${date}`,`https://stats.nba.com/js/data/leaders/00_daily_lineups_${date.replaceAll('-','')}.json`];
    result.reason=unavailable.find(e=>e?.eventID===event.eventID&&e.reason?.startsWith('OFFICIAL_'))?.reason??(unavailable.some(e=>urls.includes(e?.source))?'OFFICIAL_LINEUP_SOURCE_UNAVAILABLE':'OFFICIAL_LINEUP_EVIDENCE_UNAVAILABLE');
   }
  }else if(time(event.startsAt)-time(issuedAt)>3*3600000){result.status='NOT_DUE';result.reason='NFL_OUTSIDE_GAME_DAY_WINDOW';}
  else if(inactives){result.status='INACTIVE_LISTS_ONLY';result.reason='INACTIVE_LIST_DOES_NOT_CONFIRM_ACTIVE_ROSTER_OR_STARTERS';}
  else if(observations.some(e=>e.kind==='NFL_OFFICIAL_INACTIVES')){result.status='PARTIAL_INACTIVE_LISTS';result.reason='NFL_INACTIVE_LIST_PARTIAL';}
  else result.reason=unavailable.some(e=>e?.source===NFL_NEWS||e?.source?.startsWith('https://www.nfl.com/news/'))?'NFL_INACTIVE_SOURCE_UNAVAILABLE':unavailable.some(e=>e?.reason==='NFL_GAME_DAY_INACTIVE_ARTICLE_NOT_PUBLISHED')?'NFL_GAME_DAY_INACTIVE_ARTICLE_NOT_PUBLISHED':'NFL_GAME_DAY_INACTIVE_EVIDENCE_UNAVAILABLE';
  return result;
 });
 const reasonCounts={};for(const row of readiness)if(row.reason)reasonCounts[row.reason]=(reasonCounts[row.reason]??0)+1;
 return {readiness,reasonCounts};
}
export function createWinnerLineupCollector({fetchImpl=fetch,now=Date.now,timeoutMs=3500}={}){
 return async({events=[],signal=new AbortController().signal}={})=>{
  const issuedAt=new Date(now()).toISOString(),pregame=events.filter(e=>validEvent(e,issuedAt)).slice(0,40),nba=pregame.filter(e=>e.sport==='NBA'&&time(e.startsAt)-time(issuedAt)<=86400000),nfl=pregame.filter(e=>e.sport==='NFL'&&time(e.startsAt)-time(issuedAt)<=3*3600000),sources=[],lineupEvidence=[],unavailable=[];
  const get=async url=>{try{const row=await fetchSnapshot(url,{fetchImpl,now,signal,timeoutMs:Math.max(1,Math.min(timeoutMs,3500))});sources.push(row);return row;}catch{unavailable.push({source:url,reason:'LINEUP_SOURCE_UNAVAILABLE'});return null;}};
  const dates=[...new Set(nba.map(e=>day(e.startsAt)))].sort().slice(0,2);
  await Promise.all([
   ...dates.map(async date=>{const scoped=nba.filter(e=>day(e.startsAt)===date),[scheduleSource,lineupSource]=await Promise.all([get('https://www.nba.com/games?date='+date),get(`https://stats.nba.com/js/data/leaders/00_daily_lineups_${date.replaceAll('-','')}.json`)]);if(!scheduleSource||!lineupSource)return;try{const result=nbaOfficialLineupEvidence({events:scoped,scheduleHtml:scheduleSource.body.rawText,scheduleSource,lineupPayload:JSON.parse(lineupSource.body.rawText),lineupSource,issuedAt:new Date(now()).toISOString()});lineupEvidence.push(...result.evidence);for(const item of result.unavailable)unavailable.push(...(typeof item==='string'?scoped.map(e=>({eventID:e.eventID,reason:item})):[item]));}catch{unavailable.push(...scoped.map(e=>({eventID:e.eventID,reason:'OFFICIAL_LINEUP_PARSE_UNAVAILABLE'})));}}),
   ...(nba.length?[get(INJURY_URL).then(source=>{if(source)try{lineupEvidence.push(...nbaInjuryEvidence({events:nba,report:JSON.parse(source.body.rawText),source,issuedAt:new Date(now()).toISOString()}));}catch{unavailable.push({reason:'OFFICIAL_INJURY_PARSE_UNAVAILABLE'});}})]:[]),
   ...(nfl.length?[get(NFL_NEWS).then(async index=>{if(!index)return;const weeks=new Set(nfl.map(e=>e.week));const paths=[...new Set([...index.body.rawText.matchAll(/href=["'](?:https:\/\/www\.nfl\.com)?(\/news\/[a-z0-9-]*inactives[a-z0-9-]*)["']/g)].map(m=>m[1]))].filter(path=>weeks.has(Number(/week-(\d{1,2})-/.exec(path)?.[1]))).slice(0,3);await Promise.all(paths.map(async path=>{const source=await get('https://www.nfl.com'+path);if(source)lineupEvidence.push(...nflInactiveEvidence({events:nfl,html:source.body.rawText,source,issuedAt:new Date(now()).toISOString()}));}));if(!paths.length)unavailable.push({reason:'NFL_GAME_DAY_INACTIVE_ARTICLE_NOT_PUBLISHED'});})]:[])
  ]);
  return{lineupEvidence,sources,coverage:{nbaCheckedGames:nba.length,nbaConfirmedGames:lineupEvidence.filter(e=>e.kind==='CONFIRMED_STARTERS').length,nbaExpectedGames:lineupEvidence.filter(e=>e.kind==='EXPECTED_STARTERS').length,nbaInjuryGames:lineupEvidence.filter(e=>e.kind==='OFFICIAL_INJURY_REPORT').length,nflCheckedGames:nfl.length,nflInactiveGames:lineupEvidence.filter(e=>e.status==='VERIFIED_INACTIVE_LISTS').length,nflOutsideGameDayWindow:pregame.filter(e=>e.sport==='NFL').length-nfl.length,...lineupReadiness(pregame,lineupEvidence,unavailable,issuedAt),unavailable:unavailable.slice(0,40)}};
 };
}
