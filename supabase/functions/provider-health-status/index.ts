import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function adminKey() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (parsed?.default) return String(parsed.default);
    } catch {
      // Fall through to legacy key.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function pct(n: number, d: number) {
  return d > 0 ? Number(((n / d) * 100).toFixed(1)) : null;
}

function ageMinutes(value: unknown) {
  const t = Date.parse(String(value || ""));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Number(((Date.now() - t) / 60000).toFixed(1)));
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "GET only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const hours = Math.max(1, Math.min(168, Number(url.searchParams.get("hours") || 24)));
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const nowIso = new Date().toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      adminKey(),
    );

    const [eventsResult, cacheResult, circuitResult, locksResult, budgetResult] =
      await Promise.all([
        supabase
          .from("provider_request_events")
          .select("provider,consumer,event_type,status_code,cache_layer,retry_after_seconds,duration_ms,details,occurred_at")
          .gte("occurred_at", since)
          .order("occurred_at", { ascending: false })
          .limit(5000),
        supabase
          .from("provider_response_cache")
          .select("provider,fetched_at,expires_at,stale_until,updated_at")
          .order("fetched_at", { ascending: false })
          .limit(1000),
        supabase
          .from("provider_circuit_state")
          .select("provider,consecutive_failures,opened_until,last_status,last_error,last_failure_at,backoff_seconds,last_probe_at,last_success_at,recovery_count,updated_at"),
        supabase
          .from("provider_refresh_locks")
          .select("provider,locked_until,updated_at")
          .gt("locked_until", nowIso),
        supabase
          .from("provider_request_budget_state")
          .select("provider,tokens,capacity,refilled_at,last_claim_at,last_denied_at,claimed_count,denied_count,updated_at"),
      ]);

    for (const result of [
      eventsResult,
      cacheResult,
      circuitResult,
      locksResult,
      budgetResult,
    ]) {
      if (result.error) throw result.error;
    }

    const events = eventsResult.data ?? [];
    const cacheRows = cacheResult.data ?? [];
    const circuits = circuitResult.data ?? [];
    const locks = locksResult.data ?? [];
    const budgetRows = budgetResult.data ?? [];

    const count = (type: string) =>
      events.filter((row: any) => row.event_type === type).length;

    const upstreamSuccesses = count("UPSTREAM_SUCCESS");
    const upstreamFailures = count("UPSTREAM_FAILURE");
    const upstreamAttempts = upstreamSuccesses + upstreamFailures;
    const rateLimits = events.filter(
      (row: any) =>
        row.event_type === "UPSTREAM_FAILURE" &&
        Number(row.status_code) === 429,
    ).length;
    const serverErrors = events.filter(
      (row: any) =>
        row.event_type === "UPSTREAM_FAILURE" &&
        Number(row.status_code) >= 500,
    ).length;
    const staleServes = count("STALE_SERVED");
    const sharedHits = count("SHARED_HIT");
    const circuitBlocks = count("CIRCUIT_BLOCKED");
    const probesStarted = count("PROBE_STARTED");
    const probeSuccesses = count("PROBE_SUCCESS");
    const probeFailures = count("PROBE_FAILURE");
    const recoveries = count("RECOVERED");
    const budgetBlocks = count("BUDGET_BLOCKED");
    const criticalBudgetBlocks = events.filter(
      (row: any) =>
        row.event_type === "BUDGET_BLOCKED" &&
        String(row.details?.priority || "") === "critical",
    ).length;

    const now = Date.now();
    let freshCacheRows = 0;
    let staleCacheRows = 0;
    let expiredCacheRows = 0;

    for (const row of cacheRows as any[]) {
      const expires = Date.parse(String(row.expires_at || ""));
      const staleUntil = Date.parse(String(row.stale_until || ""));
      if (Number.isFinite(expires) && expires > now) freshCacheRows += 1;
      else if (Number.isFinite(staleUntil) && staleUntil > now) staleCacheRows += 1;
      else expiredCacheRows += 1;
    }

    const providerStates = (circuits as any[]).map((row) => {
      const openedUntilMs = Date.parse(String(row.opened_until || ""));
      const isOpen = Number.isFinite(openedUntilMs) && openedUntilMs > now;
      const failures = Number(row.consecutive_failures || 0);
      const state = isOpen
        ? "BACKOFF"
        : failures > 0
          ? "HALF_OPEN"
          : "CLOSED";

      return {
        provider: row.provider,
        state,
        consecutiveFailures: failures,
        openedUntil: row.opened_until,
        backoffSeconds: Number(row.backoff_seconds || 0),
        lastStatus: row.last_status,
        lastFailureAt: row.last_failure_at,
        lastProbeAt: row.last_probe_at,
        lastSuccessAt: row.last_success_at,
        recoveryCount: Number(row.recovery_count || 0),
      };
    });

    const openCircuits = providerStates.filter(
      (row) => row.state === "BACKOFF",
    );
    const halfOpenCircuits = providerStates.filter(
      (row) => row.state === "HALF_OPEN",
    );

    const lastHour = events.filter((row: any) => {
      const t = Date.parse(String(row.occurred_at || ""));
      return Number.isFinite(t) && t >= now - 3600_000;
    });
    const recentRateLimits = lastHour.filter(
      (row: any) =>
        row.event_type === "UPSTREAM_FAILURE" &&
        Number(row.status_code) === 429,
    ).length;
    const recentStale = lastHour.filter(
      (row: any) => row.event_type === "STALE_SERVED",
    ).length;
    const recentCriticalBudgetBlocks = lastHour.filter(
      (row: any) =>
        row.event_type === "BUDGET_BLOCKED" &&
        String(row.details?.priority || "") === "critical",
    ).length;

    let status = "IDLE";
    if (openCircuits.length > 0) status = "DEGRADED";
    else if (
      halfOpenCircuits.length > 0 ||
      recentRateLimits > 0 ||
      recentStale > 0 ||
      recentCriticalBudgetBlocks > 0
    ) status = "WATCH";
    else if (events.length > 0 || cacheRows.length > 0) status = "HEALTHY";

    const byConsumer: Record<string, Record<string, number>> = {};
    for (const row of events as any[]) {
      const consumer = String(row.consumer || "unknown");
      const type = String(row.event_type || "UNKNOWN");
      byConsumer[consumer] ||= {};
      byConsumer[consumer][type] = (byConsumer[consumer][type] || 0) + 1;
    }

    const recentIncidents = (events as any[])
      .filter((row) =>
        [
          "UPSTREAM_FAILURE",
          "STALE_SERVED",
          "CIRCUIT_BLOCKED",
          "PROBE_STARTED",
          "PROBE_FAILURE",
          "RECOVERED",
          "BUDGET_BLOCKED",
        ].includes(String(row.event_type))
      )
      .slice(0, 20)
      .map((row) => ({
        occurredAt: row.occurred_at,
        provider: row.provider,
        consumer: row.consumer,
        type: row.event_type,
        statusCode: row.status_code,
        cacheLayer: row.cache_layer,
        retryAfterSeconds: row.retry_after_seconds,
        priority: row.details?.priority ?? null,
      }));

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        hours,
        status,
        sharedActivityDetected:
          events.length > 0 || cacheRows.length > 0 || circuits.length > 0,
        summary: {
          observedEvents: events.length,
          upstreamAttempts,
          upstreamSuccesses,
          upstreamFailures,
          upstreamSuccessRatePct: pct(upstreamSuccesses, upstreamAttempts),
          rateLimits,
          serverErrors,
          staleServes,
          sharedHits,
          circuitBlocks,
          probesStarted,
          probeSuccesses,
          probeFailures,
          recoveries,
          budgetBlocks,
          criticalBudgetBlocks,
          activeRefreshLocks: locks.length,
          cacheRows: cacheRows.length,
          freshCacheRows,
          staleCacheRows,
          expiredCacheRows,
        },
        latest: {
          eventAt: events[0]?.occurred_at ?? null,
          upstreamSuccessAt:
            events.find((row: any) => row.event_type === "UPSTREAM_SUCCESS")
              ?.occurred_at ?? null,
          upstreamFailureAt:
            events.find((row: any) => row.event_type === "UPSTREAM_FAILURE")
              ?.occurred_at ?? null,
          sharedHitAt:
            events.find((row: any) => row.event_type === "SHARED_HIT")
              ?.occurred_at ?? null,
          cacheFetchAt: cacheRows[0]?.fetched_at ?? null,
          cacheAgeMinutes: ageMinutes(cacheRows[0]?.fetched_at),
        },
        circuit: {
          open: openCircuits.length > 0,
          halfOpen: halfOpenCircuits.length > 0,
          providers: providerStates,
        },
        requestBudget: {
          shared: budgetRows.length > 0,
          blockEvents24h: budgetBlocks,
          criticalBlockEvents24h: criticalBudgetBlocks,
          recentCriticalBlocks1h: recentCriticalBudgetBlocks,
          totalClaims: (budgetRows as any[]).reduce(
            (sum, row) => sum + Number(row.claimed_count || 0),
            0,
          ),
          totalDenials: (budgetRows as any[]).reduce(
            (sum, row) => sum + Number(row.denied_count || 0),
            0,
          ),
          providers: (budgetRows as any[]).map((row) => {
            const capacity = Number(row.capacity || 0);
            const storedTokens = Number(row.tokens || 0);
            const refilledAt = Date.parse(String(row.refilled_at || ""));
            const elapsedMs = Number.isFinite(refilledAt)
              ? Math.max(0, now - refilledAt)
              : 0;
            const tokens = Math.min(
              capacity,
              storedTokens + elapsedMs * (capacity / 60_000),
            );

            return {
              provider: row.provider,
              capacity,
              tokensRemaining: Number(tokens.toFixed(2)),
              lastClaimAt: row.last_claim_at,
              lastDeniedAt: row.last_denied_at,
              claimedCount: Number(row.claimed_count || 0),
              deniedCount: Number(row.denied_count || 0),
            };
          }),
        },
        selfHealing: {
          state:
            openCircuits.length > 0
              ? "BACKOFF"
              : halfOpenCircuits.length > 0
                ? "HALF_OPEN"
                : recoveries > 0
                  ? "RECOVERED"
                  : "CLOSED",
          probesStarted,
          probeSuccesses,
          probeFailures,
          recoveries,
          nextProbeAt:
            openCircuits
              .map((row) => row.openedUntil)
              .filter(Boolean)
              .sort()[0] ?? null,
          maxBackoffSeconds:
            providerStates.reduce(
              (max, row) => Math.max(max, Number(row.backoffSeconds || 0)),
              0,
            ),
        },
        byConsumer,
        recentIncidents,
      }),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=15",
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
});