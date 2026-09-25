import {
  optimizeSportsGameOddsObjectLimit,
  protectedSportsGameOddsFetch
} from "../lib/provider-protection.js";
import { adaptiveRefreshPolicy } from "../lib/adaptive-refresh.js";
import {
  fetchSharpApiMlbProps
} from "../lib/sharpapi-provider.js";
import {
  fetchTheOddsApiMlbProps,
  getTheOddsApiUsageSnapshot
} from "../lib/the-odds-api-provider.js";

const DEFAULT_BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];

const PROP_PATTERNS = [
  "pitching_strikeouts-PLAYER_ID-game-ou-over",
  "pitching_strikeouts-PLAYER_ID-game-ou-under",
  "batting_hits-PLAYER_ID-game-ou-over",
  "batting_hits-PLAYER_ID-game-ou-under",
  "batting_totalBases-PLAYER_ID-game-ou-over",
  "batting_totalBases-PLAYER_ID-game-ou-under"
];

const STALE_TTL_MS = 5 * 60 * 1000;

function csv(value, fallback = []) {
  if (!value) return fallback;
  const text = Array.isArray(value) ? value[0] : value;
  return String(text)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function num(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

function compactBooks(byBookmaker = {}) {
  const out = {};
  for (const [book, p] of Object.entries(byBookmaker || {})) {
    if (!p) continue;
    out[book] = {
      odds: num(p.odds),
      line: num(p.overUnder),
      openOdds: num(p.openOdds),
      openLine: num(p.openOverUnder),
      closeOdds: num(p.closeOdds),
      closeLine: num(p.closeOverUnder),
      available: p.available ?? null,
      updatedAt: p.lastUpdatedAt ?? null
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

  let name = String(odd.marketName || "");
  name = name
    .replace(/\s+(Pitcher\s+)?Strikeouts\s+Over\/Under.*$/i, "")
    .replace(/\s+Hits\s+Over\/Under.*$/i, "")
    .replace(/\s+Total\s+Bases\s+Over\/Under.*$/i, "")
    .trim();
  if (name) return name;

  return String(odd.playerID || odd.statEntityID || "")
    .replace(/_\d+_MLB$/i, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function marketKey(odd = {}) {
  return [
    odd.statID || "",
    odd.playerID || odd.statEntityID || ""
  ].join("|");
}

function summarizeEvent(event) {
  const groups = new Map();
  for (const odd of Object.values(event.odds || {})) {
    if (!odd || !PROP_PATTERNS.some((p) => {
      const stat = p.split("-PLAYER_ID-")[0];
      return odd.statID === stat;
    })) continue;

    const key = marketKey(odd);
    if (!groups.has(key)) {
      groups.set(key, {
        statID: odd.statID ?? null,
        playerID: odd.playerID ?? odd.statEntityID ?? null,
        playerName: playerNameFromOdd(odd),
        marketName: odd.marketName ?? null,
        over: null,
        under: null
      });
    }

    const row = groups.get(key);
    const side = odd.sideID;
    if (side !== "over" && side !== "under") continue;
    row[side] = {
      oddID: odd.oddID ?? null,
      side,
      consensus: {
        odds: num(odd.bookOdds),
        fairOdds: num(odd.fairOdds),
        line: num(odd.bookOverUnder),
        fairLine: num(odd.fairOverUnder)
      },
      books: compactBooks(odd.byBookmaker)
    };
  }

  return {
    eventID: event.eventID,
    sport: event.sportID ?? null,
    league: event.leagueID ?? null,
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
          null
      },
      home: {
        id: event.teams?.home?.teamID ?? null,
        name:
          event.teams?.home?.names?.long ??
          event.teams?.home?.names?.medium ??
          null
      }
    },
    props: [...groups.values()]
  };
}

function buildBody({
  payload,
  books,
  startsAfter,
  startsBefore,
  providerFetchedAt
}) {
  const events = (payload?.data || [])
    .map(summarizeEvent)
    .filter((e) => e.props.length > 0);

  return {
    fetchedAt: new Date(providerFetchedAt).toISOString(),
    version: "MLB Props Board v1.2",
    source: "SportsGameOdds v2",
    books,
    markets: [
      "pitching_strikeouts",
      "batting_hits",
      "batting_totalBases"
    ],
    window: {
      startsAfter: startsAfter || null,
      startsBefore: startsBefore || null
    },
    providerNotice: payload?.notice ?? null,
    eventCount: events.length,
    propCount: events.reduce((n, e) => n + e.props.length, 0),
    events
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  const apiKey = process.env.SPORTS_ODDS_API_KEY;
  const sharpApiKey = process.env.SHARPAPI_KEY;
  const theOddsApiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey && !sharpApiKey && !theOddsApiKey) {
    return res.status(500).json({
      error:
        "No odds provider configured. Set SPORTS_ODDS_API_KEY, SHARPAPI_KEY, or THE_ODDS_API_KEY."
    });
  }

  const books = [...new Set(csv(req.query.books, DEFAULT_BOOKS))].sort();
  const now = Date.now();
  const windowAnchor =
    Math.floor(now / (6 * 60 * 60 * 1000)) *
    (6 * 60 * 60 * 1000);
  const limitRaw = Number(req.query.limit || 20);
  const requestedLimit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(100, limitRaw))
    : 20;
  const startsAfter = req.query.startsAfter
    ? String(req.query.startsAfter)
    : new Date(windowAnchor - 8 * 60 * 60 * 1000).toISOString();
  const startsBefore = req.query.startsBefore
    ? String(req.query.startsBefore)
    : new Date(windowAnchor + 36 * 60 * 60 * 1000).toISOString();
  const objectPolicy = apiKey
    ? await optimizeSportsGameOddsObjectLimit({
        apiKey,
        requestedLimit,
        defaultLimit: 20,
        priority: "critical"
      })
    : {
        requestedLimit,
        effectiveLimit: requestedLimit,
        projectedMaxObjects: 0,
        priority: "critical",
        pressure: "NOT_CONFIGURED",
        source: "provider_disabled",
        blocked: true
      };
  const refreshPolicy = adaptiveRefreshPolicy({
    startsBefore: req.query.startsBefore ? startsBefore : null,
    priority: "critical",
    now
  });
  const limit = Math.max(1, objectPolicy.effectiveLimit || 1);

  const params = new URLSearchParams({
    leagueID: "MLB",
    oddIDs: PROP_PATTERNS.join(","),
    oddsAvailable: "true",
    includeOpenCloseOdds: "true",
    includeAltLines: "true",
    finalized: "false",
    type: "match",
    limit: String(limit)
  });
  if (books.length) params.set("bookmakerID", books.join(","));
  if (startsAfter) params.set("startsAfter", startsAfter);
  if (startsBefore) params.set("startsBefore", startsBefore);

  const url = `https://api.sportsgameodds.com/v2/events?${params.toString()}`;

  try {
    if (!apiKey) {
      const error = new Error("SportsGameOdds is not configured");
      error.status = 503;
      throw error;
    }

    const result = await protectedSportsGameOddsFetch({
      url,
      apiKey,
      freshMs: refreshPolicy.freshMs,
      staleMs: Math.max(STALE_TTL_MS, refreshPolicy.staleMs),
      timeoutMs: 8_000,
      consumer: "props",
      priority: "critical",
      objectPolicy
    });

    const body = buildBody({
      payload: result.payload,
      books,
      startsAfter,
      startsBefore,
      providerFetchedAt: result.fetchedAt
    });

    res.setHeader(
      "Cache-Control",
      `public, max-age=0, s-maxage=${refreshPolicy.suggestedSeconds}, stale-while-revalidate=${Math.max(60, refreshPolicy.suggestedSeconds * 3)}, stale-if-error=300`
    );
    res.setHeader(
      "CDN-Cache-Control",
      `public, max-age=${refreshPolicy.suggestedSeconds}, stale-while-revalidate=${Math.max(60, refreshPolicy.suggestedSeconds * 3)}, stale-if-error=300`
    );
    res.setHeader("Vercel-Cache-Tag", "edge-lab-props");
    res.setHeader("X-Props-Cache", result.cacheStatus);
    res.setHeader("X-Provider-Cache-Layer", result.cacheLayer);
    res.setHeader(
      "X-Provider-Budget",
      result.budget?.claimed ? "CLAIMED" : "CACHE"
    );

    return res.status(200).json({
      ...body,
      cache: {
        status: result.cacheStatus,
        layer: result.cacheLayer,
        sharedEnabled: result.sharedEnabled,
        ageSeconds: Number((result.ageMs / 1000).toFixed(1)),
        freshForSeconds: refreshPolicy.suggestedSeconds,
        staleForSeconds:
          Math.max(STALE_TTL_MS, refreshPolicy.staleMs) / 1000
      },
      servedStale: result.cacheStatus === "STALE",
      circuitOpen: result.circuitOpen,
      recoveryState: result.recoveryState || "CLOSED",
      requestBudget: result.budget || null,
      refreshPolicy,
      objectOptimization: {
        ...objectPolicy,
        objectsReturned:
          result.cacheLayer === "upstream"
            ? result.objectsReturned || 0
            : 0
      },
      upstreamError: result.upstreamError
    });
  } catch (error) {
    if (sharpApiKey) {
      try {
        const fallback = await fetchSharpApiMlbProps({
          apiKey: sharpApiKey,
          books,
          startsAfter,
          startsBefore,
          freshMs: Math.max(60_000, refreshPolicy.freshMs),
          staleMs: Math.max(STALE_TTL_MS, refreshPolicy.staleMs)
        });
        const events = fallback.events || [];
        if (!events.length) {
          const noData = new Error(
            "SharpAPI returned no usable MLB prop markets"
          );
          noData.status = 502;
          throw noData;
        }
        const body = {
          fetchedAt: fallback.fetchedAt,
          version: "MLB Props Board v1.3",
          source: "SharpAPI",
          providerChain: [
            "SportsGameOdds",
            "SharpAPI",
            "The Odds API"
          ],
          fallbackFrom: {
            provider: "SportsGameOdds",
            status: Number(error?.status || 502),
            error:
              error instanceof Error
                ? error.message
                : String(error),
            objectBudgetBlocked:
              Boolean(error?.objectBudgetBlocked)
          },
          books,
          markets: [
            "pitching_strikeouts",
            "batting_hits",
            "batting_totalBases"
          ],
          window: {
            startsAfter: startsAfter || null,
            startsBefore: startsBefore || null
          },
          eventCount: events.length,
          propCount: events.reduce(
            (sum, event) => sum + (event.props?.length || 0),
            0
          ),
          events,
          cache: {
            status: fallback.cache?.status || "MISS",
            layer: fallback.cache?.layer || "upstream",
            ageSeconds: fallback.cache?.ageSeconds ?? 0,
            freshForSeconds: refreshPolicy.suggestedSeconds,
            staleForSeconds:
              Math.max(STALE_TTL_MS, refreshPolicy.staleMs) / 1000
          },
          servedStale:
            Boolean(fallback.cache?.servedStale),
          circuitOpen: false,
          recoveryState: "FALLBACK",
          requestBudget: null,
          refreshPolicy,
          objectOptimization: {
            ...objectPolicy,
            objectsReturned: 0,
            fallbackProvider: "SharpAPI"
          },
          upstreamError:
            fallback.cache?.upstreamError || null
        };

        res.setHeader(
          "Cache-Control",
          `public, max-age=0, s-maxage=${refreshPolicy.suggestedSeconds}, stale-while-revalidate=${Math.max(60, refreshPolicy.suggestedSeconds * 3)}, stale-if-error=300`
        );
        res.setHeader("Vercel-Cache-Tag", "edge-lab-props");
        res.setHeader("X-Props-Cache", body.cache.status);
        res.setHeader("X-Odds-Provider", "SharpAPI");
        return res.status(200).json(body);
      } catch (fallbackError) {
        error.sharpApiFallback = {
          status: Number(fallbackError?.status || 502),
          message:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError)
        };
      }
    }

    if (theOddsApiKey) {
      try {
        const fallback = await fetchTheOddsApiMlbProps({
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
        const events = fallback.events || [];
        const body = {
          fetchedAt: fallback.fetchedAt,
          version: "MLB Props Board v1.4",
          source: "The Odds API",
          providerChain: [
            "SportsGameOdds",
            "SharpAPI",
            "The Odds API"
          ],
          fallbackFrom: [
            {
              provider: "SportsGameOdds",
              status: Number(error?.status || 502),
              error:
                error instanceof Error
                  ? error.message
                  : String(error),
              objectBudgetBlocked:
                Boolean(error?.objectBudgetBlocked)
            },
            error?.sharpApiFallback
              ? {
                  provider: "SharpAPI",
                  status:
                    error.sharpApiFallback.status || 502,
                  error:
                    error.sharpApiFallback.message || null
                }
              : null
          ].filter(Boolean),
          books,
          markets: [
            "pitching_strikeouts",
            "batting_hits",
            "batting_totalBases"
          ],
          window: {
            startsAfter: startsAfter || null,
            startsBefore: startsBefore || null
          },
          eventCount: events.length,
          propCount: events.reduce(
            (sum, event) =>
              sum + (event.props?.length || 0),
            0
          ),
          events,
          cache: {
            status:
              fallback.cache?.status || "MIXED",
            layer:
              fallback.cache?.layer ||
              "local/upstream",
            ageSeconds:
              fallback.cache?.ageSeconds ?? 0,
            freshForSeconds:
              Math.max(
                600,
                refreshPolicy.suggestedSeconds
              ),
            staleForSeconds:
              Math.max(
                20 * 60 * 1000,
                refreshPolicy.staleMs
              ) / 1000
          },
          servedStale:
            Boolean(fallback.cache?.servedStale),
          circuitOpen: false,
          recoveryState: "FALLBACK",
          requestBudget: null,
          theOddsApiUsage:
            fallback.usage ||
            getTheOddsApiUsageSnapshot(),
          refreshPolicy,
          objectOptimization: {
            ...objectPolicy,
            objectsReturned: 0,
            fallbackProvider: "The Odds API"
          },
          upstreamError:
            fallback.cache?.upstreamError || null
        };

        res.setHeader(
          "Cache-Control",
          "public, max-age=0, s-maxage=600, stale-while-revalidate=1200, stale-if-error=1200"
        );
        res.setHeader(
          "Vercel-Cache-Tag",
          "edge-lab-props"
        );
        res.setHeader(
          "X-Props-Cache",
          body.cache.status
        );
        res.setHeader(
          "X-Odds-Provider",
          "The Odds API"
        );
        return res.status(200).json(body);
      } catch (fallbackError) {
        error.theOddsApiFallback = {
          status: Number(
            fallbackError?.status || 502
          ),
          message:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
          quotaBlocked:
            Boolean(fallbackError?.quotaBlocked),
          usage:
            fallbackError?.usage ||
            getTheOddsApiUsageSnapshot()
        };
      }
    }

    const status = Number(error?.status || 502);
    const retryAfter = error?.retryAfter ?? null;
    if (retryAfter !== null) {
      res.setHeader("Retry-After", String(retryAfter));
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Props-Cache", "MISS");
    if (error?.budgetBlocked) {
      res.setHeader("X-Provider-Budget", "BLOCKED");
    }

    return res.status(status).json({
      error: error instanceof Error ? error.message : String(error),
      source: "SportsGameOdds v2",
      providerChain: [
            "SportsGameOdds",
            "SharpAPI",
            "The Odds API"
          ],
      sharpApiFallback: error?.sharpApiFallback || null,
      theOddsApiFallback:
        error?.theOddsApiFallback || null,
      theOddsApiUsage:
        getTheOddsApiUsageSnapshot(),
      retryAfterSeconds: retryAfter,
      circuitOpen: Boolean(error?.circuitOpen),
      budgetBlocked: Boolean(error?.budgetBlocked),
      objectBudgetBlocked: Boolean(error?.objectBudgetBlocked),
      requestBudget: error?.budget || null,
      refreshPolicy,
      objectOptimization: error?.objectPolicy || objectPolicy,
      cache: {
        status: "MISS",
        layer: "none",
        sharedEnabled: Boolean(
          process.env.SUPABASE_SECRET_KEY ||
          process.env.SUPABASE_SERVICE_ROLE_KEY
        ),
        freshForSeconds: refreshPolicy.suggestedSeconds,
        staleForSeconds:
          Math.max(STALE_TTL_MS, refreshPolicy.staleMs) / 1000
      }
    });
  }
}
