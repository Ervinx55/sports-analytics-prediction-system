import {createHash} from 'node:crypto';
import reviewedRevisions from '../../docs/evaluations/nfl-schedule-revisions-2026-11-17/revisions.json' with {type:'json'};

export const NFL_SCHEDULE_REVISIONS=Object.freeze(reviewedRevisions.map(r=>Object.freeze(r)));
export const REVISION_FIELDS=['contract','sport','baseEventID','providerGameID','sourceEventId','officialGameID','season','week','gameDate','home','away','oldStartsAt','startsAt','announcementSourceHash','announcementFetchedAt','scheduleSourceHash','scheduleFetchedAt','sourceUpdatedAt'];
const sha=x=>createHash('sha256').update(x).digest('hex');
const time=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)?Date.parse(x):NaN;
export const scheduleRevisionHash=r=>sha(REVISION_FIELDS.map(k=>String(r[k])).join('\n'));
export function validScheduleRevision(r,issuedAt){
 const cutoff=Date.parse(issuedAt),start=time(r?.startsAt),old=time(r?.oldStartsAt);
 const reviewed=NFL_SCHEDULE_REVISIONS.find(x=>x.revisionHash===r?.revisionHash);
 return !!reviewed&&Object.keys(reviewed).every(k=>reviewed[k]===r[k])&&r?.contract==='winner-official-schedule-v1'&&r.sport==='NFL'&&Number.isFinite(cutoff)&&Number.isFinite(start)&&Number.isFinite(old)&&start!==old&&
  /^[A-Z]{2,3}$/.test(r.home)&&/^[A-Z]{2,3}$/.test(r.away)&&r.home!==r.away&&
  r.providerGameID===`${r.season}_${String(r.week).padStart(2,'0')}_${r.away}_${r.home}`&&r.baseEventID==='nflverse:'+r.providerGameID&&
  r.revisionHash===scheduleRevisionHash(r)&&r.eventID===r.baseEventID+':schedule:'+r.revisionHash&&
  ['announcementSourceHash','scheduleSourceHash'].every(k=>/^[a-f0-9]{64}$/.test(r[k]))&&
  ['announcementFetchedAt','scheduleFetchedAt','sourceUpdatedAt'].every(k=>Number.isFinite(time(r[k]))&&time(r[k])<=cutoff&&time(r[k])<Math.min(start,old))&&
  time(r.sourceUpdatedAt)<=Math.min(time(r.announcementFetchedAt),time(r.scheduleFetchedAt));
}
function matches(event,r){return event.sport==='NFL'&&[r.baseEventID,r.eventID].includes(event.eventID)&&event.sourceIds?.nflverse===r.providerGameID&&
 event.home?.id===r.home&&event.away?.id===r.away&&event.home.abbreviation===r.home&&event.away.abbreviation===r.away&&
 event.season===r.season&&event.week===r.week&&event.gameDate===r.gameDate&&[r.oldStartsAt,r.startsAt].includes(event.startsAt);}
export function applyOfficialScheduleRevision({event,provider,providerSource,issuedAt,revisions=NFL_SCHEDULE_REVISIONS}){
 const found=revisions.filter(r=>[r.baseEventID,r.eventID].includes(event?.eventID));if(found.length!==1)return null;
 const r=found[0],now=Date.parse(issuedAt),received=Date.parse(providerSource?.fetched_at);
 if(!validScheduleRevision(r,issuedAt)||!matches(event,r)||event.status!=='SCHEDULED'||Date.parse(r.startsAt)<=now||
  provider?.eventID!==r.sourceEventId||provider?.leagueID!=='NFL'||provider.type!=='match'||
  ['started','live','completed','finalized','cancelled','canceled'].some(k=>provider.status?.[k])||
  Date.parse(provider.status?.startsAt)!==Date.parse(r.startsAt)||provider.home!==r.home||provider.away!==r.away||
  !/^[a-f0-9]{64}$/.test(providerSource?.source_hash)||!Number.isFinite(received)||received>now||now-received>60000||received>=Date.parse(r.startsAt)||
  !Number.isFinite(Date.parse(event.sourceFetchedAt))||Date.parse(event.sourceFetchedAt)>now||Date.parse(event.sourceFetchedAt)>=Math.min(Date.parse(r.oldStartsAt),Date.parse(r.startsAt)))return null;
 return {...event,eventID:r.eventID,providerEventID:r.baseEventID,startsAt:r.startsAt,identityVerified:true,identityConflict:undefined,scheduleRevision:r,
  scheduleAgreement:{sourceEventId:r.sourceEventId,sourceHash:providerSource.source_hash,fetchedAt:providerSource.fetched_at,startsAt:r.startsAt,home:r.home,away:r.away}};
}
export function cloneScheduleForRevision(schedule,event){
 const r=event.scheduleRevision;if(!r||!matches(event,r))throw Error('SCHEDULE_REVISION_IDENTITY_INVALID');
 const targets=schedule.filter(g=>g.game_id===r.providerGameID);if(targets.length!==1||targets[0].home_team!==r.home||targets[0].away_team!==r.away||targets[0].gameday!==r.gameDate||Number(targets[0].season)!==r.season||Number(targets[0].week)!==r.week)throw Error('SCHEDULE_REVISION_TARGET_INVALID');
 const wall=value=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));return p.hour+':'+p.minute;};
 if(![wall(r.oldStartsAt),wall(r.startsAt)].includes(targets[0].gametime))throw Error('SCHEDULE_REVISION_TARGET_TIME_INVALID');
 return schedule.map(g=>g===targets[0]?{...g,gametime:wall(r.startsAt)}:g);
}
export function resolveOfficialScheduleFinal(event,observedAt,revisions=NFL_SCHEDULE_REVISIONS){
 const found=revisions.filter(r=>r.baseEventID===event?.eventID);
 if(found.length!==1)return event;
 const r=found[0];if(!validScheduleRevision(r,observedAt)||!matches(event,r)||event.status!=='FINAL'||!Number.isFinite(Date.parse(event.sourceFetchedAt))||Date.parse(event.sourceFetchedAt)<Date.parse(r.startsAt)||Date.parse(event.sourceFetchedAt)>Date.parse(observedAt))return {...event,status:'UNAVAILABLE'};
 return {...event,eventID:r.eventID,providerEventID:r.baseEventID,startsAt:r.startsAt,scheduleRevision:r};
}
