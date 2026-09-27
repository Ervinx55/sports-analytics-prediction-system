import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFrozenPolicy } from './validate-nba-holdout.mjs';
import { normalizeTeam } from '../../sharp-service/lib/nba-model.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
const number = value => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const score = c => number(c?.score?.value ?? c?.score);
const team = t => ({ id: Number(t.id), full_name: t.displayName, abbreviation: normalizeTeam(t.displayName) || normalizeTeam(t.abbreviation) });
const validId = id => Number.isSafeInteger(Number(id)) && Number(id)>0;

export function normalizeEspnGame(event, season) {
  const c = event.competitions?.[0];
  if (!c?.status?.type?.completed) return null;
  // The Cup championship is labeled regular season by ESPN but is not
  // part of official regular-season player/team totals.
  if (c.type?.type === 'commissioners-cup' || c.notes?.some(n => /NBA Cup Championship/i.test(n.headline || ''))) return null;
  const date = new Date(c.date || event.date);
  const sourceSeason = Number(event.season?.year);
  const type = Number(event.seasonType?.type ?? event.season?.type);
  if (sourceSeason !== season + 1 || type !== 2 || !Number.isFinite(+date)) return null;
  const home = c.competitors?.find(x => x.homeAway === 'home');
  const away = c.competitors?.find(x => x.homeAway === 'away');
  if (!home?.team || !away?.team || score(home) === null || score(away) === null) throw new Error('Incomplete ESPN final score');
  const homeTeam = team(home.team), awayTeam = team(away.team);
  if (!homeTeam.abbreviation || !awayTeam.abbreviation || !validId(homeTeam.id) || !validId(awayTeam.id) || homeTeam.id===awayTeam.id) throw new Error('Unknown ESPN team');
  if(!validId(event.id || c.id) || [score(home),score(away)].some(value=>!Number.isInteger(value)||value<0)) throw new Error('Invalid ESPN game identity or score');
  return { id: Number(event.id || c.id), source: 'ESPN', season, datetime: date.toISOString(), date: date.toISOString().slice(0,10),
    status: 'Final', status_state: 'final', postseason: false, home_team: homeTeam, visitor_team: awayTeam,
    home_team_id: homeTeam.id, visitor_team_id: awayTeam.id, home_team_score: score(home), visitor_team_score: score(away) };
}

export function normalizeEspnSummary(payload, season) {
  const game = normalizeEspnGame(payload.header || {}, season);
  if (!game) throw new Error('ESPN summary is not a final regular-season game in the requested season');
  const rows = [];
  const identities=new Set();
  for (const block of payload.boxscore?.players || []) {
    const currentTeam = team(block.team);
    if (![game.home_team_id, game.visitor_team_id].includes(currentTeam.id)) throw new Error('Boxscore team does not match game');
    for (const group of block.statistics || []) {
      for (const entry of group.athletes || []) {
        if (entry.didNotPlay) continue;
        if (!validId(entry.athlete?.id) || !entry.athlete?.displayName?.trim()) throw new Error('Invalid ESPN player identity');
        if (!entry.stats?.length || !Array.isArray(group.labels) || group.labels.length!==entry.stats.length) throw new Error('Incomplete ESPN player stats');
        const stats = Object.fromEntries(group.labels.map((label,i) => [label, entry.stats[i]]));
        if (stats.MIN === '--' && entry.stats.slice(1).every(value => /^[-+]?0(?:-0)?$/.test(value))) continue;
        if (number(stats.MIN) === null || number(stats.MIN)<0 || ['PTS','REB','AST','TO','STL','BLK','OREB','DREB'].some(key=>!Number.isInteger(number(stats[key]))||number(stats[key])<0)) throw new Error('Invalid ESPN player stats');
        const name = String(entry.athlete.displayName || '').trim().split(/\s+/);
        const pair = key => String(stats[key] || '').split('-').map(number);
        const [fgm,fga] = pair('FG'), [fg3m,fg3a] = pair('3PT'), [ftm,fta] = pair('FT');
        if([fgm,fga,fg3m,fg3a,ftm,fta].some(value=>!Number.isInteger(value)||value<0) || fgm>fga || fg3m>fg3a || ftm>fta) throw new Error('Invalid ESPN shooting stats');
        if(identities.has(Number(entry.athlete.id))) throw new Error('Duplicate ESPN player row');
        identities.add(Number(entry.athlete.id));
        rows.push({ id: `espn:${game.id}:${entry.athlete.id}`, source: 'ESPN', game, team: currentTeam,
          player: { id: Number(entry.athlete.id), first_name: name.shift(), last_name: name.join(' '), position: entry.athlete.position?.abbreviation || null },
          min: String(stats.MIN), pts: number(stats.PTS), reb: number(stats.REB), ast: number(stats.AST),
          turnover: number(stats.TO), stl: number(stats.STL), blk: number(stats.BLK), oreb: number(stats.OREB), dreb: number(stats.DREB),
          fgm,fga,fg3m,fg3a,ftm,fta });
      }
    }
  }
  for (const [id,total] of [[game.home_team_id,game.home_team_score],[game.visitor_team_id,game.visitor_team_score]]) {
    if (rows.filter(r=>r.team.id===id).reduce((sum,r)=>sum+r.pts,0) !== total) throw new Error('ESPN boxscore points do not reconcile to final score');
  }
  return { game, rows };
}

// ESPN's 2025-26 summaries contain an obsolete Olbrich identity (5091709).
// Canonical identity: https://www.espn.com/nba/player/_/id/5107156/lachlan-olbrich
// Recover actual game statistics from ESPN; never infer values from score gaps.
export async function repairEspnIdentity(payload, season, request) {
  const repaired=structuredClone(payload), corrections=[];
  for(const block of repaired.boxscore?.players || []) for(const group of block.statistics || []) for(const entry of group.athletes || []) {
    if(entry.athlete?.id || entry.athlete?.shortName!=='Olbrich' || entry.didNotPlay) continue;
    const gameId=repaired.header.id, athleteId='5107156';
    const athleteUrl=`${CORE}/seasons/${season+1}/athletes/${athleteId}?lang=en&region=us`;
    const statsUrl=`${CORE}/events/${gameId}/competitions/${gameId}/competitors/${block.team.id}/roster/${athleteId}/statistics/0?lang=en&region=us`;
    const athlete=await request(athleteUrl), raw=await request(statsUrl);
    if(String(athlete.id)!==athleteId || athlete.displayName!=='Lachlan Olbrich' || !raw.$ref?.includes(`/events/${gameId}/`) || !raw.$ref?.includes(`/roster/${athleteId}/`)) throw new Error('ESPN identity correction provenance mismatch');
    const values=Object.fromEntries((raw.splits?.categories||[]).flatMap(c=>c.stats||[]).map(s=>[s.name,s.value]));
    const stat=name=>{if(!Number.isFinite(values[name])) throw new Error(`Missing ESPN correction stat: ${name}`);return values[name];};
    const pair=(made,attempted)=>`${stat(made)}-${stat(attempted)}`;
    const mapped={MIN:stat('minutes'),PTS:stat('points'),FG:pair('fieldGoalsMade','fieldGoalsAttempted'),
      '3PT':pair('threePointFieldGoalsMade','threePointFieldGoalsAttempted'),FT:pair('freeThrowsMade','freeThrowsAttempted'),
      REB:stat('rebounds'),AST:stat('assists'),TO:stat('turnovers'),STL:stat('steals'),BLK:stat('blocks'),
      OREB:stat('offensiveRebounds'),DREB:stat('defensiveRebounds'),PF:stat('fouls'),'+/-':stat('plusMinus')};
    entry.athlete=athlete;
    entry.stats=group.labels.map(label=>{if(mapped[label]===undefined) throw new Error(`Unknown ESPN correction label: ${label}`);return String(mapped[label]);});
    corrections.push({gameId,teamId:block.team.id,athleteId,athleteUrl,statsUrl,reason:'Obsolete athlete identity in game summary'});
  }
  return {payload:repaired,corrections};
}

const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function main() {
  const arg = (name,fallback) => process.argv.find(x=>x.startsWith(`--${name}=`))?.split('=').slice(1).join('=') || fallback;
  const season = Number(arg('season','2024'));
  if (![2024,2025].includes(season)) throw new Error('Only development 2024 or frozen holdout 2025 is supported');
  if (season === 2025) readFrozenPolicy(arg('frozen-policy',''));
  const output = arg('output-dir',`artifacts/nba-espn-${season}`);
  const priorManifest=path.join(output,'manifest.json');
  if(fs.existsSync(priorManifest) && JSON.parse(fs.readFileSync(priorManifest)).season!==season) throw new Error('Use separate development and holdout directories');
  const cache = arg('cache-dir','artifacts/nba-espn-cache');
  fs.mkdirSync(output,{recursive:true}); fs.mkdirSync(cache,{recursive:true});
  const request = async (suffix) => {
    const url=suffix.startsWith(CORE+'/')?suffix:BASE+suffix, file=path.join(cache,createHash('sha256').update(url).digest('hex')+'.json');
    if(fs.existsSync(file)) return JSON.parse(fs.readFileSync(file)).payload;
    for(let attempt=0;attempt<3;attempt++) {
      const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
      if(response.status===429 || response.status>=500) {
        if(attempt===2) throw new Error(`ESPN ${response.status}: ${suffix}`);
        const retry=Number(response.headers.get('retry-after'));
        await pause(Number.isFinite(retry)&&retry>0?retry*1000:1000*2**attempt); continue;
      }
      if(!response.ok) throw new Error(`ESPN ${response.status}: ${suffix}`);
      const payload=await response.json();
      fs.writeFileSync(file,JSON.stringify({url,retrievedAt:new Date().toISOString(),payload}));
      await pause(250); return payload;
    }
  };
  const listing=await request('/teams?limit=100');
  const teams=listing.sports?.[0]?.leagues?.[0]?.teams || [];
  if(teams.length!==30) throw new Error('Expected all 30 NBA teams');
  const games=new Map();
  for(const {team:t} of teams) {
    const schedule=await request(`/teams/${t.id}/schedule?season=${season+1}&seasontype=2`);
    for(const event of schedule.events || []) { const game=normalizeEspnGame(event,season); if(game) games.set(game.id,game); }
  }
  const ordered=[...games.values()].sort((a,b)=>a.datetime.localeCompare(b.datetime));
  if(ordered.length!==1230) throw new Error(`Incomplete development schedule: ${ordered.length} games`);
  fs.writeFileSync(path.join(output,'games.json'),JSON.stringify(ordered));
  const rows=[], corrections=[];
  for(const [i,game] of ordered.entries()) {
    const repaired=await repairEspnIdentity(await request(`/summary?event=${game.id}`),season,request);
    corrections.push(...repaired.corrections);
    const normalized=normalizeEspnSummary(repaired.payload,season);
    if(normalized.game.id!==game.id) throw new Error('ESPN returned another game');
    rows.push(...normalized.rows);
    if((i+1)%50===0) console.log(`ESPN ${i+1}/${ordered.length} games, ${rows.length} player rows`);
  }
  fs.writeFileSync(path.join(output,'player-stats.json'),JSON.stringify(rows));
  const manifest={source:'ESPN',season,generatedAt:new Date().toISOString(),games:ordered.length,playerRows:rows.length,holdoutTouched:season===2025,corrections,
    limitations:'Final boxscores retrieved retrospectively; historical injury/lineup publication timestamps and historical sportsbook prices are not supplied. No production promotion.',
    sha256:Object.fromEntries(['games.json','player-stats.json'].map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(output,name))).digest('hex')]))};
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)); console.log(JSON.stringify(manifest));
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) await main();
