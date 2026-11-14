export function providerWindow(previous,now){
 if(previous?.cursor&&typeof previous.cursor==='string'&&previous.cursor.length<=2000&&Number.isFinite(Date.parse(previous.startsAfter))&&now-Date.parse(previous.startsAfter)<4*3600000&&now>=Date.parse(previous.startsAfter))return previous;
 const start=Math.floor(now/3600000)*3600000;
 return {startsAfter:new Date(start).toISOString(),startsBefore:new Date(start+48*3600000).toISOString(),cursor:null,pages:0};
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
export function outcomeRevision(prediction,final){
 if(!final||!Number.isFinite(Date.parse(final.fetchedAt)))return null;
 const rescheduled=Date.parse(final.startsAt)!==Date.parse(prediction.starts_at);
 if(!final.completed&&!rescheduled&&!final.cancelled)return null;
 const outcome={espnEventID:final.id,homeScore:final.homeScore,awayScore:final.awayScore,rescheduled,valid:final.completed&&!rescheduled&&!final.cancelled&&Number.isInteger(final.homeScore)&&Number.isInteger(final.awayScore)&&final.homeScore!==final.awayScore,source:'ESPN',fetchedAt:final.fetchedAt};
 return {event_id:prediction.event_id,evidence_hash:contentHash(outcome),outcome};
}
