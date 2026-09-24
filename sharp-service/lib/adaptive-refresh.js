function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseTime(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : null;
}

function timeBand(minutesUntil) {
  if (minutesUntil == null) return null;
  if (minutesUntil <= 0 && minutesUntil >= -180) {
    return {
      mode: "LIVE_WINDOW",
      seconds: 15,
      reason: "event is in the live window"
    };
  }
  if (minutesUntil <= 30) {
    return {
      mode: "IMMINENT",
      seconds: 20,
      reason: "event starts within 30 minutes"
    };
  }
  if (minutesUntil <= 90) {
    return {
      mode: "NEAR_START",
      seconds: 30,
      reason: "event starts within 90 minutes"
    };
  }
  if (minutesUntil <= 360) {
    return {
      mode: "SAME_DAY",
      seconds: 60,
      reason: "event starts within 6 hours"
    };
  }
  if (minutesUntil <= 1440) {
    return {
      mode: "TODAY",
      seconds: 120,
      reason: "event starts within 24 hours"
    };
  }
  return {
    mode: "DISTANT",
    seconds: 300,
    reason: "no event starts within 24 hours"
  };
}

function defaultBand(priority) {
  if (priority === "critical") {
    return {
      mode: "CRITICAL_IDLE",
      seconds: 45,
      reason: "critical market has no nearer explicit start time"
    };
  }
  if (priority === "background") {
    return {
      mode: "BACKGROUND",
      seconds: 300,
      reason: "background market scan"
    };
  }
  return {
    mode: "NORMAL",
    seconds: 120,
    reason: "normal market scan"
  };
}

export function adaptiveRefreshPolicy({
  live = false,
  startsBefore = null,
  nearestStartAt = null,
  priority = "normal",
  now = Date.now(),
  providerStatus = "HEALTHY",
  recoveryState = "CLOSED",
  objectUsagePct = null
} = {}) {
  const rawPriority = String(priority || "").toLowerCase();
  const normalizedPriority = ["critical", "normal", "background"].includes(
    rawPriority
  )
    ? rawPriority
    : "normal";

  let band;
  let minutesUntil = null;

  if (live === true || String(live) === "true") {
    band = {
      mode: "LIVE",
      seconds: 15,
      reason: "live market"
    };
  } else {
    const target =
      parseTime(nearestStartAt) ??
      parseTime(startsBefore);

    if (target != null) {
      minutesUntil = Number(((target - now) / 60000).toFixed(1));
      band = timeBand(minutesUntil);
    } else {
      band = defaultBand(normalizedPriority);
    }
  }

  let seconds = band.seconds;
  const slowdowns = [];

  const recovery = String(recoveryState || "").toUpperCase();
  const provider = String(providerStatus || "").toUpperCase();
  const usage = Number(objectUsagePct);

  if (
    recovery === "BACKOFF" ||
    recovery === "HALF_OPEN" ||
    provider === "DEGRADED"
  ) {
    seconds = Math.max(seconds, 120);
    slowdowns.push("provider recovery");
  }

  if (Number.isFinite(usage)) {
    if (usage >= 95) {
      seconds = Math.max(seconds, 180);
      slowdowns.push("critical object pressure");
    } else if (usage >= 85) {
      seconds = Math.max(seconds, 120);
      slowdowns.push("high object pressure");
    } else if (usage >= 70) {
      seconds = Math.max(seconds, 60);
      slowdowns.push("moderate object pressure");
    }
  }

  seconds = clamp(Math.round(seconds), 15, 300);

  const nearest = parseTime(nearestStartAt);

  return {
    mode: band.mode,
    suggestedSeconds: seconds,
    freshMs: seconds * 1000,
    staleMs: Math.max(5 * 60 * 1000, seconds * 4 * 1000),
    priority: normalizedPriority,
    nearestStartAt:
      nearest != null ? new Date(nearest).toISOString() : null,
    minutesUntil,
    reason:
      slowdowns.length > 0
        ? band.reason + "; slowed by " + slowdowns.join(" + ")
        : band.reason,
    slowedBy: slowdowns
  };
}

export function nearestCandidateStart(candidates = [], now = Date.now()) {
  const starts = candidates
    .map((row) => parseTime(row?.starts_at || row?.startsAt))
    .filter((value) => value != null && value >= now - 3 * 60 * 60 * 1000)
    .sort((a, b) => Math.abs(a - now) - Math.abs(b - now));

  return starts.length ? new Date(starts[0]).toISOString() : null;
}
