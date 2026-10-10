import {sharpQuoteTimestamp} from './sharp-quote-age.mjs';
function keyOf(row) {
  const line =
    row.market_line ?? row.line ?? null;
  const lineKey =
    line === null || line === undefined ? "" : String(Number(line));
  return [
    row.event_id ?? "",
    row.market_type ?? "moneyline",
    row.market_side ?? row.side_key ?? "",
    lineKey,
  ].join("|");
}

function inFinalWindow(startsAt, minutes = 20, now = Date.now()) {
  const t = Date.parse(startsAt || "");
  if (!Number.isFinite(t)) return false;
  return t - now <= minutes * 60_000;
}

function freshnessTargets(startsAt, now = Date.now()) {
  const t = Date.parse(startsAt || "");
  const minutesToStart = Number.isFinite(t)
    ? (t - now) / 60000
    : null;

  if (minutesToStart !== null && minutesToStart <= 20) {
    return { minutesToStart, market: 2, sharp: 3, verification: 5, weather: 10, fusion: 5 };
  }
  if (minutesToStart !== null && minutesToStart <= 90) {
    return { minutesToStart, market: 5, sharp: 5, verification: 10, weather: 15, fusion: 10 };
  }
  if (minutesToStart !== null && minutesToStart <= 360) {
    return { minutesToStart, market: 15, sharp: 15, verification: 30, weather: 45, fusion: 30 };
  }
  return { minutesToStart, market: 30, sharp: 30, verification: 60, weather: 90, fusion: 60 };
}

function timestampAgeMinutes(value, now = Date.now()) {
  const t = Date.parse(String(value || ""));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / 60000);
}

function componentFreshness(
  name,
  timestamp,
  targetMinutes,
  weight,
  required,
  hardRequired,
  now = Date.now(),
) {
  const ageMinutes = timestampAgeMinutes(timestamp, now);
  let score = 100;

  if (ageMinutes === null) {
    score = required ? 0 : 100;
  } else if (ageMinutes <= targetMinutes * 0.5) {
    score = 100;
  } else if (ageMinutes <= targetMinutes) {
    score = 100 - ((ageMinutes / targetMinutes - 0.5) * 60);
  } else if (ageMinutes <= targetMinutes * 2) {
    score = 70 - ((ageMinutes / targetMinutes - 1) * 40);
  } else {
    score = 0;
  }

  return {
    name,
    timestamp: timestamp || null,
    ageMinutes:
      ageMinutes === null ? null : Number(ageMinutes.toFixed(1)),
    targetMinutes,
    score: Number(Math.max(0, Math.min(100, score)).toFixed(1)),
    weight,
    required,
    hardStale:
      hardRequired &&
      (ageMinutes === null || ageMinutes > targetMinutes * 2),
  };
}

function gradeForScore(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}

function buildFreshness(
  startsAt,
  components,
) {
  const included = components.filter(
    (x) => x.required || x.timestamp,
);
  const weight = included.reduce(
    (sum, x) => sum + Number(x.weight || 0),
    0,
);
  const score = weight > 0
    ? included.reduce(
        (sum, x) => sum + Number(x.score || 0) * Number(x.weight || 0),
        0,
) / weight
    : 0;
  const hardStale = included.filter((x) => x.hardStale);
  const staleComponents = included
    .filter(
      (x) =>
        x.ageMinutes === null ||
        Number(x.ageMinutes) > Number(x.targetMinutes),
)
    .map((x) => x.name);

  return {
    score: Number(score.toFixed(1)),
    grade: gradeForScore(score),
    hardStale: hardStale.length > 0,
    hardStaleComponents: hardStale.map((x) => x.name),
    staleComponents,
    components,
    startsAt,
  };
}

function applyFreshnessGate(
  status,
  reason,
  freshness,
  startsAt,
  now = Date.now(),
) {
  const originalStatus = status;
  const finalWindow = inFinalWindow(startsAt, 20, now);
  let next = status;
  let action = "KEEP";

  if (status === "PLAY") {
    if (freshness.hardStale || freshness.score < 65) {
      next = "PASS";
      action = "PASS_STALE";
    } else if (freshness.score < 80) {
      next = finalWindow ? "PASS" : "PENDING";
      action = finalWindow ? "PASS_STALE" : "DOWNGRADE_PENDING";
    }
  } else if (
    status === "PENDING" &&
    finalWindow &&
    (freshness.hardStale || freshness.score < 80)
) {
    next = "PASS";
    action = "PASS_STALE";
  }

  const staleText = freshness.staleComponents.length
    ? " Stale/aging: " + freshness.staleComponents.join(", ") + "."
    : "";
  const gateText =
    action === "KEEP"
      ? ""
      : " Freshness gate changed " +
        originalStatus +
        " to " +
        next +
        " (grade " +
        freshness.grade +
        ", " +
        freshness.score +
        "/100)." +
        staleText;

  return {
    status: next,
    reason: (String(reason || "") + gateText).trim(),
    action,
    originalStatus,
  };
}



export function evaluateTeamCard(g,context={},now=Date.now()) {
      const sharp = context.sharp ?? null;
      let status = "PASS";
      let reason = g.reason || "";
      let resolutionSource = "non_sharp";

      if (g.non_sharp_status === "PASS") {
        status = "PASS";
      } else if (g.non_sharp_status === "PENDING") {
        status = inFinalWindow(g.starts_at, 20, now) ? "PASS" : "PENDING";
        if (status === "PASS") {
          reason =
            reason ||
            "Required information was still unavailable in the final pregame window.";
        }
      } else if (g.non_sharp_status === "READY_FOR_SHARP_CHECK") {
        const sharpFresh =
          sharp &&
          Date.parse(sharp.checked_at || "") >=
            Date.parse(g.captured_at || "") - 2 * 60_000;

        if (sharpFresh && sharp.final_status === "FINAL_PLAY") {
          status = "PLAY";
          reason = sharp.reason || "Cleared the complete sharp gate.";
          resolutionSource = "sharp_gate";
        } else if (sharpFresh && sharp.final_status === "PASS") {
          status = "PASS";
          reason = sharp.reason || "Failed the final sharp gate.";
          resolutionSource = "sharp_gate";
        } else if (inFinalWindow(g.starts_at, 20, now)) {
          status = "PASS";
          reason =
            sharp?.reason ||
            "Sharp confirmation was not completed before the final pregame deadline.";
          resolutionSource = "deadline";
        } else {
          status = "PENDING";
          reason =
            sharp?.reason ||
            "All model/context checks passed; waiting for final sharp confirmation.";
          resolutionSource = sharp ? "sharp_gate_pending" : "awaiting_sharp";
        }
      }

      const verification = context.verification ?? null;
      const weather = context.weather ?? null;
      const fusion = context.fusion ?? null;
      const timing = context.timing ?? null;
      const targets = freshnessTargets(g.starts_at, now);
      const nearGame =
        targets.minutesToStart !== null &&
        targets.minutesToStart <= 90;
      const sharpRequired =
        status === "PLAY" ||
        g.non_sharp_status === "READY_FOR_SHARP_CHECK";
      const freshness = buildFreshness(
        g.starts_at,
        [
          componentFreshness(
            "market",
            g.captured_at,
            targets.market,
            35,
            true,
            true,
            now,
),
          componentFreshness(
            "sharp",
            sharpQuoteTimestamp(sharp),
            targets.sharp,
            25,
            sharpRequired,
            sharpRequired,
            now,
),
          componentFreshness(
            "lineup",
            verification?.evaluated_at,
            targets.verification,
            20,
            true,
            nearGame,
            now,
),
          componentFreshness(
            "weather",
            weather?.evaluated_at,
            targets.weather,
            15,
            true,
            nearGame,
            now,
),
          componentFreshness(
            "fusion",
            fusion?.evaluated_at || fusion?.source_captured_at,
            targets.fusion,
            5,
            false,
            false,
            now,
),
        ],
);
      const freshnessDecision = applyFreshnessGate(
        status,
        reason,
        freshness,
        g.starts_at,
        now,
);
      status = freshnessDecision.status;
      reason = freshnessDecision.reason;
      if (freshnessDecision.action !== "KEEP") {
        resolutionSource = "freshness_gate";
      }

      return {
        ...g,
        status,
        reason,
        resolutionSource,
        freshness: {
          ...freshness,
          action: freshnessDecision.action,
          originalStatus: freshnessDecision.originalStatus,
        },
        sharpGate: sharp,
        sharpDisagreement: context.sharpDisagreement ?? null,
        uncertainty: context.uncertainty ?? null,
        priceSensitivity: context.priceSensitivity ?? null,
        verificationGate: verification,
        weatherParkImpact: weather,
        decisionFusion: fusion,
        decisionTiming: timing,
      };
}
export function evaluatePropCard(row,context={},now=Date.now()) {
const {verificationGate=null,weatherParkImpact=null,decisionFusion=null,marketClv=null,decisionTiming=null}=context;
      const targets = freshnessTargets(row.starts_at, now);
      const nearGame =
        targets.minutesToStart !== null &&
        targets.minutesToStart <= 90;
      const freshness = buildFreshness(
        row.starts_at,
        [
          componentFreshness(
            "prop_market",
            row.captured_at,
            targets.market,
            40,
            true,
            true,
            now,
),
          componentFreshness(
            "lineup_role",
            verificationGate?.evaluated_at,
            targets.verification,
            25,
            true,
            nearGame,
            now,
),
          componentFreshness(
            "weather",
            weatherParkImpact?.evaluated_at,
            targets.weather,
            15,
            true,
            nearGame,
            now,
),
          componentFreshness(
            "fusion",
            decisionFusion?.evaluated_at ||
              decisionFusion?.source_captured_at,
            targets.fusion,
            10,
            false,
            false,
            now,
),
          componentFreshness(
            "decision_timing",
            decisionTiming?.captured_at,
            targets.fusion,
            10,
            false,
            false,
            now,
),
        ],
);
      const freshnessDecision = applyFreshnessGate(
        row.status,
        row.reason,
        freshness,
        row.starts_at,
        now,
);
      return {
        ...row,
        status: freshnessDecision.status,
        reason: freshnessDecision.reason,
        freshness: {
          ...freshness,
          action: freshnessDecision.action,
          originalStatus: freshnessDecision.originalStatus,
        },
        verificationGate,
        weatherParkImpact,
        decisionFusion,
        marketClv,
        decisionTiming,
      };

}
