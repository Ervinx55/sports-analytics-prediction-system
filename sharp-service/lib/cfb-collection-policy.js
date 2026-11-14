import {reviewedKickoffs} from './cfb-reviewed-identities.js';
export function providerWindow(previous,now){
 const bucket=Math.floor(now/3600000)*3600000;
 // Retain the earlier provider time only for an exact reviewed conflict while
 // its verified schedule is still pregame. Normal windows remain unchanged.
 const retained=reviewedKickoffs.filter(r=>Date.parse(r.providerStartsAt)<=now&&Date.parse(r.verifiedStartsAt)>now).map(r=>Date.parse(r.providerStartsAt)-1);
 const start=Math.min(bucket,...retained);
 if(previous?.cursor&&typeof previous.cursor==='string'&&previous.cursor.length<=2000&&Number.isFinite(Date.parse(previous.startsAfter))&&Date.parse(previous.startsAfter)<=start&&now-Date.parse(previous.startsAfter)<4*3600000&&now>=Date.parse(previous.startsAfter))return previous;
 return {startsAfter:new Date(start).toISOString(),startsBefore:new Date(bucket+48*3600000).toISOString(),cursor:null,pages:0};
}
export function mergeCurrentForecasts(current,previous,modelVersion,now){
 const map=new Map((previous||[]).filter(f=>f.modelVersion===modelVersion&&Date.parse(f.startsAt)>now&&now-Date.parse(f.generatedAt)>=0&&now-Date.parse(f.generatedAt)<=30*60000).map(f=>[f.eventID,f]));
 for(const f of current)map.set(f.eventID,f);return [...map.values()];
}
export function mergeSeasonSchedules(regular,postseason){
 if(regular.teamID!==postseason.teamID||regular.season!==postseason.season)throw Error('POSTSEASON_IDENTITY_MISMATCH');
 const ids=new Set(regular.games.map(g=>g.id));if(postseason.games.some(g=>ids.has(g.id)))throw Error('POSTSEASON_DUPLICATE_EVENT');
 return {...regular,games:[...regular.games,...postseason.games],postseasonComplete:true};
}
import {contentHash} from './cfb-evaluation.js';
export function captureCandidate(f,event,observedAt,inputHash){
 const blocked=f.quoteComparisonEligible===false;
 return {event_id:f.eventID,model_version:f.modelVersion,starts_at:f.startsAt,input_hash:inputHash,forecast:{...f,entryQuotes:blocked?{}:event?.odds||{},entryQuoteObservedAt:observedAt,entryQuoteWithheldReason:blocked?'PROVIDER_KICKOFF_CONFLICT':null}};
}
export function outcomeRevision(prediction,final){
 if(!final||!Number.isFinite(Date.parse(final.fetchedAt)))return null;
 const rescheduled=Date.parse(final.startsAt)!==Date.parse(prediction.starts_at);
 if(!final.completed&&!rescheduled&&!final.cancelled)return null;
 const outcome={espnEventID:final.id,homeScore:final.homeScore,awayScore:final.awayScore,rescheduled,valid:final.completed&&!rescheduled&&!final.cancelled&&Number.isInteger(final.homeScore)&&Number.isInteger(final.awayScore)&&final.homeScore!==final.awayScore,source:'ESPN',fetchedAt:final.fetchedAt};
 return {event_id:prediction.event_id,evidence_hash:contentHash(outcome),outcome};
}
