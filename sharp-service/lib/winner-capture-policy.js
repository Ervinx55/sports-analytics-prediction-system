import {canonicalHash,createWinnerModelManifest,projectWinnerBaseline} from './winner-prospective-models.js';
import {validScheduleRevision} from './winner-schedule-revisions.js';
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const https=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);
const receipt=(value,cutoff)=>stamp(value)&&Date.parse(value)<=cutoff;
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=200;
function sourceValid(source,cutoff){return https(source?.sourceUrl)&&sha(source.sha256)&&receipt(source.fetchedAt,cutoff)&&
 (!source.publishedAt||receipt(source.publishedAt,Date.parse(source.fetchedAt)))&&(!source.sourceAsOf||receipt(source.sourceAsOf,Date.parse(source.fetchedAt)));}

function officialDailyReceipt(event,e,cutoff){
 const feed=/^https:\/\/stats\.nba\.com\/js\/data\/leaders\/00_daily_lineups_(\d{4})(\d{2})(\d{2})\.json$/.exec(e.sourceUrl??''),proof=e.identityEvidence,schedule=e.identitySource;
 if(event.sport!=='NBA'||e.receiptContract!=='NBA_OFFICIAL_DAILY_LINEUPS_V1'||e.source!=='NBA_OFFICIAL'||e.publishedAt!==null||e.publicationTimeKnown!==false||!feed||!sourceValid(e,cutoff)||e.sourceHash!==e.sha256||!sourceValid(schedule,cutoff)||schedule.sourceHash!==schedule.sha256||schedule.sourceUrl!==`https://www.nba.com/games?date=${feed[1]}-${feed[2]}-${feed[3]}`)return false;
 if(cutoff-Date.parse(e.fetchedAt)>600000||cutoff-Date.parse(schedule.fetchedAt)>600000||Date.parse(schedule.fetchedAt)>=Date.parse(event.startsAt)||!/^\d{10}$/.test(e.officialGameId??'')||proof?.gameId!==e.officialGameId||proof.gameStatus!==1||proof.period!==0||Date.parse(proof.startsAt)!==Date.parse(event.startsAt))return false;
 return ['home','away'].every(side=>/^\d+$/.test(proof[side]?.officialId??'')&&proof[side].canonicalId===event[side].id&&proof[side].abbreviation===event[side].abbreviation);
}

export function normalizeLineupEvidence(event,evidence=[],issuedAt){
 const now=Date.parse(issuedAt),items=Array.isArray(evidence)?evidence.filter(e=>e?.eventID===event.eventID).slice(0,8):[];
 const safe=items.filter(e=>!['FINAL_GAMEBOOK','TARGET_BOXSCORE'].includes(e.kind)&&JSON.stringify(e).length<=50000&&
  sourceValid(e,now)&&(receipt(e.publishedAt,Date.parse(e.fetchedAt))||officialDailyReceipt(event,e,now))&&Date.parse(e.fetchedAt)<Date.parse(event.startsAt));
 const observed=safe.map(e=>({kind:e.kind||'UNKNOWN',status:e.status||'UNAVAILABLE',source:e.source||null,
  sourceUrl:https(e.sourceUrl)?e.sourceUrl:null,publishedAt:stamp(e.publishedAt)?e.publishedAt:null,
  fetchedAt:stamp(e.fetchedAt)?e.fetchedAt:null,sha256:sha(e.sha256)?e.sha256:null,sourceHash:sha(e.sourceHash)?e.sourceHash:null,
  ...(e.receiptContract?{receiptContract:e.receiptContract,publicationTimeKnown:e.publicationTimeKnown,officialGameId:e.officialGameId,identitySource:e.identitySource,identityEvidence:e.identityEvidence}:{}),
  ...(e.pdfSha256?{pdfSha256:e.pdfSha256,reportRetrievedAt:e.reportRetrievedAt}:{}),
  ...(e.kind==='NFL_OFFICIAL_INACTIVES'?{sourceUpdatedAt:e.sourceUpdatedAt,completeInactiveLists:e.completeInactiveLists===true,listedNamesVerified:e.listedNamesVerified===true,completeActiveRoster:false,participationConfirmed:false}:{}),
  reason:e.reason||null,rows:Array.isArray(e.rows)?e.rows.slice(0,100):undefined}));
 const verified=safe.filter(e=>{
  if(event.sport!=='NBA'||e.kind!=='CONFIRMED_STARTERS'||e.status!=='VERIFIED'||e.source!=='NBA_OFFICIAL'||!sourceValid(e,now)||
   !(receipt(e.publishedAt,Date.parse(e.fetchedAt))||officialDailyReceipt(event,e,now))||Date.parse(e.fetchedAt)>=Date.parse(event.startsAt)||
   e.homeTeamId!==event.home.id||e.awayTeamId!==event.away.id||Date.parse(e.startsAt)!==Date.parse(event.startsAt))return false;
  const host=new URL(e.sourceUrl).hostname;
  if(host!=='nba.com'&&!host.endsWith('.nba.com'))return false;
  if(e.receiptContract==='NBA_OFFICIAL_DAILY_LINEUPS_V1'){
   if(!officialDailyReceipt(event,e,now)||!Array.isArray(e.rows))return false;
   for(const side of ['home','away']){const players=e.rows.filter(p=>p.side===side&&['PG','SG','SF','PF','C'].includes(p.position));if(players.length!==5||new Set(players.map(p=>p.position)).size!==5||players.some(p=>p.lineupStatus!=='Confirmed'||p.rosterStatus!=='Active'||p.officialTeamId!==e.identityEvidence[side].officialId)||JSON.stringify(players.map(p=>p.playerId).sort())!==JSON.stringify([...(e[side+'PlayerIds']??[])].sort()))return false;}
  }
  return Array.isArray(e.homePlayerIds)&&e.homePlayerIds.length===5&&Array.isArray(e.awayPlayerIds)&&e.awayPlayerIds.length===5&&
   [...e.homePlayerIds,...e.awayPlayerIds].every(identity)&&new Set([...e.homePlayerIds,...e.awayPlayerIds]).size===10;
 });
 // Conflicting complete observations cannot be resolved by taking whichever arrived last.
 const fingerprints=new Set(verified.map(e=>canonicalHash({home:[...e.homePlayerIds].sort(),away:[...e.awayPlayerIds].sort()})));
 const confirmed=fingerprints.size===1&&verified.length>0;
 return {status:confirmed?'VERIFIED_PREGAME_STARTERS':'UNAVAILABLE',verified:confirmed,
  reason:confirmed?null:fingerprints.size>1?'LINEUP_OBSERVATIONS_CONFLICT':'CONFIRMED_PREGAME_LINEUP_UNAVAILABLE',
  observations:observed,...(confirmed?{homePlayerIds:verified[0].homePlayerIds,awayPlayerIds:verified[0].awayPlayerIds}:{}),
  injuryReportIsLineup:false,depthChartIsLineup:false,adjustmentApplied:false};
}
function implied(value){return typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)>=100?(value>0?100/(100+value):-value/(100-value)):null;}
// Diagnostics describe this collection, separately from immutable input evidence.
export function inspectWinnerQuotes(event,quotes=[],issuedAt){
 const now=Date.parse(issuedAt),pairs=[],reasons=[],books=new Map();
 const diagnostics={matchingQuotes:0,rejectedQuotes:0,conflictingBooks:0,eligiblePairs:0,reasonCounts:{}};
 const note=reason=>{diagnostics.reasonCounts[reason]=(diagnostics.reasonCounts[reason]??0)+1;};
 // The collector combines both sports. Apply the safety cap after identity
 // filtering so another game's books cannot hide this game's valid pair.
 for(const q of (Array.isArray(quotes)?quotes:[]).filter(q=>q?.eventID===event.eventID).slice(0,100)){
  diagnostics.matchingQuotes++;
  if(!identity(q.book)||!event.sourceIds?.sgo||q.sourceEventId!==event.sourceIds.sgo||!https(q.sourceUrl)||!sha(q.sourceHash)){reasons.push('QUOTE_IDENTITY_UNVERIFIED');note('QUOTE_IDENTITY_UNVERIFIED');diagnostics.rejectedQuotes++;continue;}
  if(!receipt(q.fetchedAt,now)||Date.parse(q.fetchedAt)>=Date.parse(event.startsAt)||
   ![q.homeUpdatedAt,q.awayUpdatedAt].every(t=>receipt(t,Date.parse(q.fetchedAt))&&now-Date.parse(t)<=600000)||
   Math.abs(Date.parse(q.homeUpdatedAt)-Date.parse(q.awayUpdatedAt))>120000){
   reasons.push('QUOTE_STALE_FUTURE_OR_UNPAIRED');diagnostics.rejectedQuotes++;
   if(!receipt(q.fetchedAt,now))note('QUOTE_RECEIPT_FUTURE_OR_INVALID');
   else if(Date.parse(q.fetchedAt)>=Date.parse(event.startsAt))note('QUOTE_RECEIPT_NOT_PREGAME');
   else if(![q.homeUpdatedAt,q.awayUpdatedAt].every(stamp))note('QUOTE_UPDATE_TIMESTAMP_INVALID');
   else if(![q.homeUpdatedAt,q.awayUpdatedAt].every(t=>receipt(t,Date.parse(q.fetchedAt))))note('QUOTE_UPDATE_AFTER_RECEIPT');
   else if([q.homeUpdatedAt,q.awayUpdatedAt].some(t=>now-Date.parse(t)>600000))note('QUOTE_UPDATE_STALE');
   else note('QUOTE_PAIR_TIMESTAMP_SKEW');
   continue;
  }
  const home=implied(q.homeOdds),away=implied(q.awayOdds),sum=home+away;
  if(home===null||away===null||sum<1||sum>1.15){reasons.push('QUOTE_INVALID_PRICE_OR_OVERROUND');note('QUOTE_INVALID_PRICE_OR_OVERROUND');diagnostics.rejectedQuotes++;continue;}
  const normalized={book:q.book,homeOdds:q.homeOdds,awayOdds:q.awayOdds,homeUpdatedAt:q.homeUpdatedAt,awayUpdatedAt:q.awayUpdatedAt,
   fetchedAt:q.fetchedAt,sourceUrl:q.sourceUrl,sourceHash:q.sourceHash,sourceEventId:q.sourceEventId,homeNoVigProbability:home/sum,awayNoVigProbability:away/sum};
  if(!books.has(q.book))books.set(q.book,new Map());books.get(q.book).set(canonicalHash(normalized),normalized);
 }
 for(const entries of books.values())if(entries.size===1)pairs.push([...entries.values()][0]);else {reasons.push('CONFLICTING_BOOK_QUOTES');note('CONFLICTING_BOOK_QUOTES');diagnostics.conflictingBooks++;}
 pairs.sort((a,b)=>a.book.localeCompare(b.book));
 diagnostics.eligiblePairs=pairs.slice(0,20).length;
 return {comparison:{eligible:pairs.length>0,pairs:pairs.slice(0,20),reasons:[...new Set(reasons.length?reasons:pairs.length?[]:['PAIRED_PRICE_UNAVAILABLE'])],
  probabilityBasis:'SAME_BOOK_TWO_WAY_PROPORTIONAL_NO_VIG',oddsInfluenceOnModel:0},diagnostics};
}
export function normalizeWinnerQuotes(event,quotes=[],issuedAt){return inspectWinnerQuotes(event,quotes,issuedAt).comparison;}
function validEvent(event,sport,issued){
 const primary=sport==='NFL'?'nflverse':event?.eventID?.startsWith('espn:')?'espn':'sgo';
 return event?.sport===sport&&identity(event.eventID)&&event.identityVerified===true&&event.status==='SCHEDULED'&&
  stamp(event.startsAt)&&Date.parse(event.startsAt)>issued&&receipt(event.sourceFetchedAt,issued)&&
  Number.isInteger(event.season)&&identity(event.home?.id)&&identity(event.away?.id)&&event.home.id!==event.away.id&&
  identity(event.home.abbreviation)&&identity(event.away.abbreviation)&&event.home.abbreviation!==event.away.abbreviation&&
  identity(event.sourceIds?.[primary])&&(event.eventID===primary+':'+event.sourceIds[primary]&&!event.scheduleRevision||
   sport==='NFL'&&validScheduleRevision(event.scheduleRevision,new Date(issued).toISOString())&&event.eventID===event.scheduleRevision.eventID&&
   event.providerEventID==='nflverse:'+event.sourceIds.nflverse&&event.providerEventID===event.scheduleRevision.baseEventID&&
   event.startsAt===event.scheduleRevision.startsAt&&event.home.id===event.scheduleRevision.home&&event.away.id===event.scheduleRevision.away&&
   event.scheduleAgreement?.sourceEventId===event.scheduleRevision.sourceEventId&&event.scheduleAgreement.startsAt===event.startsAt&&
   event.scheduleAgreement.home===event.home.id&&event.scheduleAgreement.away===event.away.id&&sha(event.scheduleAgreement.sourceHash)&&
   receipt(event.scheduleAgreement.fetchedAt,issued)&&issued-Date.parse(event.scheduleAgreement.fetchedAt)<=60000&&Date.parse(event.scheduleAgreement.fetchedAt)<Date.parse(event.startsAt));
}
export function buildWinnerCandidates({sport,events=[],history,quotes=[],lineupEvidence=[],observedAt,issuedAt,modelManifest}){
 const candidates=[],excluded=[],issued=Date.parse(issuedAt);
 const rejectAll=reason=>({candidates:[],excluded:(Array.isArray(events)?events:[]).slice(0,100).map(e=>({eventID:e?.eventID||null,reason}))});
 if(!['NBA','NFL'].includes(sport)||!Array.isArray(events)||events.length>100)return rejectAll('INVALID_CAPTURE_SCOPE');
 if(!stamp(issuedAt)||!receipt(observedAt,issued))return rejectAll('SOURCE_RECEIPT_AFTER_ISSUE');
 const frozen=createWinnerModelManifest(sport);
 if(!modelManifest||canonicalHash(modelManifest)!==canonicalHash(frozen))return rejectAll('FROZEN_MODEL_MISMATCH');
 if(!Array.isArray(history?.sourceSnapshots)||!history.sourceSnapshots.length||history.sourceSnapshots.length>60||
  !history.sourceSnapshots.every(s=>sourceValid(s,issued)))return rejectAll('SOURCE_PROVENANCE_UNAVAILABLE');
 const duplicates=new Set(events.filter((e,i)=>events.findIndex(x=>x.eventID===e.eventID)!==i).map(e=>e.eventID));
 for(const event of events){
  if(duplicates.has(event.eventID)||!validEvent(event,sport,issued)){excluded.push({eventID:event.eventID,reason:'EVENT_IDENTITY_OR_PREGAME_INVALID'});continue;}
  try{
   const projection=projectWinnerBaseline({sport,event,history,issuedAt});
   const lineup=normalizeLineupEvidence(event,lineupEvidence,issuedAt),quoteComparison=normalizeWinnerQuotes(event,quotes,issuedAt);
   if(event.scheduleRevision&&!quoteComparison.eligible)throw Error('SCHEDULE_REVISION_PAIRED_PRICE_REQUIRED');
   const primary=event.eventID.split(':')[0];
   const identityEvidence={eventID:event.eventID,sourceIds:{[primary]:event.sourceIds[primary]},home:event.home,away:event.away,startsAt:event.startsAt,
    season:event.season,week:event.week??null,gameDate:event.gameDate??null,neutralSite:event.neutralSite??null,
    ...(event.scheduleRevision?{providerEventID:event.providerEventID,scheduleRevisionHash:event.scheduleRevision.revisionHash,officialGameID:event.scheduleRevision.officialGameID}:{})};
   const eventEvidence={sourceIds:event.sourceIds,sourceFetchedAt:event.sourceFetchedAt,
    ...(event.scheduleRevision?{scheduleRevision:event.scheduleRevision,scheduleAgreement:event.scheduleAgreement}:{})};
   const input={identity:identityEvidence,eventEvidence,sourceSnapshots:history.sourceSnapshots,features:projection.features,featureEvidence:projection.featureEvidence,
    lineup,quoteComparison,modelManifestHash:frozen.manifestHash,observedAt,issuedAt};
   const forecast={contract:'winner-prospective-forecast-v1',sport,eventID:event.eventID,startsAt:event.startsAt,identity:identityEvidence,
    modelVersion:frozen.modelVersion,manifestHash:frozen.manifestHash,coefficientsHash:frozen.coefficientsHash,
    generatedAt:issuedAt,issuedAt,observedAt,eventEvidence,sourceSnapshots:history.sourceSnapshots,sourceAsOf:observedAt,
    homeProbability:projection.homeProbability,awayProbability:1-projection.homeProbability,probabilityBasis:'INDEPENDENT_HOME_WIN',
    probabilityTarget:frozen.probabilityTarget,features:projection.features,featureEvidence:projection.featureEvidence,
    lineup,quoteComparison,pairedPriceEligible:quoteComparison.eligible,quoteComparisonEligible:quoteComparison.eligible,lineupVerified:lineup.verified,
    captureClass:'BASELINE_ONLY',fullFeatureEligible:false,fullFeatureExclusionReasons:['FROZEN_BASELINE_HAS_NO_LINEUP_OR_PLAYER_DEFENSE_ADJUSTMENT',...(!lineup.verified?['VERIFIED_PREGAME_LINEUP_UNAVAILABLE']:[])],
    productionEligible:false,productionWeight:0,automaticBuyEnabled:false};
   const inputObservedAt=new Date(Math.max(Date.parse(observedAt),Date.parse(event.sourceFetchedAt),
    ...history.sourceSnapshots.map(s=>Date.parse(s.fetchedAt)),...quoteComparison.pairs.map(q=>Date.parse(q.fetchedAt)),
    ...lineup.observations.map(e=>Date.parse(e.fetchedAt)))).toISOString();
   candidates.push({sport,event_id:event.eventID,model_version:frozen.modelVersion,model_hash:frozen.manifestHash,
    starts_at:event.startsAt,input_hash:canonicalHash(input),inputEvidence:input,inputObservedAt,forecast});
  }catch(error){excluded.push({eventID:event.eventID,reason:error.message||'MODEL_INPUT_UNAVAILABLE'});}
 }
 return {candidates,excluded};
}
