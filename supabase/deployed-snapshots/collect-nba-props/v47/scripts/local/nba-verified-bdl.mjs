import {createHash} from 'node:crypto';
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const hash=x=>createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
export const sourceFingerprint=e=>hash({eventID:e.eventID,leagueID:e.leagueID,startsAt:e.status?.startsAt,completed:e.status?.completed,finalized:e.status?.finalized,cancelled:e.status?.cancelled??false,teams:['home','away'].map(s=>({id:e.teams?.[s]?.teamID,name:e.teams?.[s]?.names?.long})),players:Object.fromEntries(Object.entries(e.players??{}).map(([id,p])=>[id,{playerID:p.playerID,teamID:p.teamID,name:p.name}])),results:e.results?.game});
export function repairVerifiedBdl(e,archive,observedAt){
 const now=Date.parse(observedAt),generated=Date.parse(archive?.generatedAt);
 if(archive?.version!=='nba-verified-bdl-v1'||!Number.isFinite(now)||!Number.isFinite(generated)||generated>now)throw Error('BDL_ARCHIVE_PROVENANCE');
 const matches=archive.games.filter(g=>g.summary.id==='sgo:'+e.eventID);
 if(matches.length!==1)throw Error('BDL_ARCHIVE_NOT_UNIQUE');
 const row=matches[0],g=row.summary;
 if(row.sourceFingerprint!==sourceFingerprint(e))throw Error('BDL_SOURCE_CHANGED');
 if(g.sourceContract!=='sgo-nba-bdl-backup-v1'||g.startsAt!==e.status.startsAt||!Number.isFinite(Date.parse(g.observedAt))||Date.parse(g.observedAt)>now||Date.parse(g.observedAt)<=Date.parse(g.startsAt)||!/^[a-f0-9]{64}$/.test(g.backupEvidence?.sourceSha256??''))throw Error('BDL_SUMMARY_PROVENANCE');
 return {...g,observedAt,backupEvidence:{...g.backupEvidence,verifiedAt:g.observedAt,archiveSha256:hash(archive)}};
}
