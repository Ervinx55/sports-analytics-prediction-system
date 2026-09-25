import {
  optimizeSportsGameOddsObjectLimit,
  protectedSportsGameOddsFetch
} from "../lib/provider-protection.js";
import { adaptiveRefreshPolicy } from "../lib/adaptive-refresh.js";
import {
  fetchSharpApiNbaProps
} from "../lib/sharpapi-provider.js";
import {
  fetchTheOddsApiNbaProps,
  getTheOddsApiUsageSnapshot
} from "../lib/the-odds-api-provider.js";
import {
  NBA_PLAYER_PROP_VERSION,
  loadNbaPlayerStats,
  loadNbaInjuries,
  projectPropEvent
} from "../lib/nba-player-props.js";
import {
  loadNbaGames,
  normalizeTeam,
  seasonForDate
} from "../lib/nba-model.js";

const DEFAULT_BOOKS = [
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars"
];

const STALE_TTL_MS = 10 * 60 * 1000;

const SGO_STAT_IDS = Object.freeze({
  points: "points",
  rebounds: "rebounds",
  assists: "assists",
  threePointersMade: "threes_made",
  blocks: "blocks",
  steals: "steals",
  turnovers: "turnovers",
  "blocks+steals": "blocks_steals",
  "points+rebounds+assists":
    "points_rebounds_assists",
  "points+rebounds": "points_rebounds",
  "points+assists": "points_assists",
  "rebounds+assists": "rebounds_assists"
});

const SGO_PROP_PATTERNS = Object.keys(
  SGO_STAT_IDS
).flatMap((statID) => [
  `${statID}-PLAYER_ID-game-ou-over`,
  `${statID}-PLAYER_ID-game-ou-under`
]);

function csv(value, fallback = []) {
  if (!value) return fallback;
  const text = Array.isArray(value)
    ? value[0]
    : value;
  return String(text)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function num(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }
  const parsed = Number(
    String(value).replace("+", "")
  );
  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function compactBooks(byBookmaker = {}) {
  const out = {};
  for (const [book, price] of Object.entries(
    byBookmaker || {}
  )) {
    if (!price) continue;
    out[book] = {
      odds: num(price.odds),
      line: num(price.overUnder),
      openOdds: num(price.openOdds),
      openLine: num(price.openOverUnder),
      closeOdds: num(price.closeOdds),
      closeLine: num(price.closeOverUnder),
      available: price.available ?? null,
      updatedAt:
        price.lastUpdatedAt ?? null
    };
  }
  return out;
}

function playerNameFromOdd(odd = {}) {
  const explicit =
    odd.playerName ||
    odd.statEntityName ||
    odd.entityName ||
    odd.participantName;
  if (explicit) return String(explicit);

  const id =
    odd.playerID ||
    odd.statEntityID ||
    "";
  return String(id)
    .replace(/_\d+_NBA$/i, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) =>
      match.toUpperCase()
    );
}

function summarizeSportsGameOddsEvent(event) {
  const groups = new Map();

  for (const odd of Object.values(
    event?.odds || {}
  )) {
    const statID =
      SGO_STAT_IDS[String(odd?.statID || "")];
    if (!statID) continue;

    const side = String(
      odd?.sideID || ""
    ).toLowerCase();
    if (!["over", "under"].includes(side)) {
      continue;
    }

    const playerID =
      odd?.playerID ||
      odd?.statEntityID ||
      null;
    const name = playerNameFromOdd(odd);
    if (!name) continue;

    const key = [
      statID,
      playerID || name.toLowerCase()
    ].join("|");

    if (!groups.has(key)) {
      groups.set(key, {
        statID,
        playerID,
        playerName: name,
        marketName:
          odd?.marketName || statID,
        over: null,
        under: null
      });
    }

    groups.get(key)[side] = {
      oddID: odd?.oddID || null,
      side,
      consensus: {
        odds: num(odd?.bookOdds),
        fairOdds: num(odd?.fairOdds),
        line: num(odd?.bookOverUnder),
        fairLine: num(odd?.fairOverUnder)
      },
      books: compactBooks(
        odd?.byBookmaker || {}
      )
    };
  }

  const away = event?.teams?.away || {};
  const home = event?.teams?.home || {};

  return {
    eventID: event?.eventID || null,
    providerEventID:
      event?.eventID || null,
    provider: "SportsGameOdds",
    sport: event?.sportID || "BASKETBALL",
    league: event?.leagueID || "NBA",
    startsAt:
      event?.status?.startsAt || null,
    status: {
      started:
        event?.status?.started ?? false,
      live:
        event?.status?.live ?? false,
      completed:
        event?.status?.completed ?? false,
      finalized:
        event?.status?.finalized ?? false,
      display:
        event?.status?.displayShort ?? null
    },
    matchup: {
      away: {
        id: away?.teamID ?? null,
        name:
          away?.names?.long ??
          away?.names?.medium ??
          null
      },
      home: {
        id: home?.teamID ?? null,
        name:
          home?.names?.long ??
          home?.names?.medium ??
          null
      }
    },
    props: [...groups.values()].filter(
      (prop) => prop.over || prop.under
    )
  };
}

function usableEvents(events) {
  return (events || []).filter(
    (event) =>
      Array.isArray(event?.props) &&
      event.props.length > 0
  );
}

async function resolvePropProvider({
  sportsGameOddsKey,
  sharpApiKey,
  theOddsApiKey,
  books,
  startsAfter,
  startsBefore,
  requestedLimit,
  refreshPolicy
}) {
  const failures = [];
  let objectPolicy = {
    requestedLimit,
    effectiveLimit: requestedLimit,
    pressure: "NOT_CONFIGURED",
    source: "provider_disabled",
    blocked: true
  };

  if (sportsGameOddsKey) {
    objectPolicy =
      await optimizeSportsGameOddsObjectLimit({
        apiKey: sportsGameOddsKey,
        requestedLimit,
        defaultLimit: 20,
        priority: "critical"
      });

    const limit = Math.max(
      1,
      objectPolicy.effectiveLimit || 1
    );
    const params = new URLSearchParams({
      leagueID: "NBA",
      oddIDs:
        SGO_PROP_PATTERNS.join(","),
      oddsAvailable: "true",
      includeOpenCloseOdds: "true",
      includeAltLines: "true",
      finalized: "false",
      type: "match",
      limit: String(limit)
    });
    if (books.length) {
      params.set(
        "bookmakerID",
        books.join(",")
      );
    }
    params.set(
      "startsAfter",
      startsAfter
    );
    params.set(
      "startsBefore",
      startsBefore
    );

    try {
      const result =
        await protectedSportsGameOddsFetch({
          url:
            "https://api.sportsgameodds.com/v2/events?" +
            params.toString(),
          apiKey: sportsGameOddsKey,
          freshMs:
            refreshPolicy.freshMs,
          staleMs: Math.max(
            STALE_TTL_MS,
            refreshPolicy.staleMs
          ),
          timeoutMs: 8_000,
          consumer: "nba-player-props",
          priority: "critical",
          objectPolicy
        });

      const events = usableEvents(
        (result.payload?.data || []).map(
          summarizeSportsGameOddsEvent
        )
      );
      if (events.length) {
        return {
          source: "SportsGameOdds",
          events,
          fetchedAt:
            new Date(
              result.fetchedAt
            ).toISOString(),
          cache: {
            status:
              result.cacheStatus,
            layer:
              result.cacheLayer,
            servedStale:
              result.cacheStatus === "STALE"
          },
          objectPolicy,
          failures
        };
      }

      failures.push({
        provider: "SportsGameOdds",
        status: 204,
        error:
          "No usable NBA player props returned"
      });
    } catch (error) {
      failures.push({
        provider: "SportsGameOdds",
        status:
          Number(error?.status || 502),
        error:
          error instanceof Error
            ? error.message
            : String(error),
        objectBudgetBlocked:
          Boolean(
            error?.objectBudgetBlocked
          )
      });
    }
  }

  if (sharpApiKey) {
    try {
      const result =
        await fetchSharpApiNbaProps({
          apiKey: sharpApiKey,
          books,
          startsAfter,
          startsBefore,
          freshMs: Math.max(
            60_000,
            refreshPolicy.freshMs
          ),
          staleMs: Math.max(
            STALE_TTL_MS,
            refreshPolicy.staleMs
          )
        });
      const events =
        usableEvents(result.events);
      if (events.length) {
        return {
          source: "SharpAPI",
          events,
          fetchedAt: result.fetchedAt,
          cache: result.cache,
          objectPolicy,
          failures
        };
      }
      failures.push({
        provider: "SharpAPI",
        status: 204,
        error:
          "No usable NBA player props returned"
      });
    } catch (error) {
      failures.push({
        provider: "SharpAPI",
        status:
          Number(error?.status || 502),
        error:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }

  if (theOddsApiKey) {
    try {
      const result =
        await fetchTheOddsApiNbaProps({
          apiKey: theOddsApiKey,
          books,
          startsAfter,
          startsBefore,
          freshMs: Math.max(
            10 * 60 * 1000,
            refreshPolicy.freshMs
          ),
          staleMs: Math.max(
            20 * 60 * 1000,
            refreshPolicy.staleMs
          )
        });
      const events =
        usableEvents(result.events);
      if (events.length) {
        return {
          source: "The Odds API",
          events,
          fetchedAt: result.fetchedAt,
          cache: result.cache,
          usage: result.usage,
          objectPolicy,
          failures
        };
      }
      failures.push({
        provider: "The Odds API",
        status: 204,
        error:
          "No usable NBA player props returned"
      });
    } catch (error) {
      failures.push({
        provider: "The Odds API",
        status:
          Number(error?.status || 502),
        error:
          error instanceof Error
            ? error.message
            : String(error),
        quotaBlocked:
          Boolean(error?.quotaBlocked)
      });
    }
  }

  const error = new Error(
    "No configured provider returned usable NBA player props"
  );
  error.status =
    failures.some(
      (row) => row.status === 429
    )
      ? 429
      : 502;
  error.providerFailures = failures;
  error.objectPolicy = objectPolicy;
  throw error;
}

function relevantHistoryIds(
  events,
  games,
  startsBefore
) {
  const teams = new Set();
  for (const event of events || []) {
    const away = normalizeTeam(
      event?.matchup?.away?.name
    );
    const home = normalizeTeam(
      event?.matchup?.home?.name
    );
    if (away) teams.add(away);
    if (home) teams.add(home);
  }

  const cutoff = Date.parse(
    startsBefore || ""
  );
  const relevant = (games || [])
    .filter((game) => {
      const at = Date.parse(
        game?.datetime ||
        (game?.date
          ? `${game.date}T23:59:59Z`
          : "")
      );
      if (
        Number.isFinite(cutoff) &&
        Number.isFinite(at) &&
        at >= cutoff
      ) {
        return false;
      }
      const away = normalizeTeam(
        game?.visitor_team?.abbreviation ||
        game?.visitor_team?.full_name
      );
      const home = normalizeTeam(
        game?.home_team?.abbreviation ||
        game?.home_team?.full_name
      );
      return (
        teams.has(away) ||
        teams.has(home)
      );
    })
    .sort((a, b) =>
      Date.parse(
        b?.datetime ||
        `${b?.date}T23:59:59Z`
      ) -
      Date.parse(
        a?.datetime ||
        `${a?.date}T23:59:59Z`
      )
    );

  const gameIds = [];
  const teamIds = new Set();
  const seenGames = new Set();

  for (const game of relevant) {
    if (
      game?.id != null &&
      !seenGames.has(game.id)
    ) {
      seenGames.add(game.id);
      gameIds.push(game.id);
    }
    if (game?.home_team?.id != null) {
      teamIds.add(game.home_team.id);
    }
    if (
      game?.visitor_team?.id != null
    ) {
      teamIds.add(
        game.visitor_team.id
      );
    }
    if (gameIds.length >= 40) break;
  }

  return {
    gameIds,
    teamIds: [...teamIds]
  };
}

function defaultWindow(query) {
  const now = Date.now();
  return {
    startsAfter:
      query.startsAfter
        ? String(query.startsAfter)
        : new Date(
            now - 60 * 60 * 1000
          ).toISOString(),
    startsBefore:
      query.startsBefore
        ? String(query.startsBefore)
        : new Date(
            now +
              7 * 24 * 60 * 60 * 1000
          ).toISOString()
  };
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res
      .status(405)
      .json({ error: "GET only" });
  }

  const sportsGameOddsKey =
    process.env.SPORTS_ODDS_API_KEY;
  const sharpApiKey =
    process.env.SHARPAPI_KEY;
  const theOddsApiKey =
    process.env.THE_ODDS_API_KEY;
  const bdlKey =
    process.env.BALLDONTLIE_API_KEY;

  if (
    !sportsGameOddsKey &&
    !sharpApiKey &&
    !theOddsApiKey
  ) {
    return res.status(500).json({
      error:
        "No NBA player-prop odds provider is configured",
      version:
        NBA_PLAYER_PROP_VERSION,
      productionEligible: false
    });
  }

  const books = [
    ...new Set(
      csv(req.query.books, DEFAULT_BOOKS)
    )
  ].sort();
  const {
    startsAfter,
    startsBefore
  } = defaultWindow(req.query);
  const season =
    Number(req.query.season) ||
    seasonForDate(
      new Date(startsAfter)
    );
  const requestedLimit = Math.max(
    1,
    Math.min(
      40,
      Number(req.query.limit || 20)
    )
  );
  const refreshPolicy =
    adaptiveRefreshPolicy({
      startsBefore:
        req.query.startsBefore
          ? startsBefore
          : null,
      priority: "critical",
      now: Date.now()
    });

  try {
    const provider =
      await resolvePropProvider({
        sportsGameOddsKey,
        sharpApiKey,
        theOddsApiKey,
        books,
        startsAfter,
        startsBefore,
        requestedLimit,
        refreshPolicy
      });

    const nbaGames = await loadNbaGames({
      season,
      targetAt: startsBefore,
      lookbackDays: 30
    });

    const ids = relevantHistoryIds(
      provider.events,
      nbaGames.games,
      startsBefore
    );

    const [
      stats,
      injuries
    ] = await Promise.all([
      loadNbaPlayerStats({
        apiKey: bdlKey,
        gameIds: ids.gameIds
      }),
      loadNbaInjuries({
        apiKey: bdlKey,
        teamIds: ids.teamIds
      })
    ]);

    const eventModels =
      provider.events.map(
        (event) =>
          projectPropEvent({
            event,
            statsRows: stats.rows,
            injuries: injuries.rows
          })
      );

    const candidates = eventModels
      .flatMap(
        (event) => event.candidates
      )
      .sort((a, b) => {
        if (
          a.shadowStatus !==
          b.shadowStatus
        ) {
          return a.shadowStatus ===
            "PLAY"
            ? -1
            : 1;
        }
        return (
          (b.evPct ?? -999) -
          (a.evPct ?? -999)
        );
      });

    const shadowPlays =
      candidates.filter(
        (row) =>
          row.shadowStatus === "PLAY"
      );

    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=300, stale-while-revalidate=600, stale-if-error=1200"
    );
    res.setHeader(
      "X-Odds-Provider",
      provider.source
    );

    return res.status(200).json({
      version:
        NBA_PLAYER_PROP_VERSION,
      generatedAt:
        new Date().toISOString(),
      sport: "BASKETBALL",
      league: "NBA",
      season,
      productionEligible: false,
      productionWeight: 0,
      modelState: "SHADOW_ONLY",
      calibrationState:
        "UNCALIBRATED_CHALLENGER",
      oddsProvider:
        provider.source,
      providerChain: [
        "SportsGameOdds",
        "SharpAPI",
        "The Odds API"
      ],
      providerFailures:
        provider.failures || [],
      methodology: {
        exactBookLineGrading: true,
        sameBookNoVig: true,
        projectionFlow:
          "recent minutes + per-minute production + rolling direct production -> stat distribution -> exact book/line probability",
        comboProps:
          "built from the same underlying game rows for internal consistency",
        injuryPolicy:
          "Official NBA injury report is authoritative. v1 does not infer an official player status from an unparsed report; unresolved official availability blocks shadow PLAY. BALLDONTLIE injuries are secondary context only.",
        historyPolicy:
          "BALLDONTLIE game player stats are optional paid enrichment. If unavailable, live market quotes are returned but the independent projection is unavailable and every candidate remains PASS.",
        validationPolicy:
          "No NBA player-prop production influence until chronological development calibration, untouched holdout validation, and exact historical market-price validation are complete."
      },
      sourceHealth: {
        odds: {
          source:
            provider.source,
          cache:
            provider.cache || null,
          failures:
            provider.failures || [],
          usage:
            provider.usage || null,
          objectPolicy:
            provider.objectPolicy || null
        },
        games:
          nbaGames.sourceHealth?.games ||
          null,
        playerStats:
          stats.sourceHealth,
        injuries: {
          official: {
            status: "UNPARSED",
            source: "NBA Official",
            authority: true,
            reason:
              "Player-level official report extraction is not yet enabled in v1; unresolved status blocks shadow PLAY."
          },
          secondary:
            injuries.sourceHealth
        }
      },
      historyContext: {
        relevantGameIds:
          ids.gameIds.length,
        relevantTeamIds:
          ids.teamIds.length,
        playerStatRows:
          stats.rows.length,
        injuryRows:
          injuries.rows.length
      },
      eventCount:
        eventModels.length,
      playerCount:
        eventModels.reduce(
          (sum, event) =>
            sum +
            (event.playerCount || 0),
          0
        ),
      candidateCount:
        candidates.length,
      shadowPlayCount:
        shadowPlays.length,
      shadowPlays,
      candidates,
      events:
        eventModels
    });
  } catch (error) {
    res.setHeader(
      "Cache-Control",
      "no-store"
    );
    return res
      .status(
        Number(error?.status || 500)
      )
      .json({
        error:
          error instanceof Error
            ? error.message
            : String(error),
        version:
          NBA_PLAYER_PROP_VERSION,
        productionEligible: false,
        productionWeight: 0,
        providerFailures:
          error?.providerFailures || [],
        theOddsApiUsage:
          getTheOddsApiUsageSnapshot()
      });
  }
}
