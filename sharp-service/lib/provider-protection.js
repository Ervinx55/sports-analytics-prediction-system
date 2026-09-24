import { createHash } from "node:crypto";

const DEFAULT_PROVIDER = "sportsgameodds";
const DEFAULT_SUPABASE_URL = "https://yeoxroijaptomomshdii.supabase.co";
const MAX_LOCAL_ENTRIES = 100;

const state =
  globalThis.__edgeLabProviderProtection ||
  (globalThis.__edgeLabProviderProtection = {
    entries: new Map(),
    inFlight: new Map(),
    circuits: new Map()
  });

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function nowMs() {
  return Date.now();
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
    )}&select=provider,consecutive_failures,opened_until,last_status,last_error,last_failure_at&limit=1`
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

async function recordProviderEvent(config, {
  provider,
  consumer,
  eventType,
  statusCode = null,
  cacheLayer = null,
  retryAfterSeconds = null,
  durationMs = null
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
      details: {}
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
      lastError: null
    }
  );
}

function noteLocalSuccess(provider) {
  state.circuits.set(provider, {
    failures: 0,
    openUntil: 0,
    lastStatus: null,
    lastError: null
  });
}

function noteLocalFailure(provider, error) {
  const current = localCircuit(provider);
  const status = Number(error?.status || 502);
  const failures = current.failures + 1;
  let openUntil = current.openUntil || 0;

  if (status === 429) {
    const seconds = clamp(Number(error?.retryAfter ?? 60), 1, 300);
    openUntil = Math.max(openUntil, nowMs() + seconds * 1000);
  } else if (status >= 500 && status <= 599 && failures >= 3) {
    openUntil = Math.max(openUntil, nowMs() + 30_000);
  }

  state.circuits.set(provider, {
    failures,
    openUntil,
    lastStatus: status,
    lastError: error instanceof Error ? error.message : String(error)
  });
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
  return {
    openUntil: Number.isFinite(openedUntil) ? openedUntil : 0,
    lastStatus: row?.last_status ?? null,
    lastError: row?.last_error ?? null
  };
}

function strongestCircuit(local, shared) {
  const sharedCircuit = circuitFromShared(shared);
  return sharedCircuit.openUntil > local.openUntil ? sharedCircuit : local;
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

async function fetchUpstream(url, apiKey, timeoutMs) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
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
      if (attempt === 0) {
        await sleep(400);
        continue;
      }
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

    if (attempt === 0 && (retryableServerError || shortRateLimit)) {
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
  consumer = "unknown"
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

    const upstreamStartedAt = nowMs();
    try {
      const upstream = await fetchUpstream(url, apiKey, timeoutMs);
      const upstreamDurationMs = Math.max(0, nowMs() - upstreamStartedAt);
      storeLocal(key, upstream.payload, upstream.fetchedAt);
      noteLocalSuccess(provider);

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
            durationMs: upstreamDurationMs
          })
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
        sharedEnabled: Boolean(config)
      };
    } catch (error) {
      noteLocalFailure(provider, error);

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
          })
        ]);
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
            status: Number(error?.status || 502),
            message: error instanceof Error ? error.message : String(error),
            retryAfterSeconds: error?.retryAfter ?? null,
            circuitOpen: Boolean(error?.circuitOpen)
          },
          circuitOpen: Boolean(error?.circuitOpen),
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
}
