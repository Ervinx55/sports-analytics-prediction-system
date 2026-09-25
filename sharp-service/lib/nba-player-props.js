import {
  resolveOfficialAvailability
} from "./nba-injury-report.js";
import {
  applyNbaPropGameContext,
  buildNbaPropGameContext
} from "./nba-prop-context.js";

const BDL_STATS_URL = "https://api.balldontlie.io/v1/stats";
const BDL_INJURIES_URL =
  "https://api.balldontlie.io/v1/player_injuries";
const NBA_OFFICIAL_INJURY_PAGE =
  "https://official.nba.com/nba-injury-report-2025-26-season/";

const NBA_PLAYER_PROP_VERSION =
  "NBA Player Props v1.1-shadow";

const DIRECT_FIELDS = Object.freeze({
  points: "pts",
  rebounds: "reb",
  assists: "ast",
  threes_made: "fg3m",
  blocks: "blk",
  steals: "stl",
  turnovers: "turnover"
});

const COMBO_FIELDS = Object.freeze({
  blocks_steals: ["blocks", "steals"],
  points_rebounds_assists: [
    "points",
    "rebounds",
    "assists"
  ],
  points_rebounds: ["points", "rebounds"],
  points_assists: ["points", "assists"],
  rebounds_assists: ["rebounds", "assists"]
});

const SUPPORTED_STATS = Object.freeze([
  ...Object.keys(DIRECT_FIELDS),
  ...Object.keys(COMBO_FIELDS)
]);

const USAGE_SENSITIVE_STATS = new Set([
  "points",
  "assists",
  "threes_made",
  "turnovers",
  "points_rebounds_assists",
  "points_rebounds",
  "points_assists",
  "rebounds_assists"
]);

const cache =
  globalThis.__edgeLabNbaPlayerCache ||
  (globalThis.__edgeLabNbaPlayerCache = new Map());

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function num(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePlayerName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function playerName(row) {
  const first =
    row?.player?.first_name ||
    row?.first_name ||
    "";
  const last =
    row?.player?.last_name ||
    row?.last_name ||
    "";
  return `${first} ${last}`.trim();
}

function parseMinutes(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }
  const match = text.match(/^(\d+):(\d{1,2})$/);
  if (!match) return null;
  return Number(match[1]) + Number(match[2]) / 60;
}

function gameTimestamp(row) {
  return Date.parse(
    row?.game?.datetime ||
    (row?.game?.date
      ? `${row.game.date}T23:59:59Z`
      : "")
  );
}

function statValue(row, statID) {
  if (DIRECT_FIELDS[statID]) {
    return num(row?.[DIRECT_FIELDS[statID]]);
  }
  const components = COMBO_FIELDS[statID];
  if (!components) return null;

  let total = 0;
  for (const component of components) {
    const value = statValue(row, component);
    if (!Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

function recentPlayerRows(
  rows,
  targetPlayerName,
  beforeAt,
  limit = 10
) {
  const key = normalizePlayerName(targetPlayerName);
  const cutoff = Date.parse(beforeAt || "");

  return (rows || [])
    .filter((row) => {
      if (
        normalizePlayerName(playerName(row)) !== key
      ) {
        return false;
      }
      const at = gameTimestamp(row);
      if (
        Number.isFinite(cutoff) &&
        Number.isFinite(at) &&
        at >= cutoff
      ) {
        return false;
      }
      return parseMinutes(row?.min) !== null;
    })
    .sort(
      (a, b) => gameTimestamp(b) - gameTimestamp(a)
    )
    .slice(0, limit);
}

function usageProxy(row) {
  const minutes = parseMinutes(row?.min);
  const fga = num(row?.fga);
  const fta = num(row?.fta);
  const turnovers = num(row?.turnover);
  if (
    !(minutes > 0) ||
    fga === null ||
    fta === null ||
    turnovers === null
  ) {
    return null;
  }
  return (
    fga +
    0.44 * fta +
    turnovers
  ) / minutes;
}

function weightedMean(rows, getter) {
  let numerator = 0;
  let denominator = 0;

  rows.forEach((row, index) => {
    const value = getter(row);
    if (!Number.isFinite(value)) return;
    const weight = Math.exp(-0.18 * index);
    numerator += weight * value;
    denominator += weight;
  });

  return denominator > 0
    ? numerator / denominator
    : null;
}

function sampleSd(values) {
  const usable = values.filter(Number.isFinite);
  if (usable.length < 2) return null;
  const mean =
    usable.reduce((sum, value) => sum + value, 0) /
    usable.length;
  const variance =
    usable.reduce(
      (sum, value) => sum + (value - mean) ** 2,
      0
    ) /
    (usable.length - 1);
  return Math.sqrt(variance);
}

function recentWindowMean(rows, statID, limit) {
  return weightedMean(
    rows.slice(0, limit),
    (row) => statValue(row, statID)
  );
}

function projectionFromHistory(
  rows,
  statID,
  {
    beforeAt = null,
    minimumGames = 4
  } = {}
) {
  const history = beforeAt
    ? rows.filter((row) => {
        const at = gameTimestamp(row);
        const cutoff = Date.parse(beforeAt);
        return (
          !Number.isFinite(cutoff) ||
          !Number.isFinite(at) ||
          at < cutoff
        );
      })
    : rows;

  const usable = history.filter((row) =>
    Number.isFinite(statValue(row, statID))
  );
  if (usable.length < minimumGames) {
    return {
      available: false,
      statID,
      historyGames: usable.length,
      reason:
        `Need at least ${minimumGames} prior games with ${statID} data.`
    };
  }

  const directLong = recentWindowMean(
    usable,
    statID,
    Math.min(8, usable.length)
  );
  const directShort = recentWindowMean(
    usable,
    statID,
    Math.min(4, usable.length)
  );
  const projectedMinutes = weightedMean(
    usable.slice(0, 8),
    (row) => parseMinutes(row?.min)
  );
  const perMinuteRate = weightedMean(
    usable.slice(0, 8),
    (row) => {
      const minutes = parseMinutes(row?.min);
      const value = statValue(row, statID);
      if (!(minutes > 0) || !Number.isFinite(value)) {
        return null;
      }
      return value / minutes;
    }
  );
  const minuteProjection =
    Number.isFinite(projectedMinutes) &&
    Number.isFinite(perMinuteRate)
      ? projectedMinutes * perMinuteRate
      : null;

  const usageLong = weightedMean(
    usable.slice(0, Math.min(8, usable.length)),
    usageProxy
  );
  const usageShort = weightedMean(
    usable.slice(0, Math.min(4, usable.length)),
    usageProxy
  );
  const usageRatio =
    Number.isFinite(usageLong) &&
    usageLong > 0 &&
    Number.isFinite(usageShort)
      ? usageShort / usageLong
      : null;
  const usageAdjustedProjection =
    USAGE_SENSITIVE_STATS.has(statID) &&
    Number.isFinite(minuteProjection) &&
    Number.isFinite(usageRatio)
      ? minuteProjection *
        clamp(usageRatio, 0.92, 1.08)
      : null;

  const candidates = [
    { value: directLong, weight: 0.42 },
    { value: directShort, weight: 0.28 },
    { value: minuteProjection, weight: 0.20 },
    { value: usageAdjustedProjection, weight: 0.10 }
  ].filter((row) => Number.isFinite(row.value));

  const weightTotal = candidates.reduce(
    (sum, row) => sum + row.weight,
    0
  );
  const mean =
    weightTotal > 0
      ? candidates.reduce(
          (sum, row) =>
            sum + row.value * row.weight,
          0
        ) / weightTotal
      : null;

  const actuals = usable
    .slice(0, 10)
    .map((row) => statValue(row, statID))
    .filter(Number.isFinite);
  const empiricalSd = sampleSd(actuals);
  const sd = Math.max(
    0.75,
    empiricalSd ??
      Math.sqrt(Math.max(1, mean || 1))
  );

  const minutesHistory = usable
    .slice(0, 8)
    .map((row) => parseMinutes(row?.min))
    .filter(Number.isFinite);
  const minutesSd = sampleSd(minutesHistory);

  const latestTeam =
    usable[0]?.team?.full_name ||
    usable[0]?.team?.abbreviation ||
    null;

  return {
    available: Number.isFinite(mean),
    statID,
    teamName: latestTeam,
    mean:
      Number.isFinite(mean)
        ? Number(mean.toFixed(4))
        : null,
    sd: Number(sd.toFixed(4)),
    projectedMinutes:
      Number.isFinite(projectedMinutes)
        ? Number(projectedMinutes.toFixed(3))
        : null,
    minutesSd:
      Number.isFinite(minutesSd)
        ? Number(minutesSd.toFixed(3))
        : null,
    perMinuteRate:
      Number.isFinite(perMinuteRate)
        ? Number(perMinuteRate.toFixed(5))
        : null,
    directLong:
      Number.isFinite(directLong)
        ? Number(directLong.toFixed(4))
        : null,
    directShort:
      Number.isFinite(directShort)
        ? Number(directShort.toFixed(4))
        : null,
    minuteProjection:
      Number.isFinite(minuteProjection)
        ? Number(minuteProjection.toFixed(4))
        : null,
    usageProxyLong:
      Number.isFinite(usageLong)
        ? Number(usageLong.toFixed(5))
        : null,
    usageProxyShort:
      Number.isFinite(usageShort)
        ? Number(usageShort.toFixed(5))
        : null,
    usageRatio:
      Number.isFinite(usageRatio)
        ? Number(usageRatio.toFixed(4))
        : null,
    usageAdjustedProjection:
      Number.isFinite(usageAdjustedProjection)
        ? Number(usageAdjustedProjection.toFixed(4))
        : null,
    historyGames: usable.length,
    modelVersion: NBA_PLAYER_PROP_VERSION
  };
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const value = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * value);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) *
      t +
      a1) *
      t *
      Math.exp(-value * value));
  return sign * y;
}

function normalCdf(x, mean, sd) {
  return (
    0.5 *
    (
      1 +
      erf(
        (x - mean) /
          (Math.max(1e-6, sd) * Math.SQRT2)
      )
    )
  );
}

function independentProbability(
  projection,
  side,
  line,
  meanOverride = null
) {
  const mean =
    Number.isFinite(meanOverride)
      ? meanOverride
      : projection?.mean;

  if (
    !projection?.available ||
    !Number.isFinite(mean) ||
    !Number.isFinite(projection.sd) ||
    !Number.isFinite(line)
  ) {
    return null;
  }

  const over =
    1 -
    normalCdf(
      line,
      mean,
      projection.sd
    );
  return side === "over" ? over : 1 - over;
}

function americanProbability(odds) {
  const value = num(odds);
  if (value === null || value === 0) return null;
  return value > 0
    ? 100 / (value + 100)
    : Math.abs(value) /
        (Math.abs(value) + 100);
}

function noVigProbability(sideOdds, opponentOdds) {
  const a = americanProbability(sideOdds);
  const b = americanProbability(opponentOdds);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    a + b <= 0
  ) {
    return null;
  }
  return a / (a + b);
}

function americanToDecimal(odds) {
  const value = num(odds);
  if (value === null || value === 0) return null;
  return value > 0
    ? 1 + value / 100
    : 1 + 100 / Math.abs(value);
}

function expectedValue(probability, odds) {
  const decimal = americanToDecimal(odds);
  if (
    !Number.isFinite(probability) ||
    decimal === null
  ) {
    return null;
  }
  return probability * decimal - 1;
}

function median(values) {
  const usable = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!usable.length) return null;
  const middle =
    Math.floor(usable.length / 2);
  return usable.length % 2
    ? usable[middle]
    : (
        usable[middle - 1] +
        usable[middle]
      ) / 2;
}

function quoteAgeMinutes(
  updatedAt,
  now = new Date()
) {
  const updated =
    Date.parse(updatedAt || "");
  if (!Number.isFinite(updated)) {
    return null;
  }
  return Math.max(
    0,
    (
      now.getTime() -
      updated
    ) / 60000
  );
}

function marketIntegrity(
  pairs,
  pair,
  side,
  now = new Date()
) {
  const sameLine = (pairs || [])
    .filter(
      (row) =>
        Number.isFinite(row?.line) &&
        Math.abs(
          row.line - pair.line
        ) < 1e-9
    );

  const probabilities =
    sameLine
      .map((row) =>
        noVigProbability(
          side === "over"
            ? row.overOdds
            : row.underOdds,
          side === "over"
            ? row.underOdds
            : row.overOdds
        )
      )
      .filter(Number.isFinite);

  const candidateProbability =
    noVigProbability(
      side === "over"
        ? pair.overOdds
        : pair.underOdds,
      side === "over"
        ? pair.underOdds
        : pair.overOdds
    );
  const consensusProbability =
    median(probabilities);
  const probabilityRange =
    probabilities.length
      ? Math.max(...probabilities) -
        Math.min(...probabilities)
      : null;
  const probabilityDeviation =
    Number.isFinite(candidateProbability) &&
    Number.isFinite(consensusProbability)
      ? Math.abs(
          candidateProbability -
          consensusProbability
        )
      : null;

  const lineValues = (pairs || [])
    .map((row) => row?.line)
    .filter(Number.isFinite);
  const lineRange =
    lineValues.length
      ? Math.max(...lineValues) -
        Math.min(...lineValues)
      : null;

  const ageMinutes =
    quoteAgeMinutes(
      pair?.updatedAt,
      now
    );
  const stale =
    Number.isFinite(ageMinutes) &&
    ageMinutes > 30;
  const isolatedLine =
    sameLine.length < 2;
  const highDisagreement =
    Number.isFinite(probabilityRange) &&
    probabilityRange >= 0.10;
  const priceOutlier =
    Number.isFinite(probabilityDeviation) &&
    probabilityDeviation >= 0.055;
  const staleOutlier =
    stale && priceOutlier;

  let score = 1;
  if (isolatedLine) score -= 0.35;
  if (stale) score -= 0.20;
  if (priceOutlier) score -= 0.15;
  if (highDisagreement) score -= 0.20;
  if (ageMinutes === null) score -= 0.05;

  score = clamp(score, 0, 1);

  return {
    score:
      Number(score.toFixed(3)),
    blocked:
      isolatedLine ||
      staleOutlier ||
      highDisagreement,
    pairedBooks:
      sameLine.length,
    exactLine:
      pair.line,
    lineRange:
      Number.isFinite(lineRange)
        ? Number(lineRange.toFixed(3))
        : null,
    consensusFairProbability:
      Number.isFinite(consensusProbability)
        ? Number(
            consensusProbability.toFixed(6)
          )
        : null,
    candidateFairProbability:
      Number.isFinite(candidateProbability)
        ? Number(
            candidateProbability.toFixed(6)
          )
        : null,
    probabilityRangePctPoints:
      Number.isFinite(probabilityRange)
        ? Number(
            (
              probabilityRange * 100
            ).toFixed(3)
          )
        : null,
    probabilityDeviationPctPoints:
      Number.isFinite(probabilityDeviation)
        ? Number(
            (
              probabilityDeviation * 100
            ).toFixed(3)
          )
        : null,
    quoteAgeMinutes:
      Number.isFinite(ageMinutes)
        ? Number(
            ageMinutes.toFixed(1)
          )
        : null,
    stale,
    isolatedLine,
    highDisagreement,
    priceOutlier,
    staleOutlier,
    reason:
      isolatedLine
        ? "Exact line is isolated to one paired sportsbook."
        : staleOutlier
        ? "Quote is both stale and materially off the same-line cross-book consensus."
        : highDisagreement
        ? "Same-line sportsbooks disagree too widely on no-vig probability."
        : "Market integrity gate is clear."
  };
}

function exactPairs(prop) {
  const rows = [];
  const overBooks = prop?.over?.books || {};
  const underBooks = prop?.under?.books || {};

  for (const [book, over] of Object.entries(overBooks)) {
    const under = underBooks[book];
    if (!under) continue;
    const overLine =
      num(over?.line) ??
      num(prop?.over?.consensus?.line);
    const underLine =
      num(under?.line) ??
      num(prop?.under?.consensus?.line);
    if (
      overLine === null ||
      underLine === null ||
      Math.abs(overLine - underLine) > 1e-9
    ) {
      continue;
    }
    const overOdds = num(over?.odds);
    const underOdds = num(under?.odds);
    if (
      overOdds === null ||
      underOdds === null
    ) {
      continue;
    }
    rows.push({
      book,
      line: overLine,
      overOdds,
      underOdds,
      updatedAt:
        over?.updatedAt ||
        under?.updatedAt ||
        null
    });
  }
  return rows;
}

function normalizeAvailabilityStatus(value) {
  const status = String(value || "")
    .trim()
    .toLowerCase();
  if (!status) return null;
  if (status.includes("out")) return "OUT";
  if (status.includes("doubt")) return "DOUBTFUL";
  if (status.includes("question")) return "QUESTIONABLE";
  if (status.includes("probab")) return "PROBABLE";
  if (status.includes("available")) return "AVAILABLE";
  return status.toUpperCase();
}

function injuryForPlayer(
  injuries,
  targetPlayerName
) {
  const key = normalizePlayerName(targetPlayerName);
  const row = (injuries || []).find(
    (item) =>
      normalizePlayerName(playerName(item)) === key
  );
  if (!row) {
    return {
      secondaryStatus: null,
      secondarySource: "BALLDONTLIE",
      description: null,
      returnDate: null
    };
  }
  return {
    secondaryStatus:
      normalizeAvailabilityStatus(row?.status),
    secondarySource: "BALLDONTLIE",
    description: row?.description || null,
    returnDate: row?.return_date || null
  };
}

function officialInjuryContext({
  playerName: targetPlayer,
  gameDate,
  teamName = null,
  officialReport = null,
  secondary,
  now = new Date()
}) {
  const secondaryStatus =
    secondary?.secondaryStatus || null;
  const secondaryBlocked = [
    "OUT",
    "DOUBTFUL"
  ].includes(secondaryStatus);

  const official =
    resolveOfficialAvailability(
      officialReport,
      {
        playerName: targetPlayer,
        teamName,
        now
      }
    );

  const officialResolved =
    official?.officialReportParsed === true &&
    official?.resolvedForPlay === true;
  const officialBlocked =
    official?.availabilityBlocked === true;
  const conflict =
    officialResolved &&
    secondaryBlocked;

  if (
    official?.officialReportParsed === true
  ) {
    return {
      playerName: targetPlayer,
      gameDate: gameDate || null,
      authority: "NBA Official",
      authorityPage:
        official?.sourceUrl || null,
      officialStatus:
        official?.officialStatus || null,
      officialReportParsed: true,
      reportTimestamp:
        official?.reportTimestamp || null,
      reportAgeMinutes:
        official?.reportAgeMinutes ?? null,
      secondaryStatus,
      secondarySource:
        secondary?.secondarySource || null,
      description:
        secondary?.description || null,
      returnDate:
        secondary?.returnDate || null,
      conflict,
      availabilityBlocked:
        officialBlocked ||
        conflict,
      resolvedForPlay:
        officialResolved &&
        !conflict,
      reason:
        conflict
          ? `Official report and secondary injury feed conflict (${official.officialStatus} vs ${secondaryStatus}); shadow PLAY is blocked.`
          : official?.reason ||
            "Official NBA availability is unresolved.",
      reasonDetail:
        official?.reasonDetail || null
    };
  }

  return {
    playerName: targetPlayer,
    gameDate: gameDate || null,
    authority: "NBA Official",
    authorityPage:
      official?.sourceUrl || null,
    officialStatus: null,
    officialReportParsed: false,
    reportTimestamp: null,
    reportAgeMinutes: null,
    secondaryStatus,
    secondarySource:
      secondary?.secondarySource || null,
    description:
      secondary?.description || null,
    returnDate:
      secondary?.returnDate || null,
    conflict: false,
    availabilityBlocked:
      secondaryBlocked,
    resolvedForPlay: false,
    reason: secondaryBlocked
      ? `Secondary injury feed lists player as ${secondaryStatus}; official report is unresolved and shadow PLAY is blocked.`
      : official?.reason ||
        "Official NBA injury report has not yet been parsed for this player; projection may be shown but shadow PLAY is blocked."
  };
}

function qualityScore({
  projection,
  pairedBooks,
  injury
}) {
  if (!projection?.available) return 0;

  let score = 0.34;
  score += Math.min(
    0.24,
    projection.historyGames * 0.03
  );
  score += Math.min(0.16, pairedBooks * 0.04);

  if (
    Number.isFinite(projection.projectedMinutes) &&
    projection.projectedMinutes >= 15
  ) {
    score += 0.10;
  }
  if (
    Number.isFinite(projection.minutesSd) &&
    projection.minutesSd <= 5
  ) {
    score += 0.08;
  }

  if (injury?.officialReportParsed) {
    score += 0.08;
  } else {
    score = Math.min(score, 0.64);
  }
  if (injury?.availabilityBlocked) {
    score = Math.min(score, 0.35);
  }

  return clamp(score, 0, 1);
}

function gradeProp({
  event,
  prop,
  projection,
  injury,
  now = new Date()
}) {
  const pairs = exactPairs(prop);
  const lineCounts = new Map();
  for (const pair of pairs) {
    const key = String(pair.line);
    lineCounts.set(
      key,
      (lineCounts.get(key) || 0) + 1
    );
  }

  const candidates = [];
  for (const pair of pairs) {
    const pairedBooks =
      lineCounts.get(String(pair.line)) || 0;

    for (const side of ["over", "under"]) {
      const odds =
        side === "over"
          ? pair.overOdds
          : pair.underOdds;
      const opponentOdds =
        side === "over"
          ? pair.underOdds
          : pair.overOdds;
      const rawIndependent =
        independentProbability(
          projection,
          side,
          pair.line,
          projection?.rawMean
        );
      const shadowIndependent =
        independentProbability(
          projection,
          side,
          pair.line
        );
      const marketFair =
        noVigProbability(
          odds,
          opponentOdds
        );
      const edge =
        Number.isFinite(shadowIndependent) &&
        Number.isFinite(marketFair)
          ? shadowIndependent - marketFair
          : null;
      const ev =
        Number.isFinite(shadowIndependent)
          ? expectedValue(shadowIndependent, odds)
          : null;
      const baseDataQuality =
        qualityScore({
          projection,
          pairedBooks,
          injury
        });
      const integrity =
        marketIntegrity(
          pairs,
          pair,
          side,
          now
        );
      const dataQuality =
        clamp(
          baseDataQuality *
            (
              0.8 +
              0.2 * integrity.score
            ),
          0,
          1
        );

      const shadowPlay =
        projection?.available &&
        injury?.resolvedForPlay === true &&
        injury?.availabilityBlocked !== true &&
        integrity.blocked !== true &&
        integrity.score >= 0.55 &&
        dataQuality >= 0.72 &&
        pairedBooks >= 2 &&
        edge !== null &&
        edge >= 0.035 &&
        ev !== null &&
        ev >= 0.03;

      candidates.push({
        id: [
          event.eventID,
          prop.statID,
          normalizePlayerName(prop.playerName),
          side,
          pair.book,
          pair.line
        ].join("|"),
        eventID: event.eventID,
        startsAt: event.startsAt,
        away: event?.matchup?.away?.name || null,
        home: event?.matchup?.home?.name || null,
        playerID: prop.playerID || null,
        playerName: prop.playerName,
        statID: prop.statID,
        marketName: prop.marketName || null,
        side,
        book: pair.book,
        line: pair.line,
        odds,
        pairedOdds: opponentOdds,
        exactLineBookCount: pairedBooks,
        marketFairProbability:
          Number.isFinite(marketFair)
            ? Number(marketFair.toFixed(6))
            : null,
        rawIndependentProbability:
          Number.isFinite(rawIndependent)
            ? Number(rawIndependent.toFixed(6))
            : null,
        shadowModelProbability:
          Number.isFinite(shadowIndependent)
            ? Number(shadowIndependent.toFixed(6))
            : marketFair,
        edgePct:
          edge === null
            ? null
            : Number((edge * 100).toFixed(3)),
        evPct:
          ev === null
            ? null
            : Number((ev * 100).toFixed(3)),
        rawProjectionMean:
          projection?.rawMean ?? projection?.mean ?? null,
        projectionMean:
          projection?.mean ?? null,
        contextChallengerMean:
          projection?.contextChallengerMean ?? null,
        contextSignal:
          projection?.contextSignal ?? null,
        contextShadowWeight:
          projection?.contextShadowWeight ?? 0,
        gameContext:
          projection?.gameContext ?? null,
        projectionSd:
          projection?.sd ?? null,
        projectedMinutes:
          projection?.projectedMinutes ?? null,
        historyGames:
          projection?.historyGames ?? 0,
        dataQuality:
          Number(dataQuality.toFixed(3)),
        baseDataQuality:
          Number(
            baseDataQuality.toFixed(3)
          ),
        marketIntegrity:
          integrity,
        injury,
        shadowStatus:
          shadowPlay ? "PLAY" : "PASS",
        status: "PASS",
        productionEligible: false,
        productionWeight: 0,
        reason: shadowPlay
          ? "NBA player-prop v1 shadow thresholds cleared; production remains disabled pending chronological calibration and official injury-report validation."
          : !projection?.available
          ? projection?.reason ||
            "Player history is unavailable."
          : injury?.availabilityBlocked
          ? injury.reason
          : injury?.resolvedForPlay !== true
          ? injury?.reason ||
            "Official availability is unresolved."
          : integrity.blocked
          ? integrity.reason
          : "NBA player-prop v1.1 production is disabled; shadow edge, market depth, integrity, or data-quality threshold was not met."
      });
    }
  }

  return candidates;
}

async function fetchBdlPages(
  url,
  apiKey,
  {
    maxPages = 6,
    cacheTtlMs = 10 * 60 * 1000
  } = {}
) {
  const cacheKey = url.toString();
  const hit = cache.get(cacheKey);
  if (
    hit &&
    Date.now() - hit.at < cacheTtlMs
  ) {
    return hit.value;
  }

  const rows = [];
  let cursor = null;
  let pages = 0;

  while (pages < maxPages) {
    const pageUrl = new URL(url);
    if (cursor !== null) {
      pageUrl.searchParams.set(
        "cursor",
        String(cursor)
      );
    }

    const response = await fetch(pageUrl, {
      headers: {
        accept: "application/json",
        authorization: apiKey
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000)
    });
    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { error: raw.slice(0, 500) };
    }

    if (!response.ok) {
      const error = new Error(
        payload?.message ||
        payload?.error ||
        `BALLDONTLIE request failed (${response.status})`
      );
      error.status = response.status;
      throw error;
    }

    rows.push(
      ...(Array.isArray(payload?.data)
        ? payload.data
        : [])
    );
    pages += 1;
    cursor =
      payload?.meta?.next_cursor ?? null;
    if (cursor === null) break;
  }

  const value = { rows, pages };
  cache.set(cacheKey, {
    at: Date.now(),
    value
  });
  while (cache.size > 30) {
    cache.delete(cache.keys().next().value);
  }

  return value;
}

async function loadNbaPlayerStats({
  apiKey,
  gameIds = []
}) {
  if (!apiKey) {
    return {
      rows: [],
      sourceHealth: {
        status: "UNAVAILABLE",
        source: "BALLDONTLIE",
        reason:
          "BALLDONTLIE_API_KEY is not configured."
      }
    };
  }

  if (!gameIds.length) {
    return {
      rows: [],
      sourceHealth: {
        status: "UNAVAILABLE",
        source: "BALLDONTLIE",
        reason:
          "No recent NBA game IDs were available for player-history lookup."
      }
    };
  }

  const url = new URL(BDL_STATS_URL);
  url.searchParams.set("per_page", "100");
  for (const id of gameIds.slice(0, 40)) {
    url.searchParams.append(
      "game_ids[]",
      String(id)
    );
  }

  try {
    const result = await fetchBdlPages(
      url,
      apiKey,
      {
        maxPages: 10,
        cacheTtlMs: 20 * 60 * 1000
      }
    );
    return {
      rows: result.rows,
      sourceHealth: {
        status:
          result.rows.length
            ? "HEALTHY"
            : "EMPTY",
        source: "BALLDONTLIE",
        rowCount: result.rows.length,
        pages: result.pages,
        accessRequirement:
          "ALL-STAR or GOAT"
      }
    };
  } catch (error) {
    return {
      rows: [],
      sourceHealth: {
        status: "UNAVAILABLE",
        source: "BALLDONTLIE",
        error:
          error instanceof Error
            ? error.message
            : String(error),
        accessRequirement:
          "ALL-STAR or GOAT"
      }
    };
  }
}

async function loadNbaInjuries({
  apiKey,
  teamIds = []
}) {
  if (!apiKey) {
    return {
      rows: [],
      sourceHealth: {
        status: "UNAVAILABLE",
        source: "BALLDONTLIE",
        reason:
          "BALLDONTLIE_API_KEY is not configured."
      }
    };
  }

  const url = new URL(BDL_INJURIES_URL);
  url.searchParams.set("per_page", "100");
  for (const id of teamIds.slice(0, 12)) {
    url.searchParams.append(
      "team_ids[]",
      String(id)
    );
  }

  try {
    const result = await fetchBdlPages(
      url,
      apiKey,
      {
        maxPages: 4,
        cacheTtlMs: 5 * 60 * 1000
      }
    );
    return {
      rows: result.rows,
      sourceHealth: {
        status:
          result.rows.length
            ? "HEALTHY"
            : "EMPTY",
        source: "BALLDONTLIE",
        rowCount: result.rows.length,
        pages: result.pages,
        accessRequirement:
          "ALL-STAR or GOAT",
        authoritative: false
      }
    };
  } catch (error) {
    return {
      rows: [],
      sourceHealth: {
        status: "UNAVAILABLE",
        source: "BALLDONTLIE",
        error:
          error instanceof Error
            ? error.message
            : String(error),
        accessRequirement:
          "ALL-STAR or GOAT",
        authoritative: false
      }
    };
  }
}

function playerRowsForProp(
  statsRows,
  prop,
  startsAt
) {
  return recentPlayerRows(
    statsRows,
    prop.playerName,
    startsAt,
    10
  );
}

function projectPropEvent({
  event,
  statsRows = [],
  injuries = [],
  officialReport = null,
  boardEvent = null,
  games = [],
  season = null,
  now = new Date()
}) {
  const candidates = [];
  const players = [];

  for (const prop of event?.props || []) {
    if (
      !SUPPORTED_STATS.includes(prop.statID)
    ) {
      continue;
    }

    const history = playerRowsForProp(
      statsRows,
      prop,
      event.startsAt
    );
    const baseProjection =
      projectionFromHistory(
        history,
        prop.statID,
        {
          beforeAt: event.startsAt
        }
      );
    const gameContext =
      buildNbaPropGameContext({
        propEvent: event,
        boardEvent,
        games,
        season,
        playerTeamName:
          baseProjection?.teamName || null
      });
    const projection =
      applyNbaPropGameContext(
        baseProjection,
        prop.statID,
        gameContext
      );
    const secondary = injuryForPlayer(
      injuries,
      prop.playerName
    );
    const injury =
      officialInjuryContext({
        playerName: prop.playerName,
        gameDate:
          event.startsAt
            ? String(event.startsAt).slice(0, 10)
            : null,
        teamName:
          projection?.teamName || null,
        officialReport,
        secondary,
        now
      });

    const playerCandidates = gradeProp({
      event,
      prop,
      projection,
      injury,
      now
    });
    candidates.push(...playerCandidates);
    players.push({
      prop,
      projection,
      injury
    });
  }

  return {
    eventID: event.eventID,
    startsAt: event.startsAt,
    matchup: event.matchup,
    playerCount: players.length,
    players,
    candidates
  };
}

export {
  NBA_PLAYER_PROP_VERSION,
  NBA_OFFICIAL_INJURY_PAGE,
  SUPPORTED_STATS,
  normalizePlayerName,
  parseMinutes,
  statValue,
  usageProxy,
  recentPlayerRows,
  projectionFromHistory,
  independentProbability,
  quoteAgeMinutes,
  marketIntegrity,
  exactPairs,
  injuryForPlayer,
  officialInjuryContext,
  qualityScore,
  gradeProp,
  loadNbaPlayerStats,
  loadNbaInjuries,
  projectPropEvent
};
