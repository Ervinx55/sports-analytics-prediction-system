const BALLDONTLIE_GAMES_URL =
  "https://api.balldontlie.io/v1/games";

const NBA_MODEL_VERSION = "NBA Team Markets v1-shadow";
const NBA_HOME_COURT_POINTS = 2.2;
const NBA_MARGIN_SD = 12.5;
const NBA_TOTAL_SD = 17.0;

const TEAM_ALIASES = new Map(Object.entries({
  atlantahawks: "ATL", atl: "ATL",
  bostonceltics: "BOS", bos: "BOS",
  brooklynnets: "BKN", bkn: "BKN", brk: "BKN",
  charlottehornets: "CHA", cha: "CHA",
  chicagobulls: "CHI", chi: "CHI",
  clevelandcavaliers: "CLE", cle: "CLE",
  dallasmavericks: "DAL", dal: "DAL",
  denvernuggets: "DEN", den: "DEN",
  detroitpistons: "DET", det: "DET",
  goldenstatewarriors: "GSW", gsw: "GSW",
  houstonrockets: "HOU", hou: "HOU",
  indianapacers: "IND", ind: "IND",
  laclippers: "LAC", losangelesclippers: "LAC", lac: "LAC",
  losangeleslakers: "LAL", lal: "LAL",
  memphisgrizzlies: "MEM", mem: "MEM",
  miamiheat: "MIA", mia: "MIA",
  milwaukeebucks: "MIL", mil: "MIL",
  minnesotatimberwolves: "MIN", min: "MIN",
  neworleanspelicans: "NOP", nop: "NOP", no: "NOP",
  newyorkknicks: "NYK", nyk: "NYK",
  oklahomacitythunder: "OKC", okc: "OKC",
  orlandomagic: "ORL", orl: "ORL",
  philadelphia76ers: "PHI", phi: "PHI",
  phoenixsuns: "PHX", phx: "PHX",
  portlandtrailblazers: "POR", por: "POR",
  sacramentokings: "SAC", sac: "SAC",
  sanantoniospurs: "SAS", sas: "SAS",
  torontoraptors: "TOR", tor: "TOR",
  utahjazz: "UTA", uta: "UTA", uth: "UTA",
  washingtonwizards: "WAS", was: "WAS"
}));

const cache =
  globalThis.__edgeLabNbaDataCache ||
  (globalThis.__edgeLabNbaDataCache = new Map());

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace("+", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values) {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function sd(values) {
  const usable = values.filter(Number.isFinite);
  if (usable.length < 2) return 1;
  const avg = mean(usable);
  const variance = usable.reduce(
    (sum, value) => sum + (value - avg) ** 2,
    0
  ) / (usable.length - 1);
  return Math.sqrt(variance) || 1;
}

function weightedAverage(rows, getter) {
  let numerator = 0;
  let denominator = 0;
  for (const row of rows || []) {
    const value = getter(row);
    if (!Number.isFinite(value)) continue;
    numerator += row.weight * value;
    denominator += row.weight;
  }
  return denominator > 0 ? numerator / denominator : null;
}

function standardize(value, baseline) {
  if (!Number.isFinite(value) || !(baseline?.sd > 0)) return 0;
  return (value - baseline.mean) / baseline.sd;
}

function normalizeTeam(value) {
  const key = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return TEAM_ALIASES.get(key) || null;
}

function seasonForDate(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return month >= 7 ? year : year - 1;
}

function isoDate(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString().slice(0, 10)
    : null;
}

function daysBefore(dateIso, days) {
  const parsed = Date.parse(String(dateIso || ""));
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed - days * 86400000).toISOString().slice(0, 10);
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
  return value > 0
    ? 1 + value / 100
    : 1 + 100 / Math.abs(value);
}

function noVigProbability(sideOdds, opponentOdds) {
  const side = americanToProbability(sideOdds);
  const opponent = americanToProbability(opponentOdds);
  if (side === null || opponent === null || side + opponent <= 0) {
    return null;
  }
  return side / (side + opponent);
}

function expectedValue(probability, odds, pushProbability = 0) {
  const decimal = americanToDecimal(odds);
  if (!Number.isFinite(probability) || decimal === null) return null;
  const push = clamp(num(pushProbability) ?? 0, 0, 1);
  const loss = Math.max(0, 1 - probability - push);
  return probability * (decimal - 1) - loss;
}

function gameStartsAt(game) {
  return (
    game?.datetime ||
    (game?.date ? `${game.date}T23:59:59Z` : null)
  );
}

function isFinalGame(game) {
  if (String(game?.status_state || "").toLowerCase() === "final") {
    return true;
  }
  return /^final$/i.test(String(game?.status || game?.time || ""));
}

function teamForSide(game, side) {
  return side === "home"
    ? game?.home_team
    : game?.visitor_team;
}

function teamAbbreviation(team) {
  return normalizeTeam(team?.abbreviation || team?.full_name || team?.name);
}

function teamHistory(
  games,
  team,
  beforeAt,
  season,
  limit = 12
) {
  const cutoff = Date.parse(beforeAt || "");
  return (games || [])
    .filter((game) => {
      if (!isFinalGame(game)) return false;
      const starts = Date.parse(gameStartsAt(game) || "");
      if (Number.isFinite(cutoff) && Number.isFinite(starts) && starts >= cutoff) {
        return false;
      }
      const home = teamAbbreviation(game?.home_team);
      const away = teamAbbreviation(game?.visitor_team);
      return [home, away].includes(team);
    })
    .sort(
      (a, b) =>
        Date.parse(gameStartsAt(b) || "") -
        Date.parse(gameStartsAt(a) || "")
    )
    .slice(0, limit)
    .map((game, index) => {
      const home = teamAbbreviation(game?.home_team) === team;
      const pointsFor = num(
        home ? game?.home_team_score : game?.visitor_team_score
      );
      const pointsAgainst = num(
        home ? game?.visitor_team_score : game?.home_team_score
      );
      const currentSeason = num(game?.season) === season;
      return {
        gameId: game?.id ?? null,
        startsAt: gameStartsAt(game),
        season: num(game?.season),
        home,
        pointsFor,
        pointsAgainst,
        margin:
          pointsFor !== null && pointsAgainst !== null
            ? pointsFor - pointsAgainst
            : null,
        total:
          pointsFor !== null && pointsAgainst !== null
            ? pointsFor + pointsAgainst
            : null,
        weight:
          Math.exp(-0.15 * index) *
          (currentSeason ? 1 : 0.35)
      };
    });
}

function scheduleContext(history, beforeAt) {
  const cutoff = Date.parse(beforeAt || "");
  const prior = (history || [])
    .map((row) => ({
      ...row,
      at: Date.parse(row.startsAt || "")
    }))
    .filter((row) => Number.isFinite(row.at) && row.at < cutoff)
    .sort((a, b) => b.at - a.at);

  const previous = prior[0] || null;
  const hoursSince =
    previous && Number.isFinite(cutoff)
      ? Math.max(0, (cutoff - previous.at) / 3600000)
      : null;
  const restDays =
    hoursSince === null
      ? null
      : Math.max(0, Math.floor(hoursSince / 24) - 1);
  const last72h = prior.filter(
    (row) => cutoff - row.at <= 72 * 3600000
  ).length;
  const last120h = prior.filter(
    (row) => cutoff - row.at <= 120 * 3600000
  ).length;

  let fatiguePenalty = 0;
  if (restDays === 0) fatiguePenalty += 1.1;
  if (last72h >= 2) fatiguePenalty += 0.55;
  if (last120h >= 3) fatiguePenalty += 0.35;

  return {
    previousGameAt: previous?.startsAt || null,
    hoursSincePrevious: hoursSince === null
      ? null
      : Number(hoursSince.toFixed(1)),
    restDays,
    backToBack: restDays === 0,
    gamesLast72Hours: last72h,
    gamesLast120Hours: last120h,
    fatiguePenalty: Number(fatiguePenalty.toFixed(3))
  };
}

function teamSnapshot(
  games,
  team,
  beforeAt,
  season
) {
  const history = teamHistory(
    games,
    team,
    beforeAt,
    season,
    12
  );
  const currentSeasonGames = history.filter(
    (row) => row.season === season
  ).length;

  return {
    team,
    games: history.length,
    currentSeasonGames,
    pointsFor: weightedAverage(history, (row) => row.pointsFor),
    pointsAgainst: weightedAverage(
      history,
      (row) => row.pointsAgainst
    ),
    margin: weightedAverage(history, (row) => row.margin),
    total: weightedAverage(history, (row) => row.total),
    homeMargin: weightedAverage(
      history.filter((row) => row.home),
      (row) => row.margin
    ),
    awayMargin: weightedAverage(
      history.filter((row) => !row.home),
      (row) => row.margin
    ),
    schedule: scheduleContext(history, beforeAt)
  };
}

function leagueBaselines(snapshots) {
  const fields = [
    "pointsFor",
    "pointsAgainst",
    "margin",
    "total"
  ];
  const out = {};
  for (const field of fields) {
    const values = snapshots
      .map((row) => row?.[field])
      .filter(Number.isFinite);
    out[field] = {
      mean: mean(values) ?? (
        field === "total" ? 226 : field === "margin" ? 0 : 113
      ),
      sd: sd(values)
    };
  }
  return out;
}

function teamPower(snapshot, baseline) {
  const margin = standardize(snapshot.margin, baseline.margin);
  const offense = standardize(
    snapshot.pointsFor,
    baseline.pointsFor
  );
  const defense = -standardize(
    snapshot.pointsAgainst,
    baseline.pointsAgainst
  );

  return {
    composite:
      0.56 * margin +
      0.24 * offense +
      0.20 * defense,
    components: {
      margin,
      offense,
      defense
    }
  };
}

function exactBooks(market) {
  return Object.entries(market?.books || {})
    .filter(([, price]) =>
      price &&
      price.available !== false &&
      num(price.odds) !== null
    )
    .map(([book, price]) => ({
      book,
      odds: num(price.odds),
      line: num(price.line),
      updatedAt: price.updatedAt || null
    }));
}

function sameBookPair(sideMarket, opponentMarket, {
  side,
  marketType
}) {
  const opponentByBook = new Map(
    exactBooks(opponentMarket).map((row) => [row.book, row])
  );

  return exactBooks(sideMarket)
    .map((quote) => {
      const opponent = opponentByBook.get(quote.book);
      if (!opponent) return null;

      if (marketType === "spread") {
        if (
          quote.line === null ||
          opponent.line === null ||
          Math.abs(quote.line + opponent.line) > 1e-9
        ) {
          return null;
        }
      }
      if (marketType === "total") {
        if (
          quote.line === null ||
          opponent.line === null ||
          Math.abs(quote.line - opponent.line) > 1e-9
        ) {
          return null;
        }
      }

      return {
        ...quote,
        side,
        opponentOdds: opponent.odds,
        marketFairProbability:
          noVigProbability(quote.odds, opponent.odds)
      };
    })
    .filter(Boolean);
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
  const y = 1 -
    (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) *
      t * Math.exp(-value * value);
  return sign * y;
}

function normalCdf(x, meanValue, standardDeviation) {
  return 0.5 * (
    1 +
    erf(
      (x - meanValue) /
      (standardDeviation * Math.SQRT2)
    )
  );
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rngFromSeed(seed) {
  let state = seed || 1;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function standardNormal(rng) {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return (
    Math.sqrt(-2 * Math.log(u1)) *
    Math.cos(2 * Math.PI * u2)
  );
}

function simulateGame({
  eventId,
  projectedHomeMargin,
  projectedTotal,
  iterations = 20000
}) {
  const rng = rngFromSeed(hashSeed(eventId));
  let homeWins = 0;
  let awayWins = 0;
  let homePoints = 0;
  let awayPoints = 0;

  for (let i = 0; i < iterations; i += 1) {
    const margin =
      projectedHomeMargin +
      NBA_MARGIN_SD * standardNormal(rng);
    const total = Math.max(
      Math.abs(margin),
      projectedTotal +
      NBA_TOTAL_SD * standardNormal(rng)
    );
    const home = Math.max(0, (total + margin) / 2);
    const away = Math.max(0, (total - margin) / 2);
    homePoints += home;
    awayPoints += away;

    if (margin > 0) homeWins += 1;
    else awayWins += 1;
  }

  return {
    iterations,
    projectedScore: {
      away: Number((awayPoints / iterations).toFixed(1)),
      home: Number((homePoints / iterations).toFixed(1))
    },
    moneyline: {
      away: awayWins / iterations,
      home: homeWins / iterations
    }
  };
}

function probabilityBlend(
  marketProbability,
  independentProbability,
  independentWeight
) {
  if (
    !Number.isFinite(marketProbability) ||
    !Number.isFinite(independentProbability)
  ) {
    return Number.isFinite(marketProbability)
      ? marketProbability
      : null;
  }
  const weight = clamp(independentWeight, 0, 0.5);
  return clamp(
    marketProbability +
      weight *
        (independentProbability - marketProbability),
    1e-6,
    1 - 1e-6
  );
}

function linePeerCount(market, line) {
  if (line === null) return exactBooks(market).length;
  return exactBooks(market).filter(
    (row) =>
      row.line !== null &&
      Math.abs(row.line - line) < 1e-9
  ).length;
}

function gradeQuote({
  event,
  marketType,
  side,
  label,
  sideMarket,
  opponentMarket,
  independentProbabilityForLine,
  independentWeight,
  dataQuality
}) {
  const rows = sameBookPair(
    sideMarket,
    opponentMarket,
    { side, marketType }
  );

  return rows.map((quote) => {
    const independentProbability =
      independentProbabilityForLine(quote.line);
    const modelProbability = probabilityBlend(
      quote.marketFairProbability,
      independentProbability,
      independentWeight
    );
    const edge =
      Number.isFinite(modelProbability) &&
      Number.isFinite(quote.marketFairProbability)
        ? modelProbability - quote.marketFairProbability
        : null;
    const ev =
      modelProbability === null
        ? null
        : expectedValue(modelProbability, quote.odds);
    const bookCount = quote.line === null
      ? rows.length
      : rows.filter(
          (row) =>
            row.line !== null &&
            Math.abs(row.line - quote.line) < 1e-9
        ).length;

    const shadowPlay =
      dataQuality >= 0.66 &&
      bookCount >= 2 &&
      edge !== null &&
      edge >= 0.03 &&
      ev !== null &&
      ev >= 0.025;

    return {
      id: [
        event.eventID,
        marketType,
        side,
        quote.book,
        quote.line ?? "na"
      ].join("|"),
      eventID: event.eventID,
      startsAt: event.startsAt,
      away: event.matchup.away.name,
      home: event.matchup.home.name,
      marketType,
      side,
      label,
      book: quote.book,
      line: quote.line,
      odds: quote.odds,
      opponentOdds: quote.opponentOdds,
      marketFairProbability:
        Number(quote.marketFairProbability.toFixed(6)),
      rawIndependentProbability:
        Number.isFinite(independentProbability)
          ? Number(independentProbability.toFixed(6))
          : null,
      modelProbability:
        Number.isFinite(modelProbability)
          ? Number(modelProbability.toFixed(6))
          : null,
      edgePctPoints:
        edge === null
          ? null
          : Number((edge * 100).toFixed(3)),
      evPct:
        ev === null
          ? null
          : Number((ev * 100).toFixed(3)),
      exactLineBookCount: bookCount,
      dataQuality: Number(dataQuality.toFixed(3)),
      updatedAt: quote.updatedAt,
      shadowStatus: shadowPlay ? "PLAY" : "PASS",
      status: "PASS",
      productionEligible: false,
      productionWeight: 0,
      reason: shadowPlay
        ? "NBA v1 shadow edge clears provisional thresholds; production remains disabled pending chronological validation."
        : "NBA v1 production is disabled; shadow edge, market depth, or data-quality threshold was not met."
    };
  });
}

function projectEvent({
  event,
  games,
  season,
  simulationIterations = 20000
}) {
  const away = normalizeTeam(
    event?.matchup?.away?.name ||
    event?.matchup?.away?.short
  );
  const home = normalizeTeam(
    event?.matchup?.home?.name ||
    event?.matchup?.home?.short
  );

  if (!away || !home) {
    return {
      eventID: event?.eventID ?? null,
      available: false,
      reason: "Unable to normalize one or both NBA teams."
    };
  }

  const startsAt = event?.startsAt || new Date().toISOString();
  const teamSet = new Set([away, home]);
  for (const game of games || []) {
    const h = teamAbbreviation(game?.home_team);
    const a = teamAbbreviation(game?.visitor_team);
    if (h) teamSet.add(h);
    if (a) teamSet.add(a);
  }

  const snapshots = new Map(
    [...teamSet].map((team) => [
      team,
      teamSnapshot(games, team, startsAt, season)
    ])
  );
  const baseline = leagueBaselines([...snapshots.values()]);
  const homeSnapshot = snapshots.get(home);
  const awaySnapshot = snapshots.get(away);
  const homePower = teamPower(homeSnapshot, baseline);
  const awayPower = teamPower(awaySnapshot, baseline);

  const historyAvailable =
    homeSnapshot.games > 0 &&
    awaySnapshot.games > 0;

  const homeFatigue =
    homeSnapshot.schedule?.fatiguePenalty || 0;
  const awayFatigue =
    awaySnapshot.schedule?.fatiguePenalty || 0;
  const scheduleAdjustment =
    awayFatigue - homeFatigue;

  const independentHomeMargin =
    historyAvailable
      ? NBA_HOME_COURT_POINTS +
        3.6 *
          (homePower.composite - awayPower.composite) +
        scheduleAdjustment
      : null;

  const leaguePoints =
    baseline.pointsFor.mean || 113;
  const independentHomePoints =
    historyAvailable
      ? leaguePoints +
        0.52 *
          ((homeSnapshot.pointsFor ?? leaguePoints) -
            leaguePoints) +
        0.43 *
          ((awaySnapshot.pointsAgainst ?? leaguePoints) -
            leaguePoints)
      : null;
  const independentAwayPoints =
    historyAvailable
      ? leaguePoints +
        0.52 *
          ((awaySnapshot.pointsFor ?? leaguePoints) -
            leaguePoints) +
        0.43 *
          ((homeSnapshot.pointsAgainst ?? leaguePoints) -
            leaguePoints)
      : null;
  const independentTotal =
    Number.isFinite(independentHomePoints) &&
    Number.isFinite(independentAwayPoints)
      ? clamp(
          independentHomePoints +
          independentAwayPoints,
          185,
          275
        )
      : null;

  const currentGames = Math.min(
    homeSnapshot.currentSeasonGames,
    awaySnapshot.currentSeasonGames
  );
  const independentWeight =
    historyAvailable
      ? clamp(0.12 + 0.02 * currentGames, 0.12, 0.34)
      : 0;
  const marketWeight = 1 - independentWeight;

  const marketHomeSpread =
    num(event?.markets?.spread?.home?.consensus?.line);
  const marketHomeMargin =
    marketHomeSpread === null ? null : -marketHomeSpread;
  const marketTotal =
    num(event?.markets?.total?.over?.consensus?.line);

  const projectedHomeMargin =
    marketHomeMargin !== null
      ? (
          independentHomeMargin === null
            ? marketHomeMargin
            : marketWeight * marketHomeMargin +
              independentWeight * independentHomeMargin
        )
      : (independentHomeMargin ?? 0);
  const projectedTotal =
    marketTotal !== null
      ? (
          independentTotal === null
            ? marketTotal
            : marketWeight * marketTotal +
              independentWeight * independentTotal
        )
      : (independentTotal ?? baseline.total.mean ?? 226);

  const moneylineBooks = Math.min(
    exactBooks(event?.markets?.moneyline?.home).length,
    exactBooks(event?.markets?.moneyline?.away).length
  );
  let quality = 0.32;
  quality += Math.min(0.28, currentGames * 0.035);
  quality += Math.min(
    0.16,
    Math.min(homeSnapshot.games, awaySnapshot.games) * 0.018
  );
  quality += Math.min(0.18, moneylineBooks * 0.045);
  quality = clamp(quality, 0, 1);
  if (!historyAvailable) quality = Math.min(quality, 0.48);

  const markets = [];

  const homeMl = event?.markets?.moneyline?.home;
  const awayMl = event?.markets?.moneyline?.away;
  if (homeMl && awayMl) {
    markets.push(
      ...gradeQuote({
        event,
        marketType: "moneyline",
        side: "home",
        label: event.matchup.home.name,
        sideMarket: homeMl,
        opponentMarket: awayMl,
        independentWeight,
        dataQuality: quality,
        independentProbabilityForLine: () =>
          independentHomeMargin === null
            ? null
            : 1 - normalCdf(
                0,
                independentHomeMargin,
                NBA_MARGIN_SD
              )
      }),
      ...gradeQuote({
        event,
        marketType: "moneyline",
        side: "away",
        label: event.matchup.away.name,
        sideMarket: awayMl,
        opponentMarket: homeMl,
        independentWeight,
        dataQuality: quality,
        independentProbabilityForLine: () =>
          independentHomeMargin === null
            ? null
            : normalCdf(
                0,
                independentHomeMargin,
                NBA_MARGIN_SD
              )
      })
    );
  }

  const homeSpread = event?.markets?.spread?.home;
  const awaySpread = event?.markets?.spread?.away;
  if (homeSpread && awaySpread) {
    markets.push(
      ...gradeQuote({
        event,
        marketType: "spread",
        side: "home",
        label: event.matchup.home.name,
        sideMarket: homeSpread,
        opponentMarket: awaySpread,
        independentWeight,
        dataQuality: quality,
        independentProbabilityForLine: (line) =>
          independentHomeMargin === null ||
          line === null
            ? null
            : 1 - normalCdf(
                -line,
                independentHomeMargin,
                NBA_MARGIN_SD
              )
      }),
      ...gradeQuote({
        event,
        marketType: "spread",
        side: "away",
        label: event.matchup.away.name,
        sideMarket: awaySpread,
        opponentMarket: homeSpread,
        independentWeight,
        dataQuality: quality,
        independentProbabilityForLine: (line) =>
          independentHomeMargin === null ||
          line === null
            ? null
            : normalCdf(
                line,
                independentHomeMargin,
                NBA_MARGIN_SD
              )
      })
    );
  }

  const over = event?.markets?.total?.over;
  const under = event?.markets?.total?.under;
  if (over && under) {
    markets.push(
      ...gradeQuote({
        event,
        marketType: "total",
        side: "over",
        label: "Over",
        sideMarket: over,
        opponentMarket: under,
        independentWeight,
        dataQuality: quality,
        independentProbabilityForLine: (line) =>
          independentTotal === null || line === null
            ? null
            : 1 - normalCdf(
                line,
                independentTotal,
                NBA_TOTAL_SD
              )
      }),
      ...gradeQuote({
        event,
        marketType: "total",
        side: "under",
        label: "Under",
        sideMarket: under,
        opponentMarket: over,
        independentWeight,
        dataQuality: quality,
        independentProbabilityForLine: (line) =>
          independentTotal === null || line === null
            ? null
            : normalCdf(
                line,
                independentTotal,
                NBA_TOTAL_SD
              )
      })
    );
  }

  const simulation = simulateGame({
    eventId: event.eventID,
    projectedHomeMargin,
    projectedTotal,
    iterations: simulationIterations
  });

  return {
    eventID: event.eventID,
    startsAt,
    available: true,
    matchup: {
      away: { ...event.matchup.away, normalized: away },
      home: { ...event.matchup.home, normalized: home }
    },
    model: {
      version: NBA_MODEL_VERSION,
      productionEligible: false,
      productionWeight: 0,
      calibrated: false,
      independentAvailable: historyAvailable,
      independentWeight,
      marketWeight,
      projectedHomeMargin:
        Number(projectedHomeMargin.toFixed(3)),
      projectedTotal:
        Number(projectedTotal.toFixed(3)),
      independentHomeMargin:
        independentHomeMargin === null
          ? null
          : Number(independentHomeMargin.toFixed(3)),
      independentTotal:
        independentTotal === null
          ? null
          : Number(independentTotal.toFixed(3)),
      scheduleAdjustmentPoints:
        Number(scheduleAdjustment.toFixed(3)),
      dataQuality: Number(quality.toFixed(3)),
      simulationIterations
    },
    scheduleContext: {
      away: awaySnapshot.schedule,
      home: homeSnapshot.schedule
    },
    teamFeatures: {
      away: {
        ...awaySnapshot,
        power: awayPower
      },
      home: {
        ...homeSnapshot,
        power: homePower
      },
      leagueBaseline: baseline
    },
    simulation,
    markets: markets.sort(
      (a, b) => (b.evPct ?? -999) - (a.evPct ?? -999)
    )
  };
}

async function fetchJson(url, apiKey) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: apiKey
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000)
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { error: text.slice(0, 500) };
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
  return payload;
}

async function loadNbaGames({
  season,
  targetAt = new Date().toISOString(),
  lookbackDays = 14
}) {
  const apiKey = String(
    process.env.BALLDONTLIE_API_KEY || ""
  ).trim();

  if (!apiKey) {
    return {
      games: [],
      sourceHealth: {
        games: {
          status: "UNAVAILABLE",
          source: "BALLDONTLIE",
          adjustmentApplied: false,
          reason:
            "BALLDONTLIE_API_KEY is not configured; NBA model degrades to market-only shadow."
        },
        injuries: {
          status: "UNAVAILABLE",
          source: null,
          adjustmentApplied: false,
          reason:
            "NBA v1 does not apply an injury adjustment until a point-in-time injury source is integrated and validated."
        }
      }
    };
  }

  const endDate = isoDate(targetAt) || isoDate(new Date());
  const startDate = daysBefore(endDate, lookbackDays);
  const cacheKey = [
    season,
    startDate,
    endDate,
    lookbackDays
  ].join("|");
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < 15 * 60 * 1000) {
    return hit.value;
  }

  const games = [];
  let cursor = null;
  let pages = 0;
  let error = null;

  while (pages < 2) {
    const url = new URL(BALLDONTLIE_GAMES_URL);
    url.searchParams.append("seasons[]", String(season));
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set("per_page", "100");
    if (cursor !== null) {
      url.searchParams.set("cursor", String(cursor));
    }

    try {
      const payload = await fetchJson(url, apiKey);
      games.push(...(Array.isArray(payload?.data) ? payload.data : []));
      cursor = payload?.meta?.next_cursor ?? null;
      pages += 1;
      if (cursor === null) break;
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : String(caught);
      break;
    }
  }

  const value = {
    games,
    sourceHealth: {
      games: {
        status: games.length
          ? (error ? "DEGRADED" : "HEALTHY")
          : "UNAVAILABLE",
        source: "BALLDONTLIE",
        rowCount: games.length,
        lookbackDays,
        pages,
        error,
        adjustmentApplied: games.length > 0
      },
      injuries: {
        status: "UNAVAILABLE",
        source: null,
        adjustmentApplied: false,
        reason:
          "NBA v1 does not apply an injury adjustment until a point-in-time injury source is integrated and validated."
      }
    }
  };

  cache.set(cacheKey, { at: Date.now(), value });
  while (cache.size > 20) {
    cache.delete(cache.keys().next().value);
  }
  return value;
}

export {
  BALLDONTLIE_GAMES_URL,
  NBA_MODEL_VERSION,
  NBA_HOME_COURT_POINTS,
  NBA_MARGIN_SD,
  NBA_TOTAL_SD,
  normalizeTeam,
  seasonForDate,
  teamHistory,
  scheduleContext,
  teamSnapshot,
  leagueBaselines,
  teamPower,
  simulateGame,
  projectEvent,
  loadNbaGames,
  noVigProbability
};
