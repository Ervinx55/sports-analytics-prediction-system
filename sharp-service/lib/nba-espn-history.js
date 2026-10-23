import { normalizeTeam, seasonForDate } from "./nba-model.js";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const cache = new Map();
const id = value => /^(?:[1-9]\d*)$/.test(String(value ?? "")) &&
  Number.isSafeInteger(Number(value)) ? String(value) : null;
const time = value => typeof value === "string" &&
  /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
  ? Date.parse(value) : null;
const score = value => /^(?:0|[1-9]\d*)$/.test(String(value ?? "")) &&
  Number.isSafeInteger(Number(value)) ? Number(value) : null;
const dateKey = ms => new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");
const unavailable = reason => ({ ok: false, reason, games: [], retrievedAt: null });

function datesBefore(target, count) {
  const day = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Array.from({ length: count }, (_, index) => dateKey(day - (index + 1) * 86400000));
}

function finalGame(event, retrievedAt) {
  const eventId = id(event?.id), competition = event?.competitions?.[0];
  if (!eventId || event.uid !== `s:40~l:46~e:${eventId}` ||
      event.competitions?.length !== 1 || id(competition?.id) !== eventId)
    return { error: "INVALID_EVENT_IDENTITY" };
  // ESPN type 2 is the NBA regular season. Missing season evidence is unusable.
  if (Number(event.season?.type) !== 2) return null;
  const status = competition.status?.type;
  if (status?.name !== "STATUS_FINAL" || status.completed !== true || status.state !== "post")
    return null;
  const rows = competition.competitors;
  if (!Array.isArray(rows) || rows.length !== 2 ||
      rows.filter(row => row.homeAway === "home").length !== 1 ||
      rows.filter(row => row.homeAway === "away").length !== 1)
    return { error: "INVALID_FINAL" };
  const home = rows.find(row => row.homeAway === "home");
  const away = rows.find(row => row.homeAway === "away");
  const homeId = id(home.id), awayId = id(away.id);
  const homeName = home.team?.displayName, awayName = away.team?.displayName;
  const homeTeam = normalizeTeam(homeName), awayTeam = normalizeTeam(awayName);
  const starts = time(competition.date ?? event.date);
  const homeScore = score(home.score), awayScore = score(away.score);
  if (!homeId || !awayId || homeId === awayId ||
      id(home.team?.id) !== homeId || id(away.team?.id) !== awayId ||
      !homeTeam || !awayTeam || homeTeam === awayTeam ||
      starts === null || starts > retrievedAt ||
      homeScore === null || awayScore === null)
    return { error: "INVALID_FINAL" };
  return { id: eventId, datetime: new Date(starts).toISOString(),
    season: seasonForDate(new Date(starts)), status_state: "final",
    home_team: { id: homeId, full_name: homeName },
    visitor_team: { id: awayId, full_name: awayName },
    home_team_score: homeScore, visitor_team_score: awayScore };
}

async function fetchDay(date, { fetchImpl, clock, timeoutMs }) {
  const now = time(clock());
  if (now === null) return unavailable("INVALID_CLOCK");
  const hit = cache.get(date);
  if (hit && now >= hit.cachedAt && now - hit.cachedAt < 30000) return hit.value;
  try {
    const response = await fetchImpl(`${BASE}?dates=${date}`, {
      headers: { accept: "application/json" }, cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return unavailable(`ESPN_HTTP_${response.status}`);
    const raw = await response.text();
    if (raw.length > 2_000_000) return unavailable("ESPN_PAGE_TOO_LARGE");
    const body = JSON.parse(raw);
    const retrievedAt = time(clock());
    if (retrievedAt === null) return unavailable("INVALID_CLOCK");
    if (!Array.isArray(body?.leagues) ||
        !body.leagues.some(row => id(row?.id) === "46" && row.uid === "s:40~l:46") ||
        !Array.isArray(body.events) || body.events.length > 100)
      return unavailable("INVALID_SCOREBOARD");
    const games = body.events.map(event => finalGame(event, retrievedAt));
    if (games.some(game => game?.error)) return unavailable("INVALID_SCOREBOARD");
    const value = { ok: true, games: games.filter(Boolean),
      retrievedAt: new Date(retrievedAt).toISOString() };
    cache.set(date, { cachedAt: retrievedAt, value });
    if (cache.size > 48) cache.delete(cache.keys().next().value);
    return value;
  } catch (error) {
    return unavailable(error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "ESPN_TIMEOUT" : "ESPN_FETCH_FAILED");
  }
}

async function loadDays(dates, options) {
  const results = new Array(dates.length);
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < dates.length) {
      const index = next++;
      results[index] = await fetchDay(dates[index], options);
    }
  }));
  const failure = results.find(result => !result.ok);
  if (failure) return failure;
  return { ok: true, games: results.flatMap(result => result.games),
    retrievedAt: new Date(Math.max(...results.map(result => time(result.retrievedAt)))).toISOString(),
    dates };
}

function verifyIdentity(games) {
  const ids = new Set(), byId = new Map(), byTeam = new Map();
  for (const game of games) {
    if (ids.has(game.id)) return false;
    ids.add(game.id);
    for (const team of [game.home_team, game.visitor_team]) {
      const normalized = normalizeTeam(team.full_name);
      if (!normalized || byId.has(team.id) && byId.get(team.id) !== normalized ||
          byTeam.has(normalized) && byTeam.get(normalized) !== team.id) return false;
      byId.set(team.id, normalized);
      byTeam.set(normalized, team.id);
    }
  }
  return true;
}

/** Present-time, bounded ESPN regular-season finals. No historical as-of claim. */
export async function loadNbaEspnHistory({ targetAt, teams = [], fetchImpl = fetch,
  clock = () => new Date().toISOString(), timeoutMs = 2500 } = {}) {
  const target = time(targetAt), now = time(clock());
  if (target === null || now === null || target < now - 86400000 ||
      target > now + 8 * 86400000 || !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 || timeoutMs > 5000 || !Array.isArray(teams) || teams.length > 30)
    return unavailable("INVALID_REQUEST");
  const current = await loadDays(datesBefore(new Date(Math.min(target, now)), 12),
    { fetchImpl, clock, timeoutMs });
  if (!current.ok) return current;
  let combined = current;
  const counts = new Map();
  for (const game of current.games) for (const side of ["home_team", "visitor_team"]) {
    const team = normalizeTeam(game[side].full_name);
    counts.set(team, (counts.get(team) || 0) + 1);
  }
  if (teams.some(team => (counts.get(team) || 0) < 3)) {
    const priorYear = seasonForDate(new Date(target));
    const previous = await loadDays(Array.from({ length: 12 }, (_, index) =>
      dateKey(Date.UTC(priorYear, 3, 12 - index))), { fetchImpl, clock, timeoutMs });
    if (!previous.ok) return previous;
    combined = { ok: true, games: [...current.games, ...previous.games],
      retrievedAt: new Date(Math.max(time(current.retrievedAt), time(previous.retrievedAt))).toISOString(),
      dates: [...current.dates, ...previous.dates] };
  }
  if (!verifyIdentity(combined.games)) return unavailable("AMBIGUOUS_TEAM_IDENTITY");
  return { ...combined, source: "ESPN", observedAt: combined.retrievedAt,
    lookbackDays: 12, previousSeasonWindow: combined.dates.length > 12,
    injuryStatus: "UNKNOWN" };
}
