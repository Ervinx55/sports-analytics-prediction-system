import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {resolve,join} from 'node:path';
import {NFL_SCHEDULE_REVISIONS,validScheduleRevision} from '../../sharp-service/lib/winner-schedule-revisions.js';
const [sourceDirectory,outputDirectory]=process.argv.slice(2);
if(!sourceDirectory||!outputDirectory)throw Error('Usage: node prepare-winner-schedule-registration.mjs SOURCE_DIRECTORY OUTPUT_DIRECTORY');
const read=name=>readFileSync(join(sourceDirectory,name),'utf8'),manifest=JSON.parse(read('manifest.json'));
const sha=text=>createHash('sha256').update(text).digest('hex');
const sources=['nfl-flex-announcement','nfl-week11-schedule'].map(name=>{
 const receipt=manifest.find(r=>r.name===name),rawText=read(name+'.html');
 if(receipt?.status!==200||sha(rawText)!==receipt.rawSha256||receipt.resolvedUrl!==receipt.url)throw Error('OFFICIAL_SOURCE_BYTES_OR_URL_CHANGED');
 return {source_hash:sha(JSON.stringify({sourceUrl:receipt.url,rawSha256:receipt.rawSha256})),source_url:receipt.url,fetched_at:receipt.fetchedAt,
  body:name==='nfl-flex-announcement'?{rawText,rawSha256:receipt.rawSha256}:{rawEncoding:'gzip-base64',rawBase64:gzipSync(rawText).toString('base64'),rawSha256:receipt.rawSha256}};
});
for(const revision of NFL_SCHEDULE_REVISIONS){
 if(!validScheduleRevision(revision,new Date().toISOString())||revision.announcementSourceHash!==sources[0].source_hash||revision.announcementFetchedAt!==sources[0].fetched_at||revision.scheduleSourceHash!==sources[1].source_hash||revision.scheduleFetchedAt!==sources[1].fetched_at)throw Error('REVIEWED_REVISION_SOURCE_CHANGED');
 const fact=revision.awayName+' at '+revision.homeName+' game will move to '+revision.officialTimeText;
 if(!sources[0].body.rawText.includes(fact)||!sources[0].body.rawText.includes('Sunday, Nov. 22')||!sources[0].body.rawText.includes(revision.sourceUpdatedAt.replace('.000Z','Z')))throw Error('ANNOUNCEMENT_FACT_CHANGED');
 const raw=read('nfl-week11-schedule.html'),slug=revision.awayName.split(' ').at(-1).toLowerCase()+'-at-'+revision.homeName.split(' ').at(-1).toLowerCase(),i=raw.indexOf('href="/games/'+slug+'-2026-reg-11"');
 if(i<0||!raw.slice(i-600,i).includes(revision.officialGameID)||!raw.slice(i,i+1600).includes('dateTime="'+revision.startsAt+'"'))throw Error('OFFICIAL_SCHEDULE_GAME_ID_OR_START_CHANGED');
}
const payload={p_sources:sources,p_revisions:NFL_SCHEDULE_REVISIONS};
writeFileSync(join(outputDirectory,'schedule-registration-payload.json'),JSON.stringify(payload));
const migration=readFileSync(new URL('../../supabase/migrations/20261117173646_winner_official_schedule_revisions.sql',import.meta.url),'utf8');
const tests=readFileSync(new URL('../../tests/sql/winner-official-schedule-revisions.sql',import.meta.url),'utf8');
const literal="'"+JSON.stringify(payload).replaceAll("'","''")+"'";
writeFileSync(join(outputDirectory,'schedule-migration-rollback.sql'),"begin;\nset local statement_timeout='30s';\nset local lock_timeout='5s';\n"+migration+"\nselect set_config('winner.schedule_registration_fixture',"+literal+",true);\n"+tests+'\nrollback;\n');
console.log(JSON.stringify({status:'REVIEW_READY_NOT_APPLIED',revisions:NFL_SCHEDULE_REVISIONS.length,officialSources:sources.length,outputDirectory:resolve(outputDirectory)}));
