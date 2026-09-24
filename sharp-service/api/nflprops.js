import {
  leagueBaselines,
  loadNflData,
  loadWeatherContext,
  normalizeTeam,
  seasonForDate,
  teamSnapshot
} from "../lib/nfl-model.js";
import {
  PLAYER_PROP_VERSION,
  findPlayerIdentity,
  gradePropMarket,
  loadNflPlayerData,
  projectPlayerOpportunity
} from "../lib/nfl-player-props.js";
import {
  optimizeSportsGameOddsObjectLimit,
  protectedSportsGameOddsFetch
} from "../lib/provider-protection.js";
import { adaptiveRefreshPolicy } from "../lib/adaptive-refresh.js";

const DEFAULT_BOOKS = [
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars"
];

const PLAYER_MARKETS = [
  "passing_yards",
  "passing_touchdowns",
  "rushing_yards",
  "receiving_receptions",
  "receiving_yards"
];

const PROP_PATTERNS = PLAYER_MARKETS.flatMap((stat) => [
  `${stat}-PLAYER_ID-game-ou-over`,
  `${stat}-PLAYER_ID-game-ou-under`
]);

const ENVIRONMENT_PATTERNS = [
  "points-home-game-sp-home",
  "points-away-game-sp-away",
  "points-all-game-ou-over",
  "points-all-game-ou-under"
];

const STALE_TTL_MS = 5 * 60 * 1000;

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace("+", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function csv(value, fallback = []) {
  if (!value) return fallback;
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function playerNameFromOdd(odd = {}) {
  const explicit =
    odd.playerName ||
    odd.statEntityName ||
    odd.entityName ||
    odd.participantName;
  if (explicit) return String(explicit);

  let name = String(odd.marketName || "");
  name = name
    .replace(/\s+Passing\s+Yards\s+Over\/Under.*$/i, "")
    .replace(/\s+Passing\s+Touchdowns\s+Over\/Under.*$/i, "")
    .replace(/\s+Rushing\s+Yards\s+Over\/Under.*$/i, "")
    .replace(/\s+Receiving\s+Receptions\s+Over\/Under.*$/i, "")
    .replace(/\s+Receiving\s+Yards\s+Over\/Under.*$/i, "")
    .trim();
  if (name) return name;

  return String(odd.playerID || odd.statEntityID || "")
    .replace(/_\d+_NFL$/i, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function compactBooks(byBookmaker = {}) {
  const out = {};
  for (const [book, price] of Object.entries(byBookmaker || {})) {
    if (!price) continue;
    out[book] = {
      odds: num(price.odds),
      line: num(price.overUnder),
      available: price.available ?? null,
      openOdds: num(price.openOdds),
      openLine: num(price.openOverUnder),
      closeOdds: num(price.closeOdds),
      closeLine: num(price.closeOverUnder),
      updatedAt: price.lastUpdatedAt ?? null
    };
  }
  return out;
}

function marketSide(odd = {}) {
  return {
    oddID: odd.oddID ?? null,
    side: odd.sideID ?? null,
    consensus: {
      odds: num(odd.bookOdds),
      fairOdds: num(odd.fairOdds),
      line: num(odd.bookOverUnder ?? odd.bookSpread),
      fairLine: num(odd.fairOverUnder ?? odd.fairSpread)
    },
    books: compactBooks(odd.byBookmaker)
  };
}

function summarizeProviderEvent(event) {
  const props = new Map();
  const markets = {
    spread: { away: null, home: null },
    total: { over: null, under: null }
  };

  for (const odd of Object.values(event.odds || {})) {
    if (!odd) continue;

    if (PLAYER_MARKETS.includes(odd.statID)) {
      const playerID = odd.playerID || odd.statEntityID || null;
      const providerPlayer =
        (playerID && event.players?.[playerID]) || null;
      const homeTeamID = event.teams?.home?.teamID ?? null;
      const awayTeamID = event.teams?.away?.teamID ?? null;
      const providerTeamID = providerPlayer?.teamID ?? null;
      const teamSide =
        providerTeamID && providerTeamID === homeTeamID
          ? "home"
          : providerTeamID && providerTeamID === awayTeamID
            ? "away"
            : null;
      const key = `${odd.statID}|${playerID || playerNameFromOdd(odd)}`;
      if (!props.has(key)) {
        props.set(key, {
          statID: odd.statID,
          playerID,
          playerName:
            providerPlayer?.name ||
            [providerPlayer?.firstName, providerPlayer?.lastName]
              .filter(Boolean)
              .join(" ") ||
            playerNameFromOdd(odd),
          playerPosition: providerPlayer?.position ?? null,
          providerTeamID,
          teamSide,
          marketName: odd.marketName ?? null,
          over: null,
          under: null
        });
      }
      if (odd.sideID === "over" || odd.sideID === "under") {
        props.get(key)[odd.sideID] = marketSide(odd);
      }
      continue;
    }

    if (odd.statID !== "points") continue;
    if (odd.betTypeID === "sp") {
      if (odd.sideID === "home") markets.spread.home = marketSide(odd);
      if (odd.sideID === "away") markets.spread.away = marketSide(odd);
    }
    if (odd.betTypeID === "ou") {
      if (odd.sideID === "over") markets.total.over = marketSide(odd);
      if (odd.sideID === "under") markets.total.under = marketSide(odd);
    }
  }

  return {
    eventID: event.eventID,
    sport: event.sportID ?? "FOOTBALL",
    league: event.leagueID ?? "NFL",
    startsAt: event.status?.startsAt ?? null,
    status: {
      started: event.status?.started ?? false,
      live: event.status?.live ?? false,
      completed: event.status?.completed ?? false,
      finalized: event.status?.finalized ?? false,
      display: event.status?.displayShort ?? null
    },
    matchup: {
      away: {
        id: event.teams?.away?.teamID ?? null,
        name:
          event.teams?.away?.names?.long ??
          event.teams?.away?.names?.medium ??
          null,
        short:
          event.teams?.away?.names?.short ??
          event.teams?.away?.names?.medium ??
          null
      },
      home: {
        id: event.teams?.home?.teamID ?? null,
        name:
          event.teams?.home?.names?.long ??
          event.teams?.home?.names?.medium ??
          null,
        short:
          event.teams?.home?.names?.short ??
          event.teams?.home?.names?.medium ??
          null
      }
    },
    markets,
    props: [...props.values()].filter((prop) => prop.over || prop.under)
  };
}

function dateWindow(query) {
  const startsAfter = query.startsAfter
    ? String(query.startsAfter)
    : new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const startsBefore = query.startsBefore
    ? String(query.startsBefore)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return { startsAfter, startsBefore };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  const apiKey = process.env.SPORTS_ODDS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "SPORTS_ODDS_API_KEY missing",
      version: PLAYER_PROP_VERSION,
      productionEligible: false
    });
  }

  try {
    const season = Number(req.query.season) || seasonForDate(new Date());
    const books = [...new Set(csv(req.query.books, DEFAULT_BOOKS))].sort();
    const { startsAfter, startsBefore } = dateWindow(req.query);
    const requestedLimit = Math.max(
      1,
      Math.min(100, Number(req.query.limit || 20) || 20)
    );

    const objectPolicy = await optimizeSportsGameOddsObjectLimit({
      apiKey,
      requestedLimit,
      defaultLimit: 20,
      priority: "critical"
    });
    const refreshPolicy = adaptiveRefreshPolicy({
      startsBefore: req.query.startsBefore ? startsBefore : null,
      priority: "critical",
      now: Date.now()
    });

    const params = new URLSearchParams({
      leagueID: "NFL",
      oddIDs: [...PROP_PATTERNS, ...ENVIRONMENT_PATTERNS].join(","),
      bookmakerID: books.join(","),
      oddsAvailable: "true",
      includeOpenCloseOdds: "true",
      includeAltLines: "true",
      includeOpposingOdds: "true",
      finalized: "false",
      type: "match",
      startsAfter,
      startsBefore,
      limit: String(Math.max(1, objectPolicy.effectiveLimit || 1))
    });

    const providerUrl =
      `https://api.sportsgameodds.com/v2/events?${params.toString()}`;

    const [provider, nflData, playerData] = await Promise.all([
      protectedSportsGameOddsFetch({
        url: providerUrl,
        apiKey,
        freshMs: refreshPolicy.freshMs,
        staleMs: Math.max(STALE_TTL_MS, refreshPolicy.staleMs),
        timeoutMs: 8_000,
        consumer: "nfl-player-props",
        priority: "critical",
        objectPolicy
      }),
      loadNflData(season),
      loadNflPlayerData(season)
    ]);

    const events = (provider.payload?.data || [])
      .map(summarizeProviderEvent)
      .filter((event) => event.league === "NFL" && event.props.length > 0);

    const teams = new Set();
    for (const event of events) {
      for (const side of ["home", "away"]) {
        const team = normalizeTeam(
          event?.matchup?.[side]?.name || event?.matchup?.[side]?.short
        );
        if (team) teams.add(team);
      }
    }
    for (const row of nflData.stats || []) {
      if ([season, season - 1].includes(Number(row.season)) && row.team) {
        teams.add(row.team);
      }
    }

    const snapshots = new Map();
    for (const team of teams) {
      snapshots.set(
        team,
        teamSnapshot(
          nflData.schedule,
          nflData.stats,
          season,
          team
        )
      );
    }
    const baseline = leagueBaselines([...snapshots.values()]);

    const eventResults = [];
    const candidates = [];

    for (const event of events) {
      const homeTeam = normalizeTeam(
        event?.matchup?.home?.name || event?.matchup?.home?.short
      );
      const weatherContext = homeTeam
        ? await loadWeatherContext({
            event,
            schedule: nflData.schedule,
            season,
            homeTeam
          })
        : null;

      const playerResults = [];
      for (const prop of event.props) {
        const eventTeams = [
          normalizeTeam(
            event?.matchup?.home?.name || event?.matchup?.home?.short
          ),
          normalizeTeam(
            event?.matchup?.away?.name || event?.matchup?.away?.short
          )
        ].filter(Boolean);
        const identity = findPlayerIdentity(
          playerData.playerStats,
          prop.playerName,
          eventTeams
        );
        const effectiveTeam =
          prop.teamSide === "home"
            ? normalizeTeam(
                event?.matchup?.home?.name ||
                event?.matchup?.home?.short
              )
            : prop.teamSide === "away"
              ? normalizeTeam(
                  event?.matchup?.away?.name ||
                  event?.matchup?.away?.short
                )
              : identity.team;
        const opponent = eventTeams.find(
          (team) => team !== effectiveTeam
        );
        const providerTeam =
          prop.teamSide === "home"
            ? eventTeams.find((team) =>
                team === normalizeTeam(
                  event?.matchup?.home?.name ||
                  event?.matchup?.home?.short
                )
              )
            : prop.teamSide === "away"
              ? eventTeams.find((team) =>
                  team === normalizeTeam(
                    event?.matchup?.away?.name ||
                    event?.matchup?.away?.short
                  )
                )
              : null;
        const opportunity = projectPlayerOpportunity({
          playerName: prop.playerName,
          preferredTeam: providerTeam,
          preferredPosition: prop.playerPosition,
          event,
          schedule: nflData.schedule,
          season,
          playerStats: playerData.playerStats,
          snapCounts: playerData.snapCounts,
          ngs: playerData.ngs,
          depthCharts: nflData.depthCharts,
          weatherContext,
          opponentSnapshot: opponent ? snapshots.get(opponent) : null
        });

        const graded = gradePropMarket(prop, opportunity);
        candidates.push(
          ...graded.map((candidate) => ({
            eventID: event.eventID,
            startsAt: event.startsAt,
            away: event.matchup.away.name,
            home: event.matchup.home.name,
            ...candidate
          }))
        );

        playerResults.push({
          prop,
          opportunity,
          candidates: graded
        });
      }

      eventResults.push({
        eventID: event.eventID,
        startsAt: event.startsAt,
        matchup: event.matchup,
        markets: event.markets,
        weather: weatherContext,
        players: playerResults
      });
    }

    candidates.sort((a, b) => {
      const rank = { PLAY: 0, WATCH: 1, PASS: 2 };
      const statusDiff =
        (rank[a.shadowStatus] ?? 9) - (rank[b.shadowStatus] ?? 9);
      if (statusDiff) return statusDiff;
      return (b.evPct ?? -999) - (a.evPct ?? -999);
    });

    const shadowPlays = candidates.filter(
      (candidate) => candidate.shadowStatus === "PLAY"
    );

    res.setHeader(
      "Cache-Control",
      `public, max-age=0, s-maxage=${refreshPolicy.suggestedSeconds}, stale-while-revalidate=${Math.max(60, refreshPolicy.suggestedSeconds * 3)}`
    );
    res.setHeader("X-NFL-Props-Cache", provider.cacheStatus);
    res.setHeader("X-Provider-Cache-Layer", provider.cacheLayer);

    return res.status(200).json({
      version: PLAYER_PROP_VERSION,
      generatedAt: new Date().toISOString(),
      sport: "FOOTBALL",
      league: "NFL",
      season,
      productionEligible: false,
      productionWeight: 0,
      modelState: "SHADOW_ONLY",
      calibrationState: "UNCALIBRATED_CHALLENGER",
      methodology: {
        marketFirst: true,
        distinctBookLines: true,
        pointInTimeGuard: true,
        projectionFlow:
          "team plays -> pass/rush split -> player role share -> opportunity -> efficiency -> distribution",
        liveSources: [
          "nflverse weekly player stats",
          "PFR snap counts via nflverse",
          "NFL Next Gen Stats via nflverse",
          "timestamped nflverse depth charts",
          "SportsGameOdds sharp/player prop prices",
          "Open-Meteo outdoor forecasts"
        ],
        excludedLiveFeatures: [
          "nflverse participation/route data (postseason-only for 2023+)",
          "nflverse injuries (source unavailable after 2024)"
        ],
        provisionalQualityWeights: {
          A: 0.35,
          B: 0.20,
          C: 0.10,
          D: 0
        },
        calibratedMarketShrinkage: {
          passing_yards: 0,
          passing_touchdowns: 0,
          rushing_yards: 0,
          receiving_receptions: 0,
          receiving_yards: 0
        },
        calibrationFinding:
          "2024 development replay did not justify independent influence over the baseline. All five markets remain market-only in shadow output.",
        promotionPolicy:
          "No production influence until a revised challenger is calibrated on development data and then clears untouched holdout validation against historical sharp prop prices."
      },
      playerMarkets: PLAYER_MARKETS,
      books,
      sourceHealth: {
        ...playerData.sourceHealth,
        teamModel: nflData.sourceHealth,
        provider: {
          status: provider.cacheStatus,
          layer: provider.cacheLayer,
          servedStale: provider.cacheStatus === "STALE"
        }
      },
      leagueBaseline: baseline,
      eventCount: eventResults.length,
      playerMarketCount: eventResults.reduce(
        (sum, event) => sum + event.players.length,
        0
      ),
      candidateCount: candidates.length,
      shadowPlayCount: shadowPlays.length,
      shadowPlays,
      candidates,
      events: eventResults,
      refreshPolicy,
      objectOptimization: {
        ...objectPolicy,
        objectsReturned:
          provider.cacheLayer === "upstream"
            ? provider.objectsReturned || 0
            : 0
      }
    });
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      error: error instanceof Error ? error.message : String(error),
      version: PLAYER_PROP_VERSION,
      productionEligible: false,
      productionWeight: 0,
      modelState: "SHADOW_ONLY"
    });
  }
}
