const NFLVERSE_GAMES_URL =
  "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const NFLVERSE_STATS_URL = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`;

const TEAM_ALIASES = new Map(Object.entries({
  arizonacardinals: "ARI", ari: "ARI",
  atlantafalcons: "ATL", atl: "ATL",
  baltimoreravens: "BAL", bal: "BAL",
  buffalobills: "BUF", buf: "BUF",
  carolinapanthers: "CAR", car: "CAR",
  chicagobears: "CHI", chi: "CHI",
  cincinnatibengals: "CIN", cin: "CIN",
  clevelandbrowns: "CLE", cle: "CLE",
  dallascowboys: "DAL", dal: "DAL",
  denverbroncos: "DEN", den: "DEN",
  detroitlions: "DET", det: "DET",
  greenbaypackers: "GB", gb: "GB", gnb: "GB",
  houstontexans: "HOU", hou: "HOU",
  indianapoliscolts: "IND", ind: "IND",
  jacksonvillejaguars: "JAX", jac: "JAX", jax: "JAX",
  kansascitychiefs: "KC", kc: "KC",
  lasvegasraiders: "LV", lv: "LV", oak: "LV",
  losangeleschargers: "LAC", lac: "LAC",
  losangelesrams: "LA", lar: "LA", la: "LA",
  miamidolphins: "MIA", mia: "MIA",
  minnesotavikings: "MIN", min: "MIN",
  newenglandpatriots: "NE", ne: "NE",
  neworleanssaints: "NO", no: "NO",
  newyorkgiants: "NYG", nyg: "NYG",
  newyorkjets: "NYJ", nyj: "NYJ",
  philadelphiaeagles: "PHI", phi: "PHI",
  pittsburghsteelers: "PIT", pit: "PIT",
  sanfrancisco49ers: "SF", sf: "SF",
  seattleseahawks: "SEA", sea: "SEA",
  tampabaybuccaneers: "TB", tb: "TB",
  tennesseetitans: "TEN", ten: "TEN",
  washingtoncommanders: "WAS", was: "WAS"
}));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace("+", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTeam(value) {
  const key = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return TEAM_ALIASES.get(key) || null;
}

function americanToProbability(odds) {
  const o = number(odds);
  if (o === null || o === 0) return null;
  return o > 0 ? 100 / (o + 100) : -o / (-o + 100);
}

function americanToDecimal(odds) {
  const o = number(odds);
  if (o === null || o === 0) return null;
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}

function noVigProbability(sideOdds, opponentOdds) {
  const a = americanToProbability(sideOdds);
  const b = americanToProbability(opponentOdds);
  if (a === null || b === null || a + b <= 0) return null;
  return a / (a + b);
}

function expectedValue(probability, odds) {
  const decimal = americanToDecimal(odds);
  if (probability === null || decimal === null) return null;
  return probability * decimal - 1;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter((values) => values.some((value) => value !== ""))
    .map((values) => Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""])
    ));
}

function cacheState() {
  if (!globalThis.__edgeLabNflDataCache) {
    globalThis.__edgeLabNflDataCache = new Map();
  }
  return globalThis.__edgeLabNflDataCache;
}

async function fetchTextCached(url, ttlMs = 15 * 60 * 1000) {
  const cache = cacheState();
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.at < ttlMs) return hit.text;

  const response = await fetch(url, {
    headers: { accept: "text/csv,*/*" },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`${response.status} fetching ${url}`);
  }
  const text = await response.text();
  cache.set(url, { at: now, text });
  return text;
}

function seasonForDate(date = new Date()) {
  const month = date.getUTCMonth() + 1;
  return month === 1 ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
}

function weightedAverage(items, getter) {
  let numerator = 0;
  let denominator = 0;
  for (const item of items) {
    const value = getter(item);
    if (!Number.isFinite(value)) continue;
    numerator += item.weight * value;
    denominator += item.weight;
  }
  return denominator > 0 ? numerator / denominator : null;
}

function standardize(value, mean, sd) {
  if (!Number.isFinite(value) || !Number.isFinite(mean) || !(sd > 0)) {
    return 0;
  }
  return (value - mean) / sd;
}

function mean(values) {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return 0;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function sd(values) {
  const usable = values.filter(Number.isFinite);
  if (usable.length < 2) return 1;
  const m = mean(usable);
  const variance = usable.reduce(
    (sum, value) => sum + (value - m) ** 2,
    0
  ) / (usable.length - 1);
  return Math.sqrt(variance) || 1;
}

function teamGameHistory(schedule, season, team) {
  const completed = schedule
    .filter((game) => {
      const gameSeason = number(game.season);
      if (![season, season - 1].includes(gameSeason)) return false;
      if (String(game.game_type || "") !== "REG") return false;
      if (![game.away_team, game.home_team].includes(team)) return false;
      return number(game.away_score) !== null && number(game.home_score) !== null;
    })
    .sort((a, b) => String(b.gameday).localeCompare(String(a.gameday)))
    .slice(0, 12);

  return completed.map((game, index) => {
    const home = game.home_team === team;
    const pointsFor = number(home ? game.home_score : game.away_score);
    const pointsAgainst = number(home ? game.away_score : game.home_score);
    const currentSeason = number(game.season) === season;
    const recency = Math.exp(-0.16 * index);
    return {
      gameId: game.game_id,
      season: number(game.season),
      week: number(game.week),
      pointsFor,
      pointsAgainst,
      margin: pointsFor - pointsAgainst,
      total: pointsFor + pointsAgainst,
      weight: recency * (currentSeason ? 1 : 0.45)
    };
  });
}

function rowPlays(row) {
  const attempts = number(row.attempts) ?? 0;
  const sacks = number(row.sacks_suffered) ?? 0;
  const carries = number(row.carries) ?? 0;
  return Math.max(1, attempts + sacks + carries);
}

function rowOffense(row) {
  const plays = rowPlays(row);
  const passingEpa = number(row.passing_epa) ?? 0;
  const rushingEpa = number(row.rushing_epa) ?? 0;
  const passYards = number(row.passing_yards) ?? 0;
  const rushYards = number(row.rushing_yards) ?? 0;
  const interceptions = number(row.passing_interceptions) ?? 0;
  const fumblesLost =
    number(row.fumbles_lost) ??
    ((number(row.rushing_fumbles_lost) ?? 0) +
      (number(row.receiving_fumbles_lost) ?? 0));
  return {
    epaPerPlay: (passingEpa + rushingEpa) / plays,
    yardsPerPlay: (passYards + rushYards) / plays,
    turnovers: interceptions + fumblesLost,
    plays
  };
}

function teamStatHistory(allRows, season, team) {
  const candidates = allRows
    .filter((row) => {
      const rowSeason = number(row.season);
      return (
        [season, season - 1].includes(rowSeason) &&
        String(row.season_type || "") === "REG" &&
        row.team === team
      );
    })
    .sort((a, b) => {
      const seasonDiff = (number(b.season) ?? 0) - (number(a.season) ?? 0);
      if (seasonDiff) return seasonDiff;
      return (number(b.week) ?? 0) - (number(a.week) ?? 0);
    })
    .slice(0, 12);

  const byGameTeam = new Map(
    allRows.map((row) => [`${row.game_id}|${row.team}`, row])
  );

  return candidates.map((row, index) => {
    const currentSeason = number(row.season) === season;
    const offense = rowOffense(row);
    const opponent = byGameTeam.get(`${row.game_id}|${row.opponent_team}`);
    const opponentOffense = opponent ? rowOffense(opponent) : null;
    const recency = Math.exp(-0.16 * index);
    return {
      ...offense,
      opponentEpaPerPlay: opponentOffense?.epaPerPlay ?? null,
      opponentYardsPerPlay: opponentOffense?.yardsPerPlay ?? null,
      opponentTurnovers: opponentOffense?.turnovers ?? null,
      season: number(row.season),
      week: number(row.week),
      weight: recency * (currentSeason ? 1 : 0.45)
    };
  });
}

function teamSnapshot(schedule, stats, season, team) {
  const games = teamGameHistory(schedule, season, team);
  const statRows = teamStatHistory(stats, season, team);
  const currentGames = games.filter((game) => game.season === season);

  const pointsFor = weightedAverage(games, (game) => game.pointsFor);
  const pointsAgainst = weightedAverage(games, (game) => game.pointsAgainst);
  const margin = weightedAverage(games, (game) => game.margin);
  const total = weightedAverage(games, (game) => game.total);
  const offEpa = weightedAverage(statRows, (row) => row.epaPerPlay);
  const defEpaAllowed = weightedAverage(
    statRows,
    (row) => row.opponentEpaPerPlay
  );
  const offYpp = weightedAverage(statRows, (row) => row.yardsPerPlay);
  const defYppAllowed = weightedAverage(
    statRows,
    (row) => row.opponentYardsPerPlay
  );
  const turnoverMargin = weightedAverage(
    statRows,
    (row) => {
      if (!Number.isFinite(row.opponentTurnovers)) return null;
      return row.opponentTurnovers - row.turnovers;
    }
  );

  return {
    team,
    currentSeasonGames: currentGames.length,
    historicalGames: games.length,
    statGames: statRows.length,
    pointsFor,
    pointsAgainst,
    margin,
    total,
    offEpa,
    defEpaAllowed,
    offYpp,
    defYppAllowed,
    turnoverMargin
  };
}

function leagueBaselines(snapshots) {
  const fields = [
    "pointsFor",
    "pointsAgainst",
    "margin",
    "offEpa",
    "defEpaAllowed",
    "offYpp",
    "defYppAllowed",
    "turnoverMargin"
  ];
  const out = {};
  for (const field of fields) {
    const values = snapshots.map((row) => row[field]).filter(Number.isFinite);
    out[field] = { mean: mean(values), sd: sd(values) };
  }
  return out;
}

function teamPower(snapshot, baseline) {
  const scoring = standardize(
    snapshot.margin,
    baseline.margin.mean,
    baseline.margin.sd
  );
  const offenseEpa = standardize(
    snapshot.offEpa,
    baseline.offEpa.mean,
    baseline.offEpa.sd
  );
  const defenseEpa = -standardize(
    snapshot.defEpaAllowed,
    baseline.defEpaAllowed.mean,
    baseline.defEpaAllowed.sd
  );
  const offenseYpp = standardize(
    snapshot.offYpp,
    baseline.offYpp.mean,
    baseline.offYpp.sd
  );
  const defenseYpp = -standardize(
    snapshot.defYppAllowed,
    baseline.defYppAllowed.mean,
    baseline.defYppAllowed.sd
  );
  const turnovers = standardize(
    snapshot.turnoverMargin,
    baseline.turnoverMargin.mean,
    baseline.turnoverMargin.sd
  );

  const composite =
    0.26 * offenseEpa +
    0.24 * defenseEpa +
    0.22 * scoring +
    0.10 * offenseYpp +
    0.10 * defenseYpp +
    0.08 * turnovers;

  return {
    composite,
    components: {
      offenseEpa,
      defenseEpa,
      scoring,
      offenseYpp,
      defenseYpp,
      turnovers
    }
  };
}

function currentScheduleGame(schedule, event, season, away, home) {
  const startsAt = event?.startsAt ? new Date(event.startsAt) : null;
  const date = startsAt && !Number.isNaN(startsAt.valueOf())
    ? startsAt.toISOString().slice(0, 10)
    : null;

  return schedule.find((game) =>
    number(game.season) === season &&
    game.away_team === away &&
    game.home_team === home &&
    (!date || game.gameday === date)
  ) || schedule.find((game) =>
    number(game.season) === season &&
    game.away_team === away &&
    game.home_team === home
  ) || null;
}

function exactLineBest(market, line = null) {
  let bestOdds = null;
  let bestBook = null;
  let bookCount = 0;
  for (const [book, price] of Object.entries(market?.books || {})) {
    if (!price || price.available === false) continue;
    const odds = number(price.odds);
    if (odds === null) continue;
    if (line !== null) {
      const offeredLine = number(price.line);
      if (offeredLine === null || Math.abs(offeredLine - line) > 1e-9) {
        continue;
      }
    }
    bookCount += 1;
    if (bestOdds === null || odds > bestOdds) {
      bestOdds = odds;
      bestBook = book;
    }
  }
  return { odds: bestOdds, book: bestBook, bookCount };
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
    1 + erf((x - meanValue) / (standardDeviation * Math.SQRT2))
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
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function simulateGame({
  eventId,
  projectedHomeMargin,
  projectedTotal,
  homeSpread,
  totalLine,
  iterations = 20000
}) {
  const rng = rngFromSeed(hashSeed(eventId));
  let homeWin = 0;
  let awayWin = 0;
  let homeCover = 0;
  let awayCover = 0;
  let spreadPush = 0;
  let over = 0;
  let under = 0;
  let totalPush = 0;
  let homePointsSum = 0;
  let awayPointsSum = 0;

  for (let i = 0; i < iterations; i += 1) {
    const margin = projectedHomeMargin + 13.6 * standardNormal(rng);
    const total = Math.max(
      Math.abs(margin),
      projectedTotal + 13.8 * standardNormal(rng)
    );
    const homePoints = Math.max(0, (total + margin) / 2);
    const awayPoints = Math.max(0, (total - margin) / 2);
    homePointsSum += homePoints;
    awayPointsSum += awayPoints;

    if (margin > 0) homeWin += 1;
    else awayWin += 1;

    if (Number.isFinite(homeSpread)) {
      const adjusted = margin + homeSpread;
      if (adjusted > 1e-9) homeCover += 1;
      else if (adjusted < -1e-9) awayCover += 1;
      else spreadPush += 1;
    }

    if (Number.isFinite(totalLine)) {
      if (total > totalLine + 1e-9) over += 1;
      else if (total < totalLine - 1e-9) under += 1;
      else totalPush += 1;
    }
  }

  return {
    iterations,
    projectedScore: {
      away: Number((awayPointsSum / iterations).toFixed(1)),
      home: Number((homePointsSum / iterations).toFixed(1))
    },
    moneyline: {
      away: awayWin / iterations,
      home: homeWin / iterations
    },
    spread: {
      away: awayCover / iterations,
      home: homeCover / iterations,
      push: spreadPush / iterations
    },
    total: {
      over: over / iterations,
      under: under / iterations,
      push: totalPush / iterations
    }
  };
}

function marketPairProbability(side, opponent) {
  return noVigProbability(
    side?.consensus?.odds,
    opponent?.consensus?.odds
  );
}

function candidate({
  eventId,
  marketType,
  side,
  label,
  market,
  opponentMarket,
  modelProbability,
  line = null,
  dataQuality
}) {
  const best = exactLineBest(market, line);
  const fairProbability = marketPairProbability(market, opponentMarket);
  const edge = fairProbability === null
    ? null
    : modelProbability - fairProbability;
  const ev = best.odds === null
    ? null
    : expectedValue(modelProbability, best.odds);
  const shadowPlay =
    dataQuality >= 0.68 &&
    best.bookCount >= 2 &&
    edge !== null &&
    edge >= 0.035 &&
    ev !== null &&
    ev >= 0.03;

  return {
    id: `${eventId}|${marketType}|${side}|${line ?? "na"}`,
    marketType,
    side,
    label,
    line,
    modelProbability,
    marketFairProbability: fairProbability,
    edgePctPoints: edge === null ? null : edge * 100,
    bestBook: best.book,
    bestOdds: best.odds,
    exactLineBookCount: best.bookCount,
    evPct: ev === null ? null : ev * 100,
    dataQuality,
    shadowStatus: shadowPlay ? "PLAY" : "PASS",
    status: "PASS",
    productionEligible: false,
    reason: shadowPlay
      ? "Shadow edge clears the NFL v1 threshold; production remains disabled pending backtest."
      : "NFL v1 production is disabled; shadow edge or data-quality threshold was not met."
  };
}

function dataQuality(home, away, game, boardEvent) {
  const currentGames = Math.min(
    home.currentSeasonGames,
    away.currentSeasonGames
  );
  const statsGames = Math.min(home.statGames, away.statGames);
  const moneylineBooks = Math.min(
    exactLineBest(boardEvent?.markets?.moneyline?.home).bookCount,
    exactLineBest(boardEvent?.markets?.moneyline?.away).bookCount
  );
  let score = 0.38;
  score += Math.min(0.18, currentGames * 0.04);
  score += Math.min(0.16, statsGames * 0.02);
  score += Math.min(0.16, moneylineBooks * 0.04);
  if (game?.home_qb_name && game?.away_qb_name) score += 0.06;
  if (game?.away_rest && game?.home_rest) score += 0.03;
  return clamp(score, 0, 1);
}

function projectEvent({
  event,
  schedule,
  stats,
  snapshots,
  baseline,
  season
}) {
  const away = normalizeTeam(
    event?.matchup?.away?.name || event?.matchup?.away?.short
  );
  const home = normalizeTeam(
    event?.matchup?.home?.name || event?.matchup?.home?.short
  );
  if (!away || !home) {
    return {
      eventID: event?.eventID ?? null,
      available: false,
      reason: "Unable to map one or both NFL teams to nflverse."
    };
  }

  const awaySnapshot = snapshots.get(away);
  const homeSnapshot = snapshots.get(home);
  if (!awaySnapshot || !homeSnapshot) {
    return {
      eventID: event?.eventID ?? null,
      available: false,
      reason: "Historical NFL feature data is unavailable for one or both teams."
    };
  }

  const game = currentScheduleGame(schedule, event, season, away, home);
  const awayPower = teamPower(awaySnapshot, baseline);
  const homePower = teamPower(homeSnapshot, baseline);
  const neutral = String(game?.location || "").toLowerCase() === "neutral";
  const homeField = neutral ? 0 : 2.0;
  const restDiff = clamp(
    (number(game?.home_rest) ?? 7) - (number(game?.away_rest) ?? 7),
    -4,
    4
  );
  const restAdjustment = restDiff * 0.16;

  const independentHomeMargin =
    homeField +
    2.55 * (homePower.composite - awayPower.composite) +
    restAdjustment;

  const leaguePoints = baseline.pointsFor.mean || 22.5;
  const homeExpected =
    leaguePoints +
    0.48 * ((homeSnapshot.pointsFor ?? leaguePoints) - leaguePoints) +
    0.42 * ((awaySnapshot.pointsAgainst ?? leaguePoints) - leaguePoints) +
    1.2 * homePower.components.offenseEpa -
    0.9 * awayPower.components.defenseEpa;
  const awayExpected =
    leaguePoints +
    0.48 * ((awaySnapshot.pointsFor ?? leaguePoints) - leaguePoints) +
    0.42 * ((homeSnapshot.pointsAgainst ?? leaguePoints) - leaguePoints) +
    1.2 * awayPower.components.offenseEpa -
    0.9 * homePower.components.defenseEpa;
  const independentTotal = clamp(homeExpected + awayExpected, 30, 62);

  const homeSpreadMarket = event?.markets?.spread?.home;
  const totalOverMarket = event?.markets?.total?.over;
  const marketHomeSpread = number(homeSpreadMarket?.consensus?.line);
  const marketTotal = number(totalOverMarket?.consensus?.line);
  const marketHomeMargin = marketHomeSpread === null
    ? null
    : -marketHomeSpread;

  const maturityGames = Math.min(
    homeSnapshot.currentSeasonGames,
    awaySnapshot.currentSeasonGames
  );
  const independentWeight = clamp(0.25 + 0.03 * maturityGames, 0.25, 0.50);
  const marketWeight = 1 - independentWeight;

  const projectedHomeMargin = marketHomeMargin === null
    ? independentHomeMargin
    : marketWeight * marketHomeMargin +
      independentWeight * independentHomeMargin;
  const projectedTotal = marketTotal === null
    ? independentTotal
    : marketWeight * marketTotal +
      independentWeight * independentTotal;

  const simulation = simulateGame({
    eventId: event.eventID,
    projectedHomeMargin,
    projectedTotal,
    homeSpread: marketHomeSpread,
    totalLine: marketTotal
  });

  const quality = dataQuality(
    homeSnapshot,
    awaySnapshot,
    game,
    event
  );

  const markets = [];
  const homeMl = event?.markets?.moneyline?.home;
  const awayMl = event?.markets?.moneyline?.away;
  if (homeMl && awayMl) {
    markets.push(candidate({
      eventId: event.eventID,
      marketType: "moneyline",
      side: "home",
      label: event.matchup.home.name,
      market: homeMl,
      opponentMarket: awayMl,
      modelProbability: simulation.moneyline.home,
      dataQuality: quality
    }));
    markets.push(candidate({
      eventId: event.eventID,
      marketType: "moneyline",
      side: "away",
      label: event.matchup.away.name,
      market: awayMl,
      opponentMarket: homeMl,
      modelProbability: simulation.moneyline.away,
      dataQuality: quality
    }));
  }

  const homeSpread = event?.markets?.spread?.home;
  const awaySpread = event?.markets?.spread?.away;
  if (
    homeSpread &&
    awaySpread &&
    marketHomeSpread !== null
  ) {
    markets.push(candidate({
      eventId: event.eventID,
      marketType: "spread",
      side: "home",
      label: event.matchup.home.name,
      market: homeSpread,
      opponentMarket: awaySpread,
      modelProbability: simulation.spread.home,
      line: marketHomeSpread,
      dataQuality: quality
    }));
    markets.push(candidate({
      eventId: event.eventID,
      marketType: "spread",
      side: "away",
      label: event.matchup.away.name,
      market: awaySpread,
      opponentMarket: homeSpread,
      modelProbability: simulation.spread.away,
      line: -marketHomeSpread,
      dataQuality: quality
    }));
  }

  const overMarket = event?.markets?.total?.over;
  const underMarket = event?.markets?.total?.under;
  if (overMarket && underMarket && marketTotal !== null) {
    markets.push(candidate({
      eventId: event.eventID,
      marketType: "total",
      side: "over",
      label: "Over",
      market: overMarket,
      opponentMarket: underMarket,
      modelProbability: simulation.total.over,
      line: marketTotal,
      dataQuality: quality
    }));
    markets.push(candidate({
      eventId: event.eventID,
      marketType: "total",
      side: "under",
      label: "Under",
      market: underMarket,
      opponentMarket: overMarket,
      modelProbability: simulation.total.under,
      line: marketTotal,
      dataQuality: quality
    }));
  }

  return {
    eventID: event.eventID,
    available: true,
    startsAt: event.startsAt,
    matchup: {
      away: { ...event.matchup.away, nflverse: away },
      home: { ...event.matchup.home, nflverse: home }
    },
    gameContext: {
      season,
      week: number(game?.week),
      neutralSite: neutral,
      awayRest: number(game?.away_rest),
      homeRest: number(game?.home_rest),
      awayQB: game?.away_qb_name || null,
      homeQB: game?.home_qb_name || null,
      roof: game?.roof || null,
      surface: game?.surface || null,
      stadium: game?.stadium || null
    },
    model: {
      version: "NFL Team Markets v1-shadow",
      productionEligible: false,
      independentWeight,
      marketWeight,
      projectedHomeMargin: Number(projectedHomeMargin.toFixed(3)),
      projectedTotal: Number(projectedTotal.toFixed(3)),
      independentHomeMargin: Number(independentHomeMargin.toFixed(3)),
      independentTotal: Number(independentTotal.toFixed(3)),
      dataQuality: Number(quality.toFixed(3))
    },
    simulation,
    teamFeatures: {
      away: {
        ...awaySnapshot,
        power: awayPower
      },
      home: {
        ...homeSnapshot,
        power: homePower
      }
    },
    markets: markets.sort((a, b) =>
      (b.evPct ?? -999) - (a.evPct ?? -999)
    )
  };
}

async function loadNflData(season) {
  const [gamesText, currentStatsText, previousStatsText] =
    await Promise.all([
      fetchTextCached(NFLVERSE_GAMES_URL),
      fetchTextCached(NFLVERSE_STATS_URL(season)),
      fetchTextCached(NFLVERSE_STATS_URL(season - 1))
    ]);
  return {
    schedule: parseCsv(gamesText),
    stats: [
      ...parseCsv(previousStatsText),
      ...parseCsv(currentStatsText)
    ]
  };
}

export {
  NFLVERSE_GAMES_URL,
  NFLVERSE_STATS_URL,
  normalizeTeam,
  parseCsv,
  seasonForDate,
  loadNflData,
  projectEvent,
  teamSnapshot,
  leagueBaselines,
  simulateGame
};
