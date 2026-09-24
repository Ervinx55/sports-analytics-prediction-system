import { gunzipSync } from "node:zlib";
import { normalizeTeam, parseCsv } from "./nfl-model.js";

const NFLVERSE_PLAYER_STATS_URL = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv.gz`;
const NFLVERSE_SNAP_COUNTS_URL = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv.gz`;
const NFLVERSE_NGS_URL = (statType) =>
  `https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_${statType}.csv.gz`;

const PLAYER_PROP_VERSION = "NFL Player Props v1.1-shadow";
const PROVISIONAL_INDEPENDENT_WEIGHT = Object.freeze({
  A: 0.35,
  B: 0.20,
  C: 0.10,
  D: 0
});

const NFL_PROP_MARKET_SHRINKAGE = Object.freeze({
  passing_yards: 0,
  passing_touchdowns: 0,
  rushing_yards: 0,
  receiving_receptions: 0,
  receiving_yards: 0
});

const NFL_PROP_CALIBRATION_VERSION =
  "NFL Player Props Development Calibration v1";

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace("+", "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function mean(values) {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function stddev(values) {
  const usable = values.filter(Number.isFinite);
  if (usable.length < 2) return null;
  const avg = mean(usable);
  const variance = usable.reduce(
    (sum, value) => sum + (value - avg) ** 2,
    0
  ) / (usable.length - 1);
  return Math.sqrt(variance);
}

function weightedAverage(rows, getter) {
  let numerator = 0;
  let denominator = 0;
  for (const row of rows) {
    const value = getter(row);
    if (!Number.isFinite(value)) continue;
    numerator += value * row.weight;
    denominator += row.weight;
  }
  return denominator > 0 ? numerator / denominator : null;
}

function normalizePlayerName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function playerName(row = {}) {
  return (
    row.player_display_name ||
    row.player_name ||
    row.player ||
    row.full_name ||
    row.name ||
    ""
  );
}

function rowTeam(row = {}) {
  return normalizeTeam(
    row.team ||
    row.recent_team ||
    row.club_code ||
    row.team_abbr ||
    row.team_abbreviation
  );
}

function rowPosition(row = {}) {
  return String(
    row.position ||
    row.position_group ||
    row.pos ||
    row.pos_abb ||
    row.pos_name ||
    ""
  ).toUpperCase();
}

function rowPlayerId(row = {}) {
  return (
    row.player_id ||
    row.player_gsis_id ||
    row.gsis_id ||
    row.pfr_player_id ||
    row.playerID ||
    null
  );
}

function gameDateForRow(row, schedule) {
  if (row.game_id) {
    const match = schedule.find((game) => game.game_id === row.game_id);
    if (match?.gameday) return String(match.gameday);
  }
  const season = num(row.season);
  const week = num(row.week);
  const team = rowTeam(row);
  if (season && week && team) {
    const match = schedule.find((game) => (
      num(game.season) === season &&
      num(game.week) === week &&
      [game.home_team, game.away_team].includes(team)
    ));
    if (match?.gameday) return String(match.gameday);
  }
  return null;
}

function inferredAvailableAt(row, schedule, source) {
  if (source === "depth_charts") {
    const timestamp = Date.parse(row.dt || row.updated_at || "");
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  const date = gameDateForRow(row, schedule);
  if (!date) return null;
  const base = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(base)) return null;

  const hours = source === "snap_counts" ? 18 : source === "ngs" ? 10 : 12;
  return base + 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000;
}

function pointInTimeRows(rows, {
  cutoff,
  schedule = [],
  source = "player_stats"
} = {}) {
  const cutoffMs = Date.parse(cutoff || "");
  if (!Number.isFinite(cutoffMs)) return [];
  return (rows || []).filter((row) => {
    const availableAt = inferredAvailableAt(row, schedule, source);
    return availableAt !== null && availableAt <= cutoffMs;
  });
}

function featureEnvelope(value, {
  source,
  sourceTimestamp = null,
  availableAt = null,
  cutoff = null,
  quality = "UNKNOWN",
  liveAvailable = true
} = {}) {
  const cutoffMs = Date.parse(cutoff || "");
  const availableMs = Date.parse(availableAt || "");
  return {
    value,
    source,
    sourceTimestamp,
    availableAt,
    freshnessHours:
      Number.isFinite(cutoffMs) && Number.isFinite(availableMs)
        ? Number(((cutoffMs - availableMs) / 3600000).toFixed(1))
        : null,
    quality,
    liveAvailable
  };
}

function cacheState() {
  if (!globalThis.__edgeLabNflPlayerCache) {
    globalThis.__edgeLabNflPlayerCache = new Map();
  }
  return globalThis.__edgeLabNflPlayerCache;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCsv(url, ttlMs = 15 * 60 * 1000) {
  const cache = cacheState();
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.at < ttlMs) return hit.rows;

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: "text/csv,*/*" },
        cache: "no-store",
        signal: AbortSignal.timeout(45_000)
      });
      if (!response.ok) {
        const error = new Error(`${response.status} fetching ${url}`);
        error.status = response.status;
        throw error;
      }

      let text;
      if (url.endsWith(".gz")) {
        const bytes = Buffer.from(await response.arrayBuffer());
        const gzipped =
          bytes.length >= 2 &&
          bytes[0] === 0x1f &&
          bytes[1] === 0x8b;
        text = (gzipped ? gunzipSync(bytes) : bytes).toString("utf8");
      } else {
        text = await response.text();
      }

      const rows = parseCsv(text);
      cache.set(url, { at: Date.now(), rows });
      return rows;
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable =
        status === 0 ||
        status === 408 ||
        status === 429 ||
        status >= 500;
      if (!retryable || attempt === 3) break;
      await sleep(750 * attempt);
    }
  }

  throw lastError || new Error(`Failed fetching ${url}`);
}

async function optionalCsv(url) {
  try {
    const rows = await fetchCsv(url);
    return { rows, status: "OK", error: null };
  } catch (error) {
    return {
      rows: [],
      status: "UNAVAILABLE",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function loadNflPlayerData(season) {
  const current = await fetchCsv(NFLVERSE_PLAYER_STATS_URL(season));
  const prior = await optionalCsv(NFLVERSE_PLAYER_STATS_URL(season - 1));
  const [snapsCurrent, snapsPrior, ngsPassing, ngsReceiving, ngsRushing] =
    await Promise.all([
      optionalCsv(NFLVERSE_SNAP_COUNTS_URL(season)),
      optionalCsv(NFLVERSE_SNAP_COUNTS_URL(season - 1)),
      optionalCsv(NFLVERSE_NGS_URL("passing")),
      optionalCsv(NFLVERSE_NGS_URL("receiving")),
      optionalCsv(NFLVERSE_NGS_URL("rushing"))
    ]);

  return {
    playerStats: [...current, ...prior.rows],
    snapCounts: [...snapsCurrent.rows, ...snapsPrior.rows],
    ngs: {
      passing: ngsPassing.rows,
      receiving: ngsReceiving.rows,
      rushing: ngsRushing.rows
    },
    sourceHealth: {
      playerStats: {
        status: "OK",
        rows: current.length + prior.rows.length
      },
      snapCounts: {
        status:
          snapsCurrent.status === "OK" || snapsPrior.status === "OK"
            ? "OK"
            : "UNAVAILABLE",
        rows: snapsCurrent.rows.length + snapsPrior.rows.length,
        currentError: snapsCurrent.error,
        priorError: snapsPrior.error
      },
      ngs: {
        passing: {
          status: ngsPassing.status,
          rows: ngsPassing.rows.length,
          error: ngsPassing.error
        },
        receiving: {
          status: ngsReceiving.status,
          rows: ngsReceiving.rows.length,
          error: ngsReceiving.error
        },
        rushing: {
          status: ngsRushing.status,
          rows: ngsRushing.rows.length,
          error: ngsRushing.error
        }
      },
      participation: {
        status: "HISTORICAL_ONLY",
        liveAvailable: false,
        adjustmentApplied: false
      },
      injuries: {
        status: "UNAVAILABLE",
        adjustmentApplied: false
      }
    }
  };
}

function sortHistory(rows, schedule, cutoff) {
  const cutoffMs = Date.parse(cutoff || "");
  return [...rows]
    .map((row) => ({
      ...row,
      _gameDate: gameDateForRow(row, schedule)
    }))
    .filter((row) => {
      const gameMs = Date.parse(`${row._gameDate || ""}T00:00:00Z`);
      return Number.isFinite(gameMs) && gameMs < cutoffMs;
    })
    .sort((a, b) => String(b._gameDate).localeCompare(String(a._gameDate)));
}

function playerHistory(stats, schedule, playerKey, team, cutoff, limit = 10) {
  return sortHistory(
    stats.filter((row) => {
      const key = rowPlayerId(row) || normalizePlayerName(playerName(row));
      return key === playerKey;
    }),
    schedule,
    cutoff
  ).slice(0, limit);
}

function teamGameAggregates(stats, schedule, team, cutoff, limit = 10) {
  const rows = sortHistory(
    stats.filter((row) => rowTeam(row) === team),
    schedule,
    cutoff
  );
  const byGame = new Map();
  for (const row of rows) {
    const key = row.game_id || `${row.season}|${row.week}|${team}`;
    if (!byGame.has(key)) {
      byGame.set(key, {
        gameId: key,
        season: num(row.season),
        week: num(row.week),
        gameDate: row._gameDate,
        passAttempts: 0,
        rushes: 0,
        targets: 0
      });
    }
    const game = byGame.get(key);
    game.passAttempts += num(row.attempts) || 0;
    game.rushes += num(row.carries) || 0;
    game.targets += num(row.targets) || 0;
  }
  return [...byGame.values()]
    .sort((a, b) => String(b.gameDate).localeCompare(String(a.gameDate)))
    .slice(0, limit);
}

function recencyRows(rows, season) {
  return rows.map((row, index) => {
    const sameSeason = num(row.season) === season;
    return {
      ...row,
      weight: Math.exp(-0.22 * index) * (sameSeason ? 1 : 0.35)
    };
  });
}

function shareHistory({
  playerRows,
  teamGames,
  numeratorField,
  denominatorField
}) {
  const teamByGame = new Map(teamGames.map((game) => [game.gameId, game]));
  const values = [];
  for (const row of playerRows) {
    const key = row.game_id || `${row.season}|${row.week}|${rowTeam(row)}`;
    const game = teamByGame.get(key);
    if (!game) continue;
    const numerator = num(row[numeratorField]);
    const denominator = num(game[denominatorField]);
    if (!Number.isFinite(numerator) || !(denominator > 0)) continue;
    values.push(clamp(numerator / denominator, 0, 1));
  }
  return values;
}

function adaptiveWeightedShare(values) {
  if (!values.length) {
    return { value: null, roleChange: false, recent: null, prior: null };
  }
  const recent = mean(values.slice(0, 2));
  const prior = mean(values.slice(2, 6));
  const roleChange =
    Number.isFinite(recent) &&
    Number.isFinite(prior) &&
    Math.abs(recent - prior) >= 0.15;

  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    let weight = Math.exp(-0.20 * index);
    if (roleChange && index < 2) weight *= 1.8;
    numerator += value * weight;
    denominator += weight;
  });

  return {
    value: denominator > 0 ? numerator / denominator : null,
    roleChange,
    recent,
    prior
  };
}

function snapShareForPlayer({
  snapCounts,
  schedule,
  playerKey,
  playerNormalized,
  team,
  cutoff
}) {
  const rows = pointInTimeRows(snapCounts, {
    cutoff,
    schedule,
    source: "snap_counts"
  }).filter((row) => {
    const id = rowPlayerId(row);
    const name = normalizePlayerName(playerName(row));
    return (
      rowTeam(row) === team &&
      ((playerKey && id && playerKey === id) || name === playerNormalized)
    );
  });

  const shares = sortHistory(rows, schedule, cutoff)
    .map((row) => {
      const direct =
        num(row.offense_pct) ??
        num(row.offense_percentage) ??
        num(row.offense_snap_pct);
      if (direct !== null) return direct > 1 ? direct / 100 : direct;
      const snaps = num(row.offense_snaps) ?? num(row.offense);
      const total = num(row.team_offense_snaps);
      if (snaps !== null && total > 0) return snaps / total;
      return null;
    })
    .filter(Number.isFinite)
    .slice(0, 8);

  return adaptiveWeightedShare(shares);
}

function latestDepthChartStarter(depthCharts, team, position, cutoff) {
  const cutoffMs = Date.parse(cutoff || "");
  const rows = (depthCharts || [])
    .filter((row) => {
      const ts = Date.parse(row.dt || "");
      return (
        rowTeam(row) === team &&
        rowPosition(row) === position &&
        Number.isFinite(ts) &&
        ts <= cutoffMs
      );
    })
    .sort((a, b) => {
      const dateDiff = String(b.dt || "").localeCompare(String(a.dt || ""));
      if (dateDiff) return dateDiff;
      return (num(a.pos_rank) ?? 999) - (num(b.pos_rank) ?? 999);
    });

  if (!rows.length) return null;
  const latest = rows[0].dt;
  return rows
    .filter((row) => row.dt === latest)
    .sort((a, b) => (num(a.pos_rank) ?? 999) - (num(b.pos_rank) ?? 999))[0];
}

function playerNgsRows(ngsRows, {
  playerKey,
  playerNormalized,
  season,
  cutoff,
  schedule
}) {
  const cutoffYear = new Date(cutoff).getUTCFullYear();
  return pointInTimeRows(ngsRows, {
    cutoff,
    schedule,
    source: "ngs"
  })
    .filter((row) => {
      const id = rowPlayerId(row);
      const name = normalizePlayerName(playerName(row));
      const rowSeason = num(row.season);
      const week = num(row.week);
      return (
        (!rowSeason || [season, season - 1, cutoffYear].includes(rowSeason)) &&
        week !== 0 &&
        ((playerKey && id && playerKey === id) || name === playerNormalized)
      );
    })
    .sort((a, b) => {
      const s = (num(b.season) ?? 0) - (num(a.season) ?? 0);
      return s || (num(b.week) ?? 0) - (num(a.week) ?? 0);
    })
    .slice(0, 8);
}

function historicalMetric(rows, field, attemptsField = null, fallback = null) {
  const weighted = recencyRows(rows, num(rows[0]?.season));
  if (attemptsField) {
    let numerator = 0;
    let denominator = 0;
    for (const row of weighted) {
      const total = num(row[field]);
      const attempts = num(row[attemptsField]);
      if (!Number.isFinite(total) || !(attempts > 0)) continue;
      numerator += row.weight * total;
      denominator += row.weight * attempts;
    }
    return denominator > 0 ? numerator / denominator : fallback;
  }
  return weightedAverage(weighted, (row) => num(row[field])) ?? fallback;
}

function distribution(meanValue, sdValue, floor = 0) {
  const meanSafe = Math.max(floor, meanValue || 0);
  const sdSafe = Math.max(0.01, sdValue || Math.max(1, meanSafe * 0.22));
  const q = (z) => Math.max(floor, meanSafe + z * sdSafe);
  return {
    mean: Number(meanSafe.toFixed(3)),
    median: Number(meanSafe.toFixed(3)),
    sd: Number(sdSafe.toFixed(3)),
    p10: Number(q(-1.28155).toFixed(3)),
    p25: Number(q(-0.67449).toFixed(3)),
    p75: Number(q(0.67449).toFixed(3)),
    p90: Number(q(1.28155).toFixed(3))
  };
}

function empiricalSd(rows, field, fallback) {
  const values = rows.map((row) => num(row[field])).filter(Number.isFinite);
  const sd = stddev(values);
  return Number.isFinite(sd) ? sd : fallback;
}

function gameMarketContext(event, team) {
  const homeTeam = normalizeTeam(
    event?.matchup?.home?.name || event?.matchup?.home?.short
  );
  const spread = num(event?.markets?.spread?.home?.consensus?.line);
  const total = num(event?.markets?.total?.over?.consensus?.line);
  if (spread === null) {
    return { teamSpread: null, total };
  }
  return {
    teamSpread: team === homeTeam ? spread : -spread,
    total
  };
}

function roleDataQuality({
  historyCount,
  snapAvailable,
  ngsAvailable,
  depthAvailable,
  roleShareAvailable
}) {
  if (!roleShareAvailable || historyCount === 0) return "D";
  if (historyCount < 3) return "C";
  const optional = [snapAvailable, ngsAvailable, depthAvailable];
  const missing = optional.filter((value) => !value).length;
  if (missing === 0 && historyCount >= 4) return "A";
  if (missing <= 1) return "B";
  return "C";
}

function findPlayerIdentity(playerStats, playerNameValue, eventTeams = []) {
  const normalized = normalizePlayerName(playerNameValue);
  const matches = (playerStats || []).filter(
    (row) => normalizePlayerName(playerName(row)) === normalized
  );
  if (!matches.length) {
    return {
      name: playerNameValue,
      normalized,
      key: normalized,
      id: null,
      team: null,
      position: null
    };
  }

  const teamSet = new Set(eventTeams.filter(Boolean));
  const preferred = matches.find((row) => teamSet.has(rowTeam(row))) || matches[0];
  return {
    name: playerName(preferred) || playerNameValue,
    normalized,
    key: rowPlayerId(preferred) || normalized,
    id: rowPlayerId(preferred),
    team: rowTeam(preferred),
    position: rowPosition(preferred)
  };
}

function projectPlayerOpportunity({
  playerName: playerNameValue,
  preferredTeam = null,
  preferredPosition = null,
  event,
  schedule,
  season,
  playerStats,
  snapCounts,
  ngs,
  depthCharts,
  weatherContext = null,
  opponentSnapshot = null
}) {
  const cutoff = event.startsAt;
  const eventTeams = [
    normalizeTeam(event?.matchup?.home?.name || event?.matchup?.home?.short),
    normalizeTeam(event?.matchup?.away?.name || event?.matchup?.away?.short)
  ].filter(Boolean);
  const identity = findPlayerIdentity(playerStats, playerNameValue, eventTeams);
  if (
    preferredTeam &&
    eventTeams.includes(normalizeTeam(preferredTeam))
  ) {
    identity.team = normalizeTeam(preferredTeam);
  }
  if (!identity.position && preferredPosition) {
    identity.position = String(preferredPosition).toUpperCase();
  }

  if (!identity.team || !identity.position) {
    return {
      player: identity,
      dataQuality: "D",
      reason: "Player could not be matched to a current NFL team/position.",
      projections: {}
    };
  }

  const statsPIT = pointInTimeRows(playerStats, {
    cutoff,
    schedule,
    source: "player_stats"
  });
  const history = playerHistory(
    statsPIT,
    schedule,
    identity.key,
    identity.team,
    cutoff,
    10
  );
  const teamGames = teamGameAggregates(
    statsPIT,
    schedule,
    identity.team,
    cutoff,
    10
  );
  const weightedTeam = recencyRows(teamGames, season);
  const projectedPlays = clamp(
    weightedAverage(weightedTeam, (game) => game.passAttempts + game.rushes) ??
      63,
    52,
    78
  );
  const historicalPassRate =
    weightedAverage(weightedTeam, (game) => {
      const total = game.passAttempts + game.rushes;
      return total > 0 ? game.passAttempts / total : null;
    }) ?? 0.57;

  const marketContext = gameMarketContext(event, identity.team);
  const gameScriptAdjustment = Number.isFinite(marketContext.teamSpread)
    ? clamp(marketContext.teamSpread / 120, -0.04, 0.04)
    : 0;
  const totalPaceAdjustment = Number.isFinite(marketContext.total)
    ? clamp((marketContext.total - 44) / 220, -0.025, 0.025)
    : 0;
  const weatherPassAdjustment = weatherContext?.controlledEnvironment
    ? 0
    : Number.isFinite(weatherContext?.windMph) && weatherContext.windMph >= 18
      ? -0.025
      : 0;

  const passRate = clamp(
    historicalPassRate + gameScriptAdjustment + weatherPassAdjustment,
    0.42,
    0.72
  );
  const passAttempts = projectedPlays * passRate;
  const rushes = projectedPlays - passAttempts;

  const targetShares = shareHistory({
    playerRows: history,
    teamGames,
    numeratorField: "targets",
    denominatorField: "passAttempts"
  });
  const rushShares = shareHistory({
    playerRows: history,
    teamGames,
    numeratorField: "carries",
    denominatorField: "rushes"
  });
  const targetShare = adaptiveWeightedShare(targetShares);
  const rushShare = adaptiveWeightedShare(rushShares);
  const snapShare = snapShareForPlayer({
    snapCounts,
    schedule,
    playerKey: identity.id,
    playerNormalized: identity.normalized,
    team: identity.team,
    cutoff
  });

  const depthStarter = latestDepthChartStarter(
    depthCharts,
    identity.team,
    identity.position === "QB" ? "QB" : identity.position,
    cutoff
  );
  const depthAvailable = Boolean(depthStarter);
  const snapAvailable = Number.isFinite(snapShare.value);

  const ngsType =
    identity.position === "QB"
      ? "passing"
      : ["WR", "TE"].includes(identity.position)
        ? "receiving"
        : "rushing";
  const ngsRows = playerNgsRows(ngs?.[ngsType] || [], {
    playerKey: identity.id,
    playerNormalized: identity.normalized,
    season,
    cutoff,
    schedule
  });
  const ngsAvailable = ngsRows.length > 0;

  const opponentFactor = Number.isFinite(opponentSnapshot?.defYppAllowed)
    ? clamp(opponentSnapshot.defYppAllowed / 5.6, 0.92, 1.08)
    : 1;
  const weatherYardageFactor = weatherContext?.controlledEnvironment
    ? 1
    : Number.isFinite(weatherContext?.windMph) && weatherContext.windMph >= 18
      ? 0.95
      : Number.isFinite(weatherContext?.windMph) && weatherContext.windMph >= 14
        ? 0.975
        : 1;

  const projections = {};

  if (identity.position === "QB") {
    const ypaRaw = historicalMetric(history, "passing_yards", "attempts", 7.1);
    const ypa = clamp(0.80 * ypaRaw + 0.20 * 7.1, 5.2, 9.5);
    const tdRateRaw = historicalMetric(history, "passing_tds", "attempts", 0.045);
    const tdRate = clamp(0.8 * tdRateRaw + 0.2 * 0.045, 0.015, 0.085);
    const attemptShareRaw = history.map((row) => {
      const attempts = num(row.attempts);
      const team = teamGames.find((game) => (
        game.gameId === (row.game_id || `${row.season}|${row.week}|${identity.team}`)
      ));
      return attempts !== null && team?.passAttempts > 0
        ? attempts / team.passAttempts
        : null;
    }).filter(Number.isFinite);
    const attemptShare = clamp(adaptiveWeightedShare(attemptShareRaw).value ?? 0.98, 0.75, 1);
    const attemptsMean = passAttempts * attemptShare;
    const yardsMean = attemptsMean * ypa * opponentFactor * weatherYardageFactor;
    const tdMean = attemptsMean * tdRate * clamp(
      Number.isFinite(marketContext.total) ? marketContext.total / 44 : 1,
      0.82,
      1.20
    );

    projections.passing_attempts = distribution(
      attemptsMean,
      empiricalSd(history, "attempts", 5.5),
      0
    );
    projections.passing_yards = distribution(
      yardsMean,
      empiricalSd(history, "passing_yards", Math.max(35, yardsMean * 0.22)),
      0
    );
    projections.passing_touchdowns = {
      mean: Number(tdMean.toFixed(3)),
      distribution: "poisson"
    };
  }

  if (["WR", "TE", "RB", "FB"].includes(identity.position)) {
    const catchRateRaw = historicalMetric(history, "receptions", "targets", 0.66);
    const yptRaw = historicalMetric(history, "receiving_yards", "targets", 7.8);
    const targetShareValue = clamp(
      targetShare.value ??
        (identity.position === "RB" ? 0.10 : identity.position === "TE" ? 0.15 : 0.18),
      0.02,
      0.38
    );
    const targetsMean = passAttempts * targetShareValue;
    const catchRate = clamp(0.82 * catchRateRaw + 0.18 * 0.66, 0.45, 0.88);
    const ypt = clamp(0.82 * yptRaw + 0.18 * 7.8, 4.0, 13.5);
    const receptionsMean = targetsMean * catchRate;
    const receivingYardsMean =
      targetsMean * ypt * opponentFactor * weatherYardageFactor;

    projections.targets = distribution(
      targetsMean,
      empiricalSd(history, "targets", Math.max(1.5, targetsMean * 0.25)),
      0
    );
    projections.receiving_receptions = distribution(
      receptionsMean,
      empiricalSd(
        history,
        "receptions",
        Math.max(1.2, receptionsMean * 0.28)
      ),
      0
    );
    projections.receiving_yards = distribution(
      receivingYardsMean,
      empiricalSd(
        history,
        "receiving_yards",
        Math.max(14, receivingYardsMean * 0.32)
      ),
      0
    );
  }

  if (["RB", "FB", "QB"].includes(identity.position)) {
    const ypcRaw = historicalMetric(history, "rushing_yards", "carries", 4.3);
    const rushShareValue = clamp(
      rushShare.value ?? (identity.position === "QB" ? 0.12 : 0.48),
      identity.position === "QB" ? 0.02 : 0.08,
      identity.position === "QB" ? 0.35 : 0.82
    );
    const carriesMean = rushes * rushShareValue;
    const ypc = clamp(0.82 * ypcRaw + 0.18 * 4.3, 2.8, 6.5);
    const rushingYardsMean = carriesMean * ypc * opponentFactor;

    projections.carries = distribution(
      carriesMean,
      empiricalSd(history, "carries", Math.max(1.8, carriesMean * 0.25)),
      0
    );
    projections.rushing_yards = distribution(
      rushingYardsMean,
      empiricalSd(
        history,
        "rushing_yards",
        Math.max(12, rushingYardsMean * 0.32)
      ),
      0
    );
  }

  const roleShareAvailable =
    identity.position === "QB"
      ? history.some((row) => (num(row.attempts) || 0) > 0)
      : ["WR", "TE"].includes(identity.position)
        ? Number.isFinite(targetShare.value)
        : Number.isFinite(rushShare.value) || Number.isFinite(targetShare.value);

  const dataQuality = roleDataQuality({
    historyCount: history.length,
    snapAvailable,
    ngsAvailable,
    depthAvailable,
    roleShareAvailable
  });

  return {
    player: identity,
    team: identity.team,
    opponent: eventTeams.find((team) => team !== identity.team) || null,
    dataQuality,
    historyGames: history.length,
    role: {
      snapShare,
      targetShare,
      rushShare,
      roleChange:
        Boolean(snapShare.roleChange) ||
        Boolean(targetShare.roleChange) ||
        Boolean(rushShare.roleChange)
    },
    environment: {
      projectedPlays: Number(projectedPlays.toFixed(3)),
      projectedPassAttempts: Number(passAttempts.toFixed(3)),
      projectedRushes: Number(rushes.toFixed(3)),
      passRate: Number(passRate.toFixed(4)),
      teamSpread: marketContext.teamSpread,
      total: marketContext.total,
      opponentYardageFactor: Number(opponentFactor.toFixed(4)),
      weatherYardageFactor: Number(weatherYardageFactor.toFixed(4))
    },
    featureAvailability: {
      playerStats: featureEnvelope(history.length, {
        source: "nflverse_player_stats",
        cutoff,
        quality: history.length >= 4 ? "HIGH" : history.length >= 2 ? "MEDIUM" : "LOW",
        liveAvailable: true
      }),
      snaps: featureEnvelope(snapShare.value, {
        source: "nflverse_pfr_snap_counts",
        cutoff,
        quality: snapAvailable ? "HIGH" : "UNAVAILABLE",
        liveAvailable: true
      }),
      ngs: featureEnvelope(ngsRows.length, {
        source: `nflverse_ngs_${ngsType}`,
        cutoff,
        quality: ngsAvailable ? "HIGH" : "UNAVAILABLE",
        liveAvailable: true
      }),
      depthChart: featureEnvelope(
        depthStarter ? playerName(depthStarter) : null,
        {
          source: "nflverse_depth_charts",
          sourceTimestamp: depthStarter?.dt || null,
          availableAt: depthStarter?.dt || null,
          cutoff,
          quality: depthAvailable ? "HIGH" : "UNAVAILABLE",
          liveAvailable: true
        }
      ),
      participation: featureEnvelope(null, {
        source: "nflverse_participation",
        cutoff,
        quality: "HISTORICAL_ONLY",
        liveAvailable: false
      }),
      injuries: featureEnvelope(null, {
        source: "nflverse_injuries",
        cutoff,
        quality: "UNAVAILABLE",
        liveAvailable: false
      })
    },
    projections
  };
}

function americanToProbability(odds) {
  const value = num(odds);
  if (value === null || value === 0) return null;
  return value > 0
    ? 100 / (value + 100)
    : Math.abs(value) / (Math.abs(value) + 100);
}

function americanToDecimal(odds) {
  const value = num(odds);
  if (value === null || value === 0) return null;
  return value > 0 ? 1 + value / 100 : 1 + 100 / Math.abs(value);
}

function noVigPair(overOdds, underOdds) {
  const over = americanToProbability(overOdds);
  const under = americanToProbability(underOdds);
  if (over === null || under === null || over + under <= 0) return null;
  return {
    over: over / (over + under),
    under: under / (over + under)
  };
}

function normalCdf(x, mu, sigma) {
  if (!Number.isFinite(x) || !Number.isFinite(mu) || !(sigma > 0)) return null;
  const z = (x - mu) / (sigma * Math.SQRT2);
  const sign = z < 0 ? -1 : 1;
  const a = Math.abs(z);
  const t = 1 / (1 + 0.3275911 * a);
  const erf = sign * (
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
      0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  );
  return 0.5 * (1 + erf);
}

function poissonCdf(k, lambda) {
  if (!Number.isFinite(lambda) || lambda < 0) return null;
  if (k < 0) return 0;
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= Math.floor(k); i += 1) {
    term *= lambda / i;
    sum += term;
  }
  return clamp(sum, 0, 1);
}

function poissonPmf(k, lambda) {
  if (!Number.isFinite(lambda) || lambda < 0 || k < 0) return 0;
  let term = Math.exp(-lambda);
  for (let i = 1; i <= Math.floor(k); i += 1) {
    term *= lambda / i;
  }
  return term;
}

function independentProbability(projection, line, side, marketType) {
  if (!projection || !Number.isFinite(line)) return null;
  if (marketType === "passing_touchdowns") {
    const lambda = num(projection.mean);
    if (lambda === null) return null;
    const integerLine = Math.floor(line);
    const underOrEqual = poissonCdf(integerLine, lambda);
    if (underOrEqual === null) return null;
    if (Math.abs(line - integerLine) < 1e-9) {
      const exact = poissonPmf(integerLine, lambda);
      const nonPush = Math.max(1e-9, 1 - exact);
      const win =
        side === "over"
          ? 1 - underOrEqual
          : underOrEqual - exact;
      return clamp(win / nonPush, 0, 1);
    }
    return side === "over" ? 1 - underOrEqual : underOrEqual;
  }

  const mu = num(projection.mean);
  const sigma = num(projection.sd);
  if (mu === null || sigma === null) return null;
  const cdf = normalCdf(line, mu, sigma);
  if (cdf === null) return null;
  return side === "over" ? 1 - cdf : cdf;
}

function expectedValue(probability, odds, pushProbability = 0) {
  const decimal = americanToDecimal(odds);
  if (probability === null || decimal === null) return null;
  const push = clamp(pushProbability || 0, 0, 1);
  const nonPush = 1 - push;
  const win = nonPush * probability;
  const loss = nonPush * (1 - probability);
  return win * (decimal - 1) - loss;
}

function pairedBookLines(prop) {
  const books = new Set([
    ...Object.keys(prop?.over?.books || {}),
    ...Object.keys(prop?.under?.books || {})
  ]);
  const rows = [];
  for (const book of books) {
    const over = prop?.over?.books?.[book];
    const under = prop?.under?.books?.[book];
    if (!over || !under || over.available === false || under.available === false) {
      continue;
    }
    const overLine = num(over.line);
    const underLine = num(under.line);
    if (
      overLine === null ||
      underLine === null ||
      Math.abs(overLine - underLine) > 1e-9
    ) {
      continue;
    }
    const noVig = noVigPair(over.odds, under.odds);
    if (!noVig) continue;
    rows.push({
      book,
      line: overLine,
      overOdds: num(over.odds),
      underOdds: num(under.odds),
      marketOverProbability: noVig.over,
      marketUnderProbability: noVig.under,
      updatedAt: over.updatedAt || under.updatedAt || null
    });
  }
  return rows;
}

function gradePropMarket(prop, opportunity, {
  playEvThreshold = 0.03,
  playEdgeThreshold = 0.025
} = {}) {
  const projection = opportunity?.projections?.[prop.statID];
  if (!projection) return [];
  const qualityWeight =
    PROVISIONAL_INDEPENDENT_WEIGHT[opportunity.dataQuality] ?? 0;
  const marketShrinkage =
    NFL_PROP_MARKET_SHRINKAGE[prop.statID] ?? 0;
  const weight = qualityWeight * marketShrinkage;
  const candidates = [];

  for (const row of pairedBookLines(prop)) {
    for (const side of ["over", "under"]) {
      const marketProbability =
        side === "over"
          ? row.marketOverProbability
          : row.marketUnderProbability;
      const odds = side === "over" ? row.overOdds : row.underOdds;
      const rawModelProbability = independentProbability(
        projection,
        row.line,
        side,
        prop.statID
      );
      if (rawModelProbability === null || marketProbability === null) continue;

      const shadowProbability = clamp(
        marketProbability +
          weight * (rawModelProbability - marketProbability),
        1e-6,
        1 - 1e-6
      );
      const edge = shadowProbability - marketProbability;
      const pushProbability =
        prop.statID === "passing_touchdowns" &&
        Math.abs(row.line - Math.round(row.line)) < 1e-9
          ? poissonPmf(
              Math.round(row.line),
              num(projection.mean) ?? 0
            )
          : 0;
      const ev = expectedValue(
        shadowProbability,
        odds,
        pushProbability
      );

      let shadowStatus = "PASS";
      let reason =
        marketShrinkage === 0
          ? "2024 development calibration did not justify independent influence; market-only shadow."
          : "Insufficient calibrated edge.";
      if (opportunity.dataQuality === "D") {
        shadowStatus = "PASS";
        reason = "Data insufficient.";
      } else if (opportunity.dataQuality === "C") {
        shadowStatus = "WATCH";
        reason = "Material role/source uncertainty remains.";
      } else if (
        Number.isFinite(ev) &&
        Number.isFinite(edge) &&
        ev >= playEvThreshold &&
        edge >= playEdgeThreshold
      ) {
        shadowStatus = "PLAY";
        reason = "Shadow edge clears provisional EV and probability gates.";
      }

      candidates.push({
        playerName: prop.playerName,
        playerID: prop.playerID || null,
        statID: prop.statID,
        book: row.book,
        line: row.line,
        side,
        odds,
        marketFairProbability: Number(marketProbability.toFixed(6)),
        rawIndependentProbability: Number(rawModelProbability.toFixed(6)),
        shadowModelProbability: Number(shadowProbability.toFixed(6)),
        edgePct: Number((edge * 100).toFixed(2)),
        evPct: Number((ev * 100).toFixed(2)),
        pushProbability: Number(pushProbability.toFixed(6)),
        dataQuality: opportunity.dataQuality,
        status: "PASS",
        shadowStatus,
        productionEligible: false,
        productionWeight: 0,
        provisionalQualityWeight: qualityWeight,
        marketShrinkage,
        effectiveIndependentWeight: weight,
        calibrationVersion: NFL_PROP_CALIBRATION_VERSION,
        reason,
        updatedAt: row.updatedAt
      });
    }
  }

  return candidates;
}

export {
  NFLVERSE_PLAYER_STATS_URL,
  NFLVERSE_SNAP_COUNTS_URL,
  NFLVERSE_NGS_URL,
  PLAYER_PROP_VERSION,
  PROVISIONAL_INDEPENDENT_WEIGHT,
  NFL_PROP_MARKET_SHRINKAGE,
  NFL_PROP_CALIBRATION_VERSION,
  normalizePlayerName,
  pointInTimeRows,
  featureEnvelope,
  loadNflPlayerData,
  findPlayerIdentity,
  projectPlayerOpportunity,
  independentProbability,
  pairedBookLines,
  gradePropMarket
};
