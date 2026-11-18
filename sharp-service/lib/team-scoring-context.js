// Descriptive scoring evidence only. Never used to calculate model features or probabilities.
import {availableAfter} from './cfb-model.js';
import {NFL_SCHEDULE_REVISIONS,validScheduleRevision} from './winner-schedule-revisions.js';

const DAY = 86400000;
const easternFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const easternTimeFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const easternDay = value => easternFormat.format(new Date(value));
const time = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
const iso = value => Number.isFinite(time(value)) ? new Date(value).toISOString() : null;
const identity = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(value);
const integer = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const score = (value, maximum) => {
  const result = integer(value);
  return result !== null && result >= 0 && result <= maximum ? result : null;
};
const descriptions = {
  NBA: {source:'ESPN NBA scoreboard',label:'Prior 21-day sample',scope:'Prior 21 Eastern calendar-day sample; prior slates only. Unweighted full-game points, including overtime. Available history, not a complete season.'},
  NFL: {source:'nflverse schedule/game data',label:'Current-season regular-season sample',scope:'Current season regular-season verified schedule sample; prior Eastern dates and weeks only. Unweighted full-game points, including overtime; separate from weighted model inputs.'},
  CFB: {source:'ESPN reconciled FBS schedules',label:'Current-season FBS-opponent sample',scope:'Current season FBS-versus-FBS sample; completion buffer applied. Unweighted full-game points, including overtime. Games against non-FBS opponents are excluded.'}
};

// nflverse times are Eastern local times. Require an exact, unambiguous instant.
function nflStart(game) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(game.gameday || '') || !/^\d{2}:\d{2}$/.test(game.gametime || '')) return null;
  const wall = Date.parse(`${game.gameday}T${game.gametime}:00Z`);
  if (!Number.isFinite(wall)) return null;
  const matches = [4,5].map(hours => wall + hours*3600000).filter(value => {
    const parts = Object.fromEntries(easternTimeFormat.formatToParts(new Date(value)).map(part => [part.type,part.value]));
    return `${parts.year}-${parts.month}-${parts.day}` === game.gameday && `${parts.hour}:${parts.minute}` === game.gametime;
  });
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
}

function normalizeGame(sport, game) {
  if (!game || typeof game !== 'object') return null;
  let row;
  if (sport === 'NBA') {
    row = {id:game.eventId,start:iso(game.startsAt),home:game.home,away:game.away,
      homeScore:score(game.homeScore,250),awayScore:score(game.awayScore,250),completed:game.completed === true,
      eligible:true,observedAt:game.observedAt ?? null};
  } else if (sport === 'NFL') {
    const season = integer(game.season),week = integer(game.week);
    const homeScore = score(game.home_score,99),awayScore = score(game.away_score,99);
    const validResult = (typeof game.result === 'number' || typeof game.result === 'string' && /^-?\d+$/.test(game.result)) && Number(game.result) === homeScore-awayScore;
    row = {id:game.game_id,start:nflStart(game),home:game.home_team,away:game.away_team,homeScore,awayScore,season,week,
      completed:homeScore !== null && awayScore !== null && validResult,
      eligible:season !== null && week !== null && week > 0 && game.game_id === `${season}_${String(week).padStart(2,'0')}_${game.away_team}_${game.home_team}`,
      regular:game.game_type === 'REG',observedAt:game.fetchedAt ?? null};
  } else {
    row = {id:game.id,start:iso(game.startsAt),home:game.homeID,away:game.awayID,
      homeScore:score(game.homeScore,200),awayScore:score(game.awayScore,200),season:integer(game.season),
      completed:game.completed === true,eligible:game.cancelled !== true && game.fbsVerified === true && typeof game.neutralSite === 'boolean',
      availableAt:availableAfter(game),observedAt:game.fetchedAt ?? null};
  }
  if (!identity(row.id)) return null;
  row.validIdentity = identity(row.home) && identity(row.away) && row.home !== row.away && row.start !== null;
  return row;
}

function deduplicate(rows) {
  const unique = new Map(),conflicts = new Set();
  for (const row of rows) {
    if (!row) continue;
    const {observedAt,...evidence} = row;
    const fingerprint = JSON.stringify(evidence),old = unique.get(row.id);
    if (old && old.fingerprint !== fingerprint) conflicts.add(row.id);
    else if (!old || time(observedAt) > time(old.row.observedAt) || !old.row.observedAt && observedAt) unique.set(row.id,{row,fingerprint});
  }
  return [...unique.values()].map(value => value.row).filter(row => !conflicts.has(row.id));
}

function reviewedNflTarget(rows,event,cutoffAt) {
  const revisions = NFL_SCHEDULE_REVISIONS.filter(revision => validScheduleRevision(revision,cutoffAt) &&
    event.eventId === revision.sourceEventId && event.season === revision.season && iso(event.startsAt) === revision.startsAt &&
    event.home.teamId === revision.home && event.away.teamId === revision.away && easternDay(event.startsAt) === revision.gameDate);
  if (revisions.length !== 1) return null;
  const revision = revisions[0];
  const targets = rows.filter(row => row.validIdentity && row.eligible && row.regular && row.id === revision.providerGameID &&
    row.season === revision.season && row.week === revision.week && row.home === revision.home && row.away === revision.away &&
    row.start === revision.oldStartsAt && easternDay(row.start) === revision.gameDate);
  return targets.length === 1 ? {target:targets[0],revision} : null;
}

function sideContext(side, games, label, missingReason) {
  const own = games.filter(game => [game.home,game.away].includes(side?.teamId));
  const windows = [['history',null,label],['last5',5,'Last 5 within this sample'],['last10',10,'Last 10 within this sample']].map(([key,requestedGames,windowLabel]) => {
    const sample = requestedGames === null ? own : own.slice(0,requestedGames);
    const sum = field => sample.reduce((total,game) => total + game[game.home === side.teamId ? field === 'for' ? 'homeScore' : 'awayScore' : field === 'for' ? 'awayScore' : 'homeScore'],0);
    return {key,label:windowLabel,pointsFor:sample.length ? sum('for')/sample.length : null,
      pointsAgainst:sample.length ? sum('against')/sample.length : null,gameCount:sample.length,requestedGames,
      gameIds:sample.map(game => game.id),latestGameAt:sample[0]?.start ?? null,
      missingReason:sample.length ? null : missingReason || 'No eligible completed games in this scope.'};
  });
  return {teamId:side?.teamId ?? null,teamName:side?.teamName || side?.teamId || null,windows};
}

/**
 * event uses exact source team IDs: {eventId, startsAt, season?, home:{teamId,teamName}, away:{teamId,teamName}}.
 * games retain their existing sport adapter shape. Unknown source receipt time remains null.
 */
export function buildTeamScoringContext({sport,event,games=[],cutoffAt,observedAt=null}) {
  const description = descriptions[sport];
  if (!description) throw Error('UNSUPPORTED_SCORING_CONTEXT_SPORT');
  const cutoff = time(cutoffAt),start = time(event?.startsAt);
  let missingReason = null;
  if (!Number.isFinite(cutoff) || !Number.isFinite(start) || cutoff >= start) missingReason = 'A valid pregame cutoff is required.';
  if (!identity(event?.eventId) || !identity(event?.home?.teamId) || !identity(event?.away?.teamId) || event.home.teamId === event.away.teamId) missingReason = 'Target team or event identity is unavailable.';
  if (observedAt !== null && (!Number.isFinite(time(observedAt)) || time(observedAt) > cutoff)) missingReason = 'Source receipt is invalid or later than the cutoff.';
  let candidates = Array.isArray(games) ? games : [];
  if (sport === 'NFL') {
    // The schedule contains decades of games. Parse dates only for relevant IDs,
    // retaining every variant of those IDs so identity/status conflicts still fail closed.
    const teams = [event?.home?.teamId,event?.away?.teamId].filter(identity);
    const ids = new Set(candidates.filter(game => integer(game?.season) === event?.season && game?.game_type === 'REG' &&
      [game.home_team,game.away_team].some(team => teams.includes(team))).map(game => game.game_id));
    candidates = candidates.filter(game => ids.has(game?.game_id));
  }
  const rows = deduplicate(candidates.map(game => normalizeGame(sport,game)));
  let target = null,targetScheduleEvidence = null;
  if (sport === 'NFL' && !missingReason) {
    const targets = rows.filter(row => row.validIdentity && row.eligible && row.regular && row.season === event.season && row.start === iso(event.startsAt) && row.home === event.home.teamId && row.away === event.away.teamId);
    if (targets.length === 1) target = targets[0];
    else if (targets.length === 0) {
      // A reviewed kickoff correction may identify the target week. Never change
      // raw schedule times, scoring history or inference, and never revive rows
      // removed by duplicate conflict detection above.
      const reviewed = reviewedNflTarget(rows,event,cutoffAt);
      if (reviewed) {
        target = reviewed.target;
        const revision = reviewed.revision;
        targetScheduleEvidence = Object.fromEntries(['contract','revisionHash','providerGameID','sourceEventId','oldStartsAt','startsAt',
          'announcementUrl','scheduleUrl','announcementFetchedAt','scheduleFetchedAt','sourceUpdatedAt'].map(key => [key,revision[key]]));
      }
    }
    if (!target) missingReason = 'Exact target schedule identity is unavailable or conflicting.';
  }
  if (sport === 'CFB' && (event?.fbsVerified !== true || !Number.isInteger(event?.season))) missingReason = 'Target season or FBS identity is unavailable.';
  const targetDay = Number.isFinite(start) ? easternDay(event.startsAt) : null;
  const oldestDay = targetDay ? Date.parse(targetDay)-21*DAY : NaN;
  const eligible = missingReason ? [] : rows.filter(row => {
    if (!row.validIdentity || !row.eligible || !row.completed || row.homeScore === null || row.awayScore === null || row.id === event.eventId || time(row.start) >= cutoff) return false;
    if (row.observedAt !== null && (!Number.isFinite(time(row.observedAt)) || time(row.observedAt) > cutoff)) return false;
    if (sport === 'NBA') return row.homeScore !== row.awayScore && easternDay(row.start) < targetDay && Date.parse(easternDay(row.start)) >= oldestDay;
    if (sport === 'NFL') return row.regular && row.season === event.season && row.week < target.week && easternDay(row.start) < targetDay && row.id !== target.id;
    return row.homeScore !== row.awayScore && row.season === event.season && row.availableAt < cutoff;
  }).sort((a,b) => time(b.start)-time(a.start) || a.id.localeCompare(b.id));
  const relevant = eligible.filter(row => [row.home,row.away].some(team => [event?.home?.teamId,event?.away?.teamId].includes(team)));
  const receipts = relevant.map(row => time(row.observedAt)).filter(Number.isFinite);
  const receipt = observedAt === null ? receipts.length ? new Date(Math.max(...receipts)).toISOString() : null : iso(observedAt);
  return {contract:'team-scoring-context-v1',purpose:'EXPLANATION_ONLY',adjustmentApplied:false,sport,
    cutoffAt:iso(cutoffAt),source:description.source+(targetScheduleEvidence ? '; NFL official schedule correction' : ''),observedAt:receipt,
    scope:description.scope+(targetScheduleEvidence ? ' Target kickoff uses a previously verified NFL schedule correction; scoring history is unchanged.' : ''),
    ...(targetScheduleEvidence ? {targetScheduleEvidence} : {}),
    home:sideContext(event?.home,eligible,description.label,missingReason),away:sideContext(event?.away,eligible,description.label,missingReason)};
}
