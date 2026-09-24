import { createHash } from "node:crypto";

const DEFAULT_PROVIDER = "sportsgameodds";
const DEFAULT_SUPABASE_URL = "https://yeoxroijaptomomshdii.supabase.co";
const MAX_LOCAL_ENTRIES = 100;
const DEFAULT_REQUESTS_PER_MINUTE = 9;
const DEFAULT_CRITICAL_RESERVE = 2;
const DEFAULT_NORMAL_RESERVE = 1;
const DEFAULT_UNLIMITED_REQUESTS_PER_MINUTE = 60;
const USAGE_CACHE_TTL_MS = 60 * 1000;

const state =
  globalThis.__edgeLabProviderProtection ||
  (globalThis.__edgeLabProviderProtection = {
    entries: new Map(),
    inFlight: new Map(),
    circuits: new Map(),
    probes: new Map(),
    budgets: new Map()
  });

if (!state.probes) state.probes = new Map();
if (!state.budgets) state.budgets = new Map();
if (!state.usage) {
  state.usage = {
    value: null,
    fetchedAt: 0,
    inFlight: null
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function nowMs() {
  return Date.now();
}

function envInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function normalizePriority(value) {
  const priority = String(value || "normal").toLowerCase();
  return ["critical", "normal", "background"].includes(priority)
    ? priority
    : "normal";
}

function hasEnvValue(name) {
  return process.env[name] !== undefined &&
    String(process.env[name]).trim() !== "";
}

function requestBudgetSettings(capacityOverride = null) {
  const explicitCapacity = hasEnvValue(
    "SPORTS_ODDS_REQUESTS_PER_MINUTE"
  );
  const capacity = clamp(
    capacityOverride == null || explicitCapacity
      ? envInt(
          "SPORTS_ODDS_REQUESTS_PER_MINUTE",
          DEFAULT_REQUESTS_PER_MINUTE
        )
      : Math.floor(capacityOverride),
    1,
    1000
  );

  const defaultCriticalReserve = Math.max(
    DEFAULT_CRITICAL_RESERVE,
    Math.ceil(capacity * 0.2)
  );
  const criticalReserve = clamp(
    hasEnvValue("SPORTS_ODDS_CRITICAL_RESERVE")
      ? envInt(
          "SPORTS_ODDS_CRITICAL_RESERVE",
          defaultCriticalReserve
        )
      : defaultCriticalReserve,
    0,
    Math.max(capacity - 1, 0)
  );

  const defaultNormalReserve = Math.max(
    DEFAULT_NORMAL_RESERVE,
    Math.ceil(capacity * 0.1)
  );
  const normalReserve = clamp(
    hasEnvValue("SPORTS_ODDS_NORMAL_RESERVE")
      ? envInt(
          "SPORTS_ODDS_NORMAL_RESERVE",
          defaultNormalReserve
        )
      : defaultNormalReserve,
    0,
    Math.max(capacity - criticalReserve - 1, 0)
  );

  return {
    capacity,
    criticalReserve,
    normalReserve
  };
}

function requiredBudgetTokens(priority, settings) {
  if (priority === "critical") return 1;
  if (priority === "normal") {
    return settings.criticalReserve + 1;
  }
  return (
    settings.criticalReserve +
    settings.normalReserve +
    1
  );
}

function claimLocalBudget(provider, priority, settings) {
  const now = nowMs();
  const current = state.budgets.get(provider);
  const refillPerMs = settings.capacity / 60_000;
  let tokens = settings.capacity;

  if (current) {
    const elapsedMs = Math.max(0, now - current.refilledAt);
    tokens = Math.min(
      settings.capacity,
      Math.min(Number(current.tokens), settings.capacity) +
        elapsedMs * refillPerMs
    );
  }

  const required = requiredBudgetTokens(priority, settings);
  const allowed = tokens >= required;
  let retryAfterSeconds = 0;

  if (allowed) {
    tokens -= 1;
  } else if (refillPerMs > 0) {
    retryAfterSeconds = Math.max(
      1,
      Math.ceil((required - tokens) / refillPerMs / 1000)
    );
  } else {
    retryAfterSeconds = 60;
  }

  state.budgets.set(provider, {
    tokens,
    capacity: settings.capacity,
    refilledAt: now,
    claimedCount:
      Number(current?.claimedCount || 0) + (allowed ? 1 : 0),
    deniedCount:
      Number(current?.deniedCount || 0) + (allowed ? 0 : 1)
  });

  return {
    allowed,
    claimed: allowed,
    source: "local",
    priority,
    capacity: settings.capacity,
    tokensRemaining: Number(tokens.toFixed(3)),
    criticalReserve: settings.criticalReserve,
    normalReserve: settings.normalReserve,
    retryAfterSeconds
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return { error: raw.slice(0, 800) };
  }
}

function retryAfterSeconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const at = Date.parse(String(value));
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs()) / 1000));
}

function cacheKey({ provider, url, freshMs, staleMs }) {
  return createHash("sha256")
    .update(`${provider}|${freshMs}|${staleMs}|${url}`)
    .digest("hex");
}

function sharedConfig() {
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  if (!key) return null;

  return {
    url: String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, ""),
    key
  };
}

function sharedHeaders(config, extra = {}) {
  const headers = {
    apikey: config.key,
    accept: "application/json",
    ...extra
  };

  // Legacy service_role keys are JWTs. Modern sb_secret_* keys authenticate
  // through the apikey header and should not be exposed to browser clients.
  if (config.key.startsWith("eyJ")) {
    headers.authorization = `Bearer ${config.key}`;
  }

  return headers;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function quotaNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function quotaInterval(rateLimits, key, aliases = []) {
  const row =
    rateLimits[key] ||
    aliases.map((alias) => rateLimits[alias]).find(Boolean) ||
    {};
  const maxRaw =
    row["max-entities"] ??
    row.maxEntities ??
    row.maxObjects ??
    null;
  const currentRaw =
    row["current-entities"] ??
    row.currentEntities ??
    row.currentObjects ??
    null;

  return {
    interval: key,
    unlimited:
      String(maxRaw || "").toLowerCase() === "unlimited",
    maxObjects: quotaNumber(maxRaw),
    currentObjects: quotaNumber(currentRaw)
  };
}

function constrainedObjectUsage(objects = {}) {
  const candidates = Object.values(objects)
    .filter(
      (row) =>
        !row?.unlimited &&
        Number.isFinite(row?.maxObjects) &&
        row.maxObjects > 0 &&
        Number.isFinite(row?.currentObjects)
    )
    .map((row) => ({
      ...row,
      remainingObjects: Math.max(
        0,
        row.maxObjects - row.currentObjects
      ),
      usagePct: Number(
        ((row.currentObjects / row.maxObjects) * 100).toFixed(2)
      )
    }))
    .sort((a, b) => b.usagePct - a.usagePct);

  return candidates[0] || null;
}

function readUsageLimit(payload) {
  const data = payload?.data || payload || {};
  const rateLimits = data.rateLimits || data.rate_limits || {};
  const perMinute =
    rateLimits["per-minute"] ||
    rateLimits.perMinute ||
    rateLimits.per_minute ||
    {};

  const maxRaw =
    perMinute["max-requests"] ??
    perMinute.maxRequestsPerInterval ??
    perMinute.maxRequests ??
    null;
  const currentRaw =
    perMinute["current-requests"] ??
    perMinute.currentIntervalRequests ??
    perMinute.currentRequests ??
    null;

  const maxRequests = Number(maxRaw);
  const currentRequests = Number(currentRaw);
  const unlimited =
    String(maxRaw || "").toLowerCase() === "unlimited";

  const objects = {
    perHour: quotaInterval(
      rateLimits,
      "per-hour",
      ["perHour", "per_hour"]
    ),
    perDay: quotaInterval(
      rateLimits,
      "per-day",
      ["perDay", "per_day"]
    ),
    perMonth: quotaInterval(
      rateLimits,
      "per-month",
      ["perMonth", "per_month"]
    )
  };

  return {
    tier: data.tier || null,
    unlimited,
    maxRequests:
      Number.isFinite(maxRequests) && maxRequests > 0
        ? maxRequests
        : null,
    currentRequests:
      Number.isFinite(currentRequests) && currentRequests >= 0
        ? currentRequests
        : null,
    objects,
    mostConstrainedObjects: constrainedObjectUsage(objects)
  };
}

function capacityFromUsage(usage) {
  if (usage?.unlimited) {
    return DEFAULT_UNLIMITED_REQUESTS_PER_MINUTE;
  }
  if (!Number.isFinite(usage?.maxRequests)) return null;

  const max = Math.max(1, Math.floor(usage.maxRequests));
  const headroom = Math.max(1, Math.ceil(max * 0.1));
  return Math.max(1, max - headroom);
}

async function fetchProviderUsage(apiKey) {
  const response = await fetchWithTimeout(
    "https://api.sportsgameodds.com/v2/account/usage",
    {
      headers: {
        "x-api-key": apiKey,
        accept: "application/json"
      },
      cache: "no-store"
    },
    2_000
  );

  const raw = await response.text();
  const payload = parseJson(raw);
  if (!response.ok || payload?.success === false) {
    throw new Error(
      payload?.error ||
        payload?.message ||
        "SportsGameOdds usage request failed"
    );
  }

  return readUsageLimit(payload);
}

async function providerUsage(apiKey) {
  const now = nowMs();
  if (
    state.usage.value &&
    now - state.usage.fetchedAt < USAGE_CACHE_TTL_MS
  ) {
    return state.usage.value;
  }

  if (state.usage.inFlight) {
    return state.usage.inFlight;
  }

  const work = fetchProviderUsage(apiKey);
  state.usage.inFlight = work;

  try {
    const value = await work;
    state.usage.value = value;
    state.usage.fetchedAt = nowMs();
    return value;
  } finally {
    if (state.usage.inFlight === work) {
      state.usage.inFlight = null;
    }
  }
}

export async function getSportsGameOddsUsageSnapshot(apiKey) {
  return providerUsage(apiKey);
}

function objectPressure(usage) {
  const constrained = usage?.mostConstrainedObjects;
  if (!constrained) {
    return {
      level: "UNKNOWN",
      constrained: null
    };
  }

  if (constrained.remainingObjects <= 0) {
    return { level: "EXHAUSTED", constrained };
  }
  if (constrained.usagePct >= 95) {
    return { level: "CRITICAL", constrained };
  }
  if (constrained.usagePct >= 85) {
    return { level: "HIGH", constrained };
  }
  if (constrained.usagePct >= 70) {
    return { level: "MODERATE", constrained };
  }
  return { level: "LOW", constrained };
}

function pressureCap(level, priority, requestedLimit) {
  const normalized = normalizePriority(priority);
  const caps = {
    MODERATE: { critical: 30, normal: 20, background: 10 },
    HIGH: { critical: 20, normal: 10, background: 5 },
    CRITICAL: { critical: 10, normal: 5, background: 2 }
  };
  return Math.min(
    requestedLimit,
    caps[level]?.[normalized] ?? requestedLimit
  );
}

export async function optimizeSportsGameOddsObjectLimit({
  apiKey,
  requestedLimit,
  defaultLimit = 20,
  priority = "normal",
  fanout = 1
}) {
  const requested = clamp(
    Number.isFinite(Number(requestedLimit))
      ? Math.floor(Number(requestedLimit))
      : defaultLimit,
    1,
    100
  );
  const normalizedPriority = normalizePriority(priority);
  const normalizedFanout = clamp(
    Math.floor(Number(fanout) || 1),
    1,
    50
  );

  if (
    String(process.env.SPORTS_ODDS_OBJECT_OPTIMIZATION || "1") === "0"
  ) {
    return {
      requestedLimit: requested,
      effectiveLimit: requested,
      fanout: normalizedFanout,
      projectedMaxObjects: requested * normalizedFanout,
      priority: normalizedPriority,
      pressure: "DISABLED",
      source: "disabled",
      blocked: false,
      constrainedInterval: null,
      usagePct: null,
      remainingObjects: null,
      tier: null
    };
  }

  try {
    const usage = await providerUsage(apiKey);
    const pressure = objectPressure(usage);
    const constrained = pressure.constrained;

    if (pressure.level === "EXHAUSTED") {
      return {
        requestedLimit: requested,
        effectiveLimit: 0,
        fanout: normalizedFanout,
        projectedMaxObjects: 0,
        priority: normalizedPriority,
        pressure: pressure.level,
        source: "provider_usage",
        blocked: true,
        constrainedInterval: constrained?.interval || null,
        usagePct: constrained?.usagePct ?? null,
        maxObjects: constrained?.maxObjects ?? null,
        currentObjects: constrained?.currentObjects ?? null,
        remainingObjects: constrained?.remainingObjects ?? 0,
        tier: usage?.tier || null
      };
    }

    let effective = pressureCap(
      pressure.level,
      normalizedPriority,
      requested
    );

    if (
      constrained &&
      Number.isFinite(constrained.remainingObjects)
    ) {
      effective = Math.min(
        effective,
        Math.max(
          1,
          Math.floor(
            constrained.remainingObjects / normalizedFanout
          )
        )
      );
    }

    return {
      requestedLimit: requested,
      effectiveLimit: Math.max(1, effective),
      fanout: normalizedFanout,
      projectedMaxObjects:
        Math.max(1, effective) * normalizedFanout,
      priority: normalizedPriority,
      pressure: pressure.level,
      source: "provider_usage",
      blocked: false,
      constrainedInterval: constrained?.interval || null,
      usagePct: constrained?.usagePct ?? null,
      maxObjects: constrained?.maxObjects ?? null,
      currentObjects: constrained?.currentObjects ?? null,
      remainingObjects: constrained?.remainingObjects ?? null,
      tier: usage?.tier || null
    };
  } catch {
    return {
      requestedLimit: requested,
      effectiveLimit: requested,
      fanout: normalizedFanout,
      projectedMaxObjects: requested * normalizedFanout,
      priority: normalizedPriority,
      pressure: "UNKNOWN",
      source: "fallback",
      blocked: false,
      constrainedInterval: null,
      usagePct: null,
      remainingObjects: null,
      tier: null
    };
  }
}

async function resolveBudgetSettings(apiKey) {
  if (hasEnvValue("SPORTS_ODDS_REQUESTS_PER_MINUTE")) {
    return {
      ...requestBudgetSettings(),
      limitSource: "environment",
      providerRateLimit: null
    };
  }

  try {
    const usage = await providerUsage(apiKey);
    const discoveredCapacity = capacityFromUsage(usage);
    if (discoveredCapacity != null) {
      return {
        ...requestBudgetSettings(discoveredCapacity),
        limitSource: "provider_usage",
        providerRateLimit: usage
      };
    }
  } catch {
    // Keep operating with the conservative fallback if usage lookup fails.
  }

  return {
    ...requestBudgetSettings(),
    limitSource: "fallback",
    providerRateLimit: null
  };
}

async function sharedRequest(config, path, options = {}) {
  const response = await fetchWithTimeout(
    `${config.url}/rest/v1/${path}`,
    {
      ...options,
      headers: sharedHeaders(config, options.headers || {})
    },
    1500
  );

  const raw = await response.text();
  const payload = raw ? parseJson(raw) : null;
  if (!response.ok) {
    const error = new Error(
      payload?.message ||
        payload?.error ||
        `Supabase provider cache request failed (${response.status})`
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function readSharedCache(config, key) {
  const rows = await sharedRequest(
    config,
    `provider_response_cache?cache_key=eq.${encodeURIComponent(
      key
    )}&select=payload,status_code,fetched_at,expires_at,stale_until,last_error&limit=1`
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function writeSharedCache(config, {
  key,
  provider,
  payload,
  statusCode,
  fetchedAt,
  freshMs,
  staleMs
}) {
  const fetched = new Date(fetchedAt);
  const row = {
    cache_key: key,
    provider,
    payload,
    status_code: statusCode,
    fetched_at: fetched.toISOString(),
    expires_at: new Date(fetched.getTime() + freshMs).toISOString(),
    stale_until: new Date(fetched.getTime() + staleMs).toISOString(),
    last_error: null,
    updated_at: new Date().toISOString()
  };

  await sharedRequest(
    config,
    "provider_response_cache?on_conflict=cache_key",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(row)
    }
  );
}

async function readSharedCircuit(config, provider) {
  const rows = await sharedRequest(
    config,
    `provider_circuit_state?provider=eq.${encodeURIComponent(
      provider
    )}&select=provider,consecutive_failures,opened_until,last_status,last_error,last_failure_at,backoff_seconds,last_probe_at,last_success_at,recovery_count&limit=1`
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function claimSharedRefresh(config, key, provider) {
  const result = await sharedRequest(config, "rpc/claim_provider_refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      p_cache_key: key,
      p_provider: provider,
      p_lease_seconds: 12
    })
  });
  return result === true;
}

async function releaseSharedRefresh(config, key) {
  await sharedRequest(config, "rpc/release_provider_refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ p_cache_key: key })
  });
}

async function recordSharedProbe(config, provider) {
  await sharedRequest(config, "rpc/record_provider_probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ p_provider: provider })
  });
}

async function recordSharedSuccess(config, provider) {
  await sharedRequest(config, "rpc/record_provider_success", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ p_provider: provider })
  });
}

async function recordSharedFailure(config, provider, error) {
  await sharedRequest(config, "rpc/record_provider_failure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      p_provider: provider,
      p_status: Number(error?.status || 502),
      p_message: error instanceof Error ? error.message : String(error),
      p_retry_after_seconds: error?.retryAfter ?? null
    })
  });
}

async function claimSharedBudget(
  config,
  provider,
  priority,
  settings
) {
  const result = await sharedRequest(
    config,
    "rpc/claim_provider_budget",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        p_provider: provider,
        p_priority: priority,
        p_capacity: settings.capacity,
        p_critical_reserve: settings.criticalReserve,
        p_normal_reserve: settings.normalReserve
      })
    }
  );

  return {
    ...(result || {}),
    claimed: Boolean(result?.allowed),
    source: "shared"
  };
}

async function claimProviderBudget(
  config,
  provider,
  priority,
  apiKey
) {
  const settings = await resolveBudgetSettings(apiKey);

  if (config) {
    try {
      const result = await claimSharedBudget(
        config,
        provider,
        priority,
        settings
      );
      return {
        ...result,
        limitSource: settings.limitSource,
        providerRateLimit: settings.providerRateLimit
      };
    } catch {
      // Shared budgeting is an optimization. Preserve safety with the
      // per-instance token bucket if Supabase is temporarily unavailable.
    }
  }

  return {
    ...claimLocalBudget(
      provider,
      priority,
      settings
    ),
    limitSource: settings.limitSource,
    providerRateLimit: settings.providerRateLimit
  };
}

function budgetBlockedError(budget) {
  const error = new Error(
    "Provider request budget is preserving capacity for higher-priority traffic"
  );
  error.status = 429;
  error.retryAfter = Number(
    budget?.retryAfterSeconds || 1
  );
  error.budgetBlocked = true;
  error.budget = budget;
  return error;
}

async function recordProviderEvent(config, {
  provider,
  consumer,
  eventType,
  statusCode = null,
  cacheLayer = null,
  retryAfterSeconds = null,
  durationMs = null,
  details = {}
}) {
  await sharedRequest(config, "provider_request_events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      prefer: "return=minimal"
    },
    body: JSON.stringify({
      provider,
      consumer,
      event_type: eventType,
      status_code: statusCode,
      cache_layer: cacheLayer,
      retry_after_seconds: retryAfterSeconds,
      duration_ms: durationMs,
      details
    })
  });
}

function localEntry(key) {
  return state.entries.get(key) || null;
}

function storeLocal(key, payload, fetchedAt) {
  state.entries.delete(key);
  state.entries.set(key, { payload, fetchedAt });

  while (state.entries.size > MAX_LOCAL_ENTRIES) {
    const oldest = state.entries.keys().next().value;
    if (!oldest) break;
    state.entries.delete(oldest);
  }
}

function localCircuit(provider) {
  return (
    state.circuits.get(provider) || {
      failures: 0,
      openUntil: 0,
      lastStatus: null,
      lastError: null,
      backoffSeconds: 0,
      lastProbeAt: 0
    }
  );
}

function adaptiveBackoffSeconds(status, retryAfter, failures) {
  if (status === 429) {
    const exponential = Math.min(
      900,
      60 * (2 ** Math.min(Math.max(failures - 1, 0), 4))
    );
    return clamp(
      Math.max(Number(retryAfter ?? 60), exponential),
      1,
      900
    );
  }

  if (status >= 500 && status <= 599 && failures >= 3) {
    return Math.min(
      300,
      30 * (2 ** Math.min(Math.max(failures - 3, 0), 4))
    );
  }

  return 0;
}

function claimLocalProbe(provider, leaseMs = 15_000) {
  const now = nowMs();
  const current = Number(state.probes.get(provider) || 0);
  if (current > now) return false;
  state.probes.set(provider, now + leaseMs);
  return true;
}

function releaseLocalProbe(provider) {
  state.probes.delete(provider);
}

function noteLocalSuccess(provider) {
  const current = localCircuit(provider);
  const recovered =
    current.failures > 0 ||
    current.openUntil > 0 ||
    current.backoffSeconds > 0;

  state.circuits.set(provider, {
    failures: 0,
    openUntil: 0,
    lastStatus: null,
    lastError: null,
    backoffSeconds: 0,
    lastProbeAt: current.lastProbeAt || 0
  });
  releaseLocalProbe(provider);
  return recovered;
}

function noteLocalFailure(provider, error) {
  const current = localCircuit(provider);
  const status = Number(error?.status || 502);
  const failures = current.failures + 1;
  const backoffSeconds = adaptiveBackoffSeconds(
    status,
    error?.retryAfter,
    failures
  );

  const next = {
    failures,
    openUntil:
      backoffSeconds > 0 ? nowMs() + backoffSeconds * 1000 : 0,
    lastStatus: status,
    lastError: error instanceof Error ? error.message : String(error),
    backoffSeconds,
    lastProbeAt: current.lastProbeAt || 0
  };

  state.circuits.set(provider, next);
  releaseLocalProbe(provider);
  return next;
}

function rowAgeMs(row, now = nowMs()) {
  const at = Date.parse(row?.fetched_at || "");
  return Number.isFinite(at) ? Math.max(0, now - at) : Infinity;
}

function localAgeMs(entry, now = nowMs()) {
  const at = Number(entry?.fetchedAt || 0);
  return at > 0 ? Math.max(0, now - at) : Infinity;
}

function chooseStale({ local, shared, staleMs, now }) {
  const localAge = localAgeMs(local, now);
  const sharedAge = rowAgeMs(shared, now);

  const localOk = local && localAge <= staleMs;
  const sharedOk = shared && sharedAge <= staleMs;

  if (!localOk && !sharedOk) return null;
  if (sharedOk && (!localOk || sharedAge <= localAge)) {
    return {
      payload: shared.payload,
      fetchedAt: Date.parse(shared.fetched_at),
      ageMs: sharedAge,
      layer: "shared"
    };
  }
  return {
    payload: local.payload,
    fetchedAt: local.fetchedAt,
    ageMs: localAge,
    layer: "local"
  };
}

function circuitFromShared(row) {
  const openedUntil = Date.parse(row?.opened_until || "");
  const lastProbeAt = Date.parse(row?.last_probe_at || "");
  return {
    failures: Number(row?.consecutive_failures || 0),
    openUntil: Number.isFinite(openedUntil) ? openedUntil : 0,
    lastStatus: row?.last_status ?? null,
    lastError: row?.last_error ?? null,
    backoffSeconds: Number(row?.backoff_seconds || 0),
    lastProbeAt: Number.isFinite(lastProbeAt) ? lastProbeAt : 0
  };
}

function strongestCircuit(local, shared) {
  const sharedCircuit = circuitFromShared(shared);
  if (sharedCircuit.openUntil !== local.openUntil) {
    return sharedCircuit.openUntil > local.openUntil
      ? sharedCircuit
      : local;
  }
  return sharedCircuit.failures > local.failures
    ? sharedCircuit
    : local;
}

function circuitError(circuit) {
  const retryAfter = Math.max(
    1,
    Math.ceil((circuit.openUntil - nowMs()) / 1000)
  );
  const error = new Error(
    circuit.lastError || "SportsGameOdds circuit breaker is open"
  );
  error.status = Number(circuit.lastStatus || 503);
  error.retryAfter = retryAfter;
  error.circuitOpen = true;
  return error;
}

async function fetchUpstream(url, apiKey, timeoutMs, maxAttempts = 2) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetchWithTimeout(
        url,
        {
          headers: {
            "x-api-key": apiKey,
            accept: "application/json"
          },
          cache: "no-store"
        },
        timeoutMs
      );
    } catch (cause) {
      const error = new Error(
        cause?.name === "AbortError"
          ? "SportsGameOdds request timed out"
          : "SportsGameOdds request failed"
      );
      error.status = 502;
      error.cause = cause;
      if (attempt + 1 < maxAttempts) {
        await sleep(400);
        continue;
      }
      error.budget = budget;
      throw error;
    }

    const raw = await response.text();
    const payload = parseJson(raw);

    if (response.ok && payload?.success !== false) {
      return {
        payload,
        statusCode: response.status,
        fetchedAt: nowMs()
      };
    }

    const retryAfter = retryAfterSeconds(response.headers.get("retry-after"));
    const error = new Error(
      payload?.error ||
        payload?.message ||
        "SportsGameOdds request failed"
    );
    error.status = response.ok ? 502 : response.status || 502;
    error.retryAfter = retryAfter;

    const retryableServerError = error.status >= 500 && error.status <= 599;
    const shortRateLimit =
      error.status === 429 && retryAfter !== null && retryAfter <= 2;

    if (
      attempt + 1 < maxAttempts &&
      (retryableServerError || shortRateLimit)
    ) {
      await sleep(
        shortRateLimit ? Math.max(250, retryAfter * 1000) : 400
      );
      continue;
    }

    throw error;
  }

  const error = new Error("SportsGameOdds request failed after retry");
  error.status = 502;
  throw error;
}

export async function protectedSportsGameOddsFetch({
  url,
  apiKey,
  freshMs = 60_000,
  staleMs = 300_000,
  timeoutMs = 8_000,
  provider = DEFAULT_PROVIDER,
  consumer = "unknown",
  priority = "normal",
  objectPolicy = null
}) {
  const key = cacheKey({ provider, url, freshMs, staleMs });
  const now = nowMs();
  const local = localEntry(key);
  const localAge = localAgeMs(local, now);

  if (local && localAge < freshMs) {
    return {
      payload: local.payload,
      cacheStatus: "HIT",
      cacheLayer: "local",
      ageMs: localAge,
      fetchedAt: local.fetchedAt,
      upstreamError: null,
      circuitOpen: false,
      sharedEnabled: Boolean(sharedConfig())
    };
  }

  if (state.inFlight.has(key)) {
    const sharedResult = await state.inFlight.get(key);
    return {
      ...sharedResult,
      cacheStatus:
        sharedResult.cacheStatus === "MISS"
          ? "COALESCED"
          : sharedResult.cacheStatus
    };
  }

  const work = (async () => {
    const config = sharedConfig();
    let shared = null;
    let sharedCircuit = null;
    let leaseClaimed = false;
    let probeLeaseClaimed = false;
    const probeKey = `__provider_probe__:${provider}`;

    if (config) {
      const [cacheResult, circuitResult] = await Promise.allSettled([
        readSharedCache(config, key),
        readSharedCircuit(config, provider)
      ]);
      if (cacheResult.status === "fulfilled") shared = cacheResult.value;
      if (circuitResult.status === "fulfilled") {
        sharedCircuit = circuitResult.value;
      }

      const sharedAge = rowAgeMs(shared, nowMs());
      if (shared && sharedAge < freshMs) {
        const fetchedAt = Date.parse(shared.fetched_at);
        storeLocal(key, shared.payload, fetchedAt);
        await Promise.allSettled([
          recordProviderEvent(config, {
            provider,
            consumer,
            eventType: "SHARED_HIT",
            statusCode: Number(shared.status_code || 200),
            cacheLayer: "shared"
          })
        ]);
        return {
          payload: shared.payload,
          cacheStatus: "HIT",
          cacheLayer: "shared",
          ageMs: sharedAge,
          fetchedAt,
          upstreamError: null,
          circuitOpen: false,
          sharedEnabled: true
        };
      }
    }

    const circuit = strongestCircuit(
      localCircuit(provider),
      sharedCircuit
    );

    if (circuit.openUntil > nowMs()) {
      const stale = chooseStale({
        local: localEntry(key),
        shared,
        staleMs,
        now: nowMs()
      });
      if (stale) {
        if (config) {
          await Promise.allSettled([
            recordProviderEvent(config, {
              provider,
              consumer,
              eventType: "STALE_SERVED",
              statusCode: Number(circuit.lastStatus || 503),
              cacheLayer: stale.layer,
              retryAfterSeconds: Math.max(
                1,
                Math.ceil((circuit.openUntil - nowMs()) / 1000)
              )
            })
          ]);
        }
        storeLocal(key, stale.payload, stale.fetchedAt);
        return {
          payload: stale.payload,
          cacheStatus: "STALE",
          cacheLayer: stale.layer,
          ageMs: stale.ageMs,
          fetchedAt: stale.fetchedAt,
          upstreamError: {
            status: circuit.lastStatus || 503,
            message:
              circuit.lastError || "Provider circuit breaker is open",
            retryAfterSeconds: Math.max(
              1,
              Math.ceil((circuit.openUntil - nowMs()) / 1000)
            ),
            circuitOpen: true
          },
          circuitOpen: true,
          recoveryState: "BACKOFF",
          sharedEnabled: Boolean(config)
        };
      }
      if (config) {
        await Promise.allSettled([
          recordProviderEvent(config, {
            provider,
            consumer,
            eventType: "CIRCUIT_BLOCKED",
            statusCode: Number(circuit.lastStatus || 503),
            retryAfterSeconds: Math.max(
              1,
              Math.ceil((circuit.openUntil - nowMs()) / 1000)
            )
          })
        ]);
      }
      throw circuitError(circuit);
    }

    const recovering =
      circuit.failures > 0 &&
      circuit.openUntil <= nowMs();

    if (recovering) {
      if (config) {
        try {
          probeLeaseClaimed = await claimSharedRefresh(
            config,
            probeKey,
            provider
          );
        } catch {
          probeLeaseClaimed = false;
        }

      } else {
        probeLeaseClaimed = claimLocalProbe(provider);
      }

      if (!probeLeaseClaimed) {
        const stale = chooseStale({
          local: localEntry(key),
          shared,
          staleMs,
          now: nowMs()
        });

        if (stale) {
          if (config) {
            await Promise.allSettled([
              recordProviderEvent(config, {
                provider,
                consumer,
                eventType: "STALE_SERVED",
                statusCode: Number(circuit.lastStatus || 503),
                cacheLayer: stale.layer,
                retryAfterSeconds: 2
              })
            ]);
          }
          storeLocal(key, stale.payload, stale.fetchedAt);
          return {
            payload: stale.payload,
            cacheStatus: "STALE",
            cacheLayer: stale.layer,
            ageMs: stale.ageMs,
            fetchedAt: stale.fetchedAt,
            upstreamError: {
              status: Number(circuit.lastStatus || 503),
              message: "Provider recovery probe already in progress",
              retryAfterSeconds: 2,
              circuitOpen: true
            },
            circuitOpen: true,
            recoveryState: "HALF_OPEN",
            sharedEnabled: Boolean(config)
          };
        }

        const error = new Error(
          "Provider recovery probe already in progress"
        );
        error.status = 503;
        error.retryAfter = 2;
        error.circuitOpen = true;
        error.recoveryState = "HALF_OPEN";
        throw error;
      }
    }

    if (config) {
      try {
        leaseClaimed = await claimSharedRefresh(config, key, provider);
      } catch {
        leaseClaimed = false;
      }

      if (!leaseClaimed) {
        const stale = chooseStale({
          local: localEntry(key),
          shared,
          staleMs,
          now: nowMs()
        });
        if (stale) {
          await Promise.allSettled([
            recordProviderEvent(config, {
              provider,
              consumer,
              eventType: "STALE_SERVED",
              statusCode: 202,
              cacheLayer: stale.layer
            }),
            probeLeaseClaimed
              ? releaseSharedRefresh(config, probeKey)
              : Promise.resolve()
          ]);
          probeLeaseClaimed = false;
          storeLocal(key, stale.payload, stale.fetchedAt);
          return {
            payload: stale.payload,
            cacheStatus: "STALE",
            cacheLayer: stale.layer,
            ageMs: stale.ageMs,
            fetchedAt: stale.fetchedAt,
            upstreamError: {
              status: 202,
              message: "Another instance is refreshing this provider key",
              retryAfterSeconds: null,
              circuitOpen: false
            },
            circuitOpen: false,
            recoveryState: recovering ? "HALF_OPEN" : "CLOSED",
            sharedEnabled: true
          };
        }

        // Cold-start case: give the instance holding the lease a brief chance
        // to populate shared cache before allowing a duplicate upstream call.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await sleep(250);
          try {
            const refreshed = await readSharedCache(config, key);
            const ageMs = rowAgeMs(refreshed, nowMs());
            if (refreshed && ageMs < freshMs) {
              const fetchedAt = Date.parse(refreshed.fetched_at);
              if (probeLeaseClaimed) {
                await Promise.allSettled([
                  releaseSharedRefresh(config, probeKey)
                ]);
                probeLeaseClaimed = false;
              }
              storeLocal(key, refreshed.payload, fetchedAt);
              return {
                payload: refreshed.payload,
                cacheStatus: "COALESCED",
                cacheLayer: "shared",
                ageMs,
                fetchedAt,
                upstreamError: null,
                circuitOpen: false,
                sharedEnabled: true
              };
            }
          } catch {
            break;
          }
        }
      }
    }

    const effectivePriority = recovering
      ? "critical"
      : normalizePriority(priority);

    if (objectPolicy?.blocked) {
      if (config) {
        await Promise.allSettled([
          recordProviderEvent(config, {
            provider,
            consumer,
            eventType: "BUDGET_BLOCKED",
            statusCode: 429,
            details: {
              budgetType: "objects",
              priority: effectivePriority,
              pressure: objectPolicy.pressure,
              constrainedInterval:
                objectPolicy.constrainedInterval,
              remainingObjects:
                objectPolicy.remainingObjects
            }
          }),
          leaseClaimed
            ? releaseSharedRefresh(config, key)
            : Promise.resolve(),
          probeLeaseClaimed
            ? releaseSharedRefresh(config, probeKey)
            : Promise.resolve()
        ]);
      } else if (probeLeaseClaimed) {
        releaseLocalProbe(provider);
      }

      const stale = chooseStale({
        local: localEntry(key),
        shared,
        staleMs,
        now: nowMs()
      });
      if (stale) {
        storeLocal(key, stale.payload, stale.fetchedAt);
        return {
          payload: stale.payload,
          cacheStatus: "STALE",
          cacheLayer: stale.layer,
          ageMs: stale.ageMs,
          fetchedAt: stale.fetchedAt,
          upstreamError: {
            status: 429,
            message: "Provider object quota is exhausted",
            retryAfterSeconds: 60,
            circuitOpen: false
          },
          circuitOpen: false,
          recoveryState: recovering ? "HALF_OPEN" : "CLOSED",
          objectPolicy,
          sharedEnabled: Boolean(config)
        };
      }

      const error = new Error(
        "Provider object quota is exhausted"
      );
      error.status = 429;
      error.retryAfter = 60;
      error.objectBudgetBlocked = true;
      error.objectPolicy = objectPolicy;
      throw error;
    }

    const budget = await claimProviderBudget(
      config,
      provider,
      effectivePriority,
      apiKey
    );

    if (!budget.allowed) {
      if (config) {
        await Promise.allSettled([
          recordProviderEvent(config, {
            provider,
            consumer,
            eventType: "BUDGET_BLOCKED",
            statusCode: 429,
            retryAfterSeconds:
              budget.retryAfterSeconds || 1,
            details: {
              priority: effectivePriority,
              capacity: budget.capacity ?? null,
              tokensRemaining:
                budget.tokensRemaining ?? null,
              source: budget.source || "shared"
            }
          }),
          leaseClaimed
            ? releaseSharedRefresh(config, key)
            : Promise.resolve(),
          probeLeaseClaimed
            ? releaseSharedRefresh(config, probeKey)
            : Promise.resolve()
        ]);
      } else if (probeLeaseClaimed) {
        releaseLocalProbe(provider);
      }

      leaseClaimed = false;
      probeLeaseClaimed = false;

      const stale = chooseStale({
        local: localEntry(key),
        shared,
        staleMs,
        now: nowMs()
      });

      if (stale) {
        storeLocal(key, stale.payload, stale.fetchedAt);
        return {
          payload: stale.payload,
          cacheStatus: "STALE",
          cacheLayer: stale.layer,
          ageMs: stale.ageMs,
          fetchedAt: stale.fetchedAt,
          upstreamError: {
            status: 429,
            message:
              "Provider request budget preserved capacity",
            retryAfterSeconds:
              budget.retryAfterSeconds || 1,
            circuitOpen: recovering
          },
          circuitOpen: recovering,
          recoveryState:
            recovering ? "HALF_OPEN" : "CLOSED",
          budget,
          objectPolicy,
          sharedEnabled: Boolean(config)
        };
      }

      const error = budgetBlockedError(budget);
      error.circuitOpen = recovering;
      error.recoveryState =
        recovering ? "HALF_OPEN" : "CLOSED";
      throw error;
    }

    if (recovering) {
      if (config) {
        await Promise.allSettled([
          recordSharedProbe(config, provider),
          recordProviderEvent(config, {
            provider,
            consumer,
            eventType: "PROBE_STARTED",
            details: {
              priority: effectivePriority
            }
          })
        ]);
      } else {
        const current = localCircuit(provider);
        state.circuits.set(provider, {
          ...current,
          lastProbeAt: nowMs()
        });
      }
    }

    const upstreamStartedAt = nowMs();
    try {
      const upstream = await fetchUpstream(
        url,
        apiKey,
        timeoutMs,
        recovering ? 1 : 2
      );
      const upstreamDurationMs = Math.max(0, nowMs() - upstreamStartedAt);
      const objectsReturned = Math.max(
        1,
        Array.isArray(upstream.payload?.data)
          ? upstream.payload.data.length
          : 1
      );
      storeLocal(key, upstream.payload, upstream.fetchedAt);
      const localRecovered = noteLocalSuccess(provider);
      const recovered = recovering || localRecovered;

      if (config) {
        await Promise.allSettled([
          writeSharedCache(config, {
            key,
            provider,
            payload: upstream.payload,
            statusCode: upstream.statusCode,
            fetchedAt: upstream.fetchedAt,
            freshMs,
            staleMs
          }),
          recordSharedSuccess(config, provider),
          leaseClaimed ? releaseSharedRefresh(config, key) : Promise.resolve(),
          recordProviderEvent(config, {
            provider,
            consumer,
            eventType: "UPSTREAM_SUCCESS",
            statusCode: upstream.statusCode,
            cacheLayer: "upstream",
            durationMs: upstreamDurationMs,
            details: {
              objectsReturned,
              priority: effectivePriority,
              requestedObjectLimit:
                objectPolicy?.requestedLimit ?? null,
              effectiveObjectLimit:
                objectPolicy?.effectiveLimit ?? null,
              objectPressure:
                objectPolicy?.pressure ?? null
            }
          }),
          recovered
            ? recordProviderEvent(config, {
                provider,
                consumer,
                eventType: "PROBE_SUCCESS",
                statusCode: upstream.statusCode,
                cacheLayer: "upstream",
                durationMs: upstreamDurationMs
              })
            : Promise.resolve(),
          recovered
            ? recordProviderEvent(config, {
                provider,
                consumer,
                eventType: "RECOVERED",
                statusCode: upstream.statusCode,
                cacheLayer: "upstream"
              })
            : Promise.resolve(),
          probeLeaseClaimed
            ? releaseSharedRefresh(config, probeKey)
            : Promise.resolve()
        ]);
      }

      return {
        payload: upstream.payload,
        cacheStatus: "MISS",
        cacheLayer: "upstream",
        ageMs: 0,
        fetchedAt: upstream.fetchedAt,
        upstreamError: null,
        circuitOpen: false,
        recoveryState: recovered ? "RECOVERED" : "CLOSED",
        budget,
        objectsReturned,
        objectPolicy,
        sharedEnabled: Boolean(config)
      };
    } catch (error) {
      const localFailure = noteLocalFailure(provider, error);

      if (config) {
        await Promise.allSettled([
          recordSharedFailure(config, provider, error),
          leaseClaimed ? releaseSharedRefresh(config, key) : Promise.resolve(),
          recordProviderEvent(config, {
            provider,
            consumer,
            eventType: "UPSTREAM_FAILURE",
            statusCode: Number(error?.status || 502),
            cacheLayer: "upstream",
            retryAfterSeconds: error?.retryAfter ?? null,
            durationMs: Math.max(0, nowMs() - upstreamStartedAt)
          }),
          recovering
            ? recordProviderEvent(config, {
                provider,
                consumer,
                eventType: "PROBE_FAILURE",
                statusCode: Number(error?.status || 502),
                cacheLayer: "upstream",
                retryAfterSeconds:
                  localFailure.backoffSeconds ||
                  error?.retryAfter ||
                  null,
                durationMs: Math.max(0, nowMs() - upstreamStartedAt)
              })
            : Promise.resolve(),
          probeLeaseClaimed
            ? releaseSharedRefresh(config, probeKey)
            : Promise.resolve()
        ]);
      }

      const stale = chooseStale({
        local: localEntry(key),
        shared,
        staleMs,
        now: nowMs()
      });
      if (stale) {
        if (config) {
          await Promise.allSettled([
            recordProviderEvent(config, {
              provider,
              consumer,
              eventType: "STALE_SERVED",
              statusCode: Number(error?.status || 502),
              cacheLayer: stale.layer,
              retryAfterSeconds:
                localFailure.backoffSeconds ||
                error?.retryAfter ||
                null
            })
          ]);
        }
        storeLocal(key, stale.payload, stale.fetchedAt);
        return {
          payload: stale.payload,
          cacheStatus: "STALE",
          cacheLayer: stale.layer,
          ageMs: stale.ageMs,
          fetchedAt: stale.fetchedAt,
          upstreamError: {
            status: Number(error?.status || 502),
            message: error instanceof Error ? error.message : String(error),
            retryAfterSeconds: error?.retryAfter ?? null,
            circuitOpen: Boolean(error?.circuitOpen)
          },
          circuitOpen:
            Boolean(error?.circuitOpen) ||
            localFailure.openUntil > nowMs(),
          recoveryState:
            localFailure.openUntil > nowMs()
              ? "BACKOFF"
              : recovering
                ? "HALF_OPEN"
                : "CLOSED",
          budget,
          sharedEnabled: Boolean(config)
        };
      }

      throw error;
    }
  })();

  state.inFlight.set(key, work);
  try {
    return await work;
  } finally {
    if (state.inFlight.get(key) === work) {
      state.inFlight.delete(key);
    }
  }
}

export function resetProviderProtectionForTests() {
  state.entries.clear();
  state.inFlight.clear();
  state.circuits.clear();
  state.probes.clear();
  state.budgets.clear();
  state.usage.value = null;
  state.usage.fetchedAt = 0;
  state.usage.inFlight = null;
}
