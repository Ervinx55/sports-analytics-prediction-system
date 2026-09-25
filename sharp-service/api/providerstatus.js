import {
  getSportsGameOddsUsageSnapshot
} from "../lib/provider-protection.js";
import {
  getTheOddsApiUsageSnapshot
} from "../lib/the-odds-api-provider.js";

const PROVIDER_CHAIN = Object.freeze([
  "SportsGameOdds",
  "SharpAPI",
  "The Odds API",
  "Schedule Only"
]);

function configuredProviders() {
  return {
    sportsGameOdds: Boolean(process.env.SPORTS_ODDS_API_KEY),
    sharpApi: Boolean(process.env.SHARPAPI_KEY),
    theOddsApi: Boolean(process.env.THE_ODDS_API_KEY)
  };
}

function sportsGameOddsState(usage, configured, error = null) {
  if (!configured) {
    return {
      configured: false,
      status: "NOT_CONFIGURED",
      error: null,
      usage: null
    };
  }
  if (error) {
    return {
      configured: true,
      status: "USAGE_UNAVAILABLE",
      error,
      usage: null
    };
  }

  const constrained = usage?.mostConstrainedObjects || null;
  const remaining = Number(constrained?.remainingObjects);
  const usagePct = Number(constrained?.usagePct);
  let status = "READY";
  if (Number.isFinite(remaining) && remaining <= 0) {
    status = "QUOTA_EXHAUSTED";
  } else if (Number.isFinite(usagePct) && usagePct >= 95) {
    status = "QUOTA_CRITICAL";
  } else if (Number.isFinite(usagePct) && usagePct >= 85) {
    status = "QUOTA_HIGH";
  }

  return {
    configured: true,
    status,
    error: null,
    usage: {
      tier: usage?.tier || null,
      maxRequestsPerMinute: usage?.maxRequests ?? null,
      currentRequestsThisInterval: usage?.currentRequests ?? null,
      mostConstrainedObjects: constrained
    }
  };
}

function theOddsApiState(usage, configured) {
  if (!configured) {
    return {
      configured: false,
      status: "NOT_CONFIGURED",
      usage: null
    };
  }

  const remaining = Number(usage?.remaining);
  const reserve = Number(usage?.reserve);
  let status = "READY";
  if (Number.isFinite(remaining) && remaining <= 0) {
    status = "CREDITS_EXHAUSTED";
  } else if (
    Number.isFinite(remaining) &&
    Number.isFinite(reserve) &&
    remaining <= reserve
  ) {
    status = "CREDIT_RESERVE";
  } else if (!Number.isFinite(remaining)) {
    status = "AWAITING_FIRST_RESPONSE";
  }

  return {
    configured: true,
    status,
    usage: {
      remaining: usage?.remaining ?? null,
      used: usage?.used ?? null,
      lastCost: usage?.lastCost ?? null,
      updatedAt: usage?.updatedAt ?? null,
      reserve: usage?.reserve ?? null,
      maxPropEvents: usage?.maxPropEvents ?? null
    }
  };
}

export async function buildProviderStatus() {
  const configured = configuredProviders();
  let sportsUsage = null;
  let sportsUsageError = null;

  if (configured.sportsGameOdds) {
    try {
      sportsUsage = await getSportsGameOddsUsageSnapshot(
        process.env.SPORTS_ODDS_API_KEY
      );
    } catch (error) {
      sportsUsageError =
        error instanceof Error ? error.message : String(error);
    }
  }

  const theOddsUsage = getTheOddsApiUsageSnapshot();

  const providers = {
    sportsGameOdds: sportsGameOddsState(
      sportsUsage,
      configured.sportsGameOdds,
      sportsUsageError
    ),
    sharpApi: {
      configured: configured.sharpApi,
      status: configured.sharpApi ? "READY" : "NOT_CONFIGURED",
      note:
        "SharpAPI does not consume SportsGameOdds object quota; live usability still depends on the connected SharpAPI plan."
    },
    theOddsApi: theOddsApiState(
      theOddsUsage,
      configured.theOddsApi
    ),
    scheduleOnly: {
      configured: true,
      status: "READY",
      note:
        "Schedule-only mode is the final fail-safe and never creates a betting grade."
    }
  };

  const oddsProviderReady = [
    providers.sportsGameOdds,
    providers.sharpApi,
    providers.theOddsApi
  ].some((provider) =>
    ["READY", "AWAITING_FIRST_RESPONSE"].includes(provider.status)
  );

  return {
    generatedAt: new Date().toISOString(),
    providerChain: PROVIDER_CHAIN,
    configured,
    oddsProviderReady,
    providers
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  const body = await buildProviderStatus();

  res.setHeader(
    "Cache-Control",
    "public, max-age=0, s-maxage=30, stale-while-revalidate=60"
  );

  return res.status(200).json(body);
}
