/**
 * Chronological NBA first-half spread calibration audit.
 * Imports user-provided REAL historical as-of records; never generates games/odds.
 * No production BUY authorization. Run:
 *   node scripts/nba/backtest-first-half-shadow.mjs --input=path/to/history.csv --output=path/to/report.json
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spreadOutcome, sportsbookEv } from "../../sharp-service/lib/nba-first-half-shadow.js";

export const HEADERS = [
  "game_id", "tipoff_utc", "quote_checked_utc", "sharp_checked_utc",
  "home_spread", "american_odds", "sharp_no_vig_home_cover",
  "pregame_expected_home_margin", "pregame_margin_stddev",
  "halftime_home_score", "halftime_away_score", "rotation_confirmed"
];

export function parseCsv(text) {
  const lines = [];
  let field = "", row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { row.push(field); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(x => x !== "")) lines.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new Error("Unterminated CSV quote");
  row.push(field);
  if (row.some(x => x !== "")) lines.push(row);
  if (lines.length < 2) throw new Error("CSV requires header and at least one observation");
  const header = lines.shift().map(x => x.trim());
  if (new Set(header).size !== header.length) throw new Error("Duplicate CSV columns");
  for (const required of HEADERS) {
    if (!header.includes(required)) throw new Error("Missing column: " + required);
  }
  return lines.map((cells, i) => {
    if (cells.length !== header.length) throw new Error("Bad CSV column count at row " + (i + 2));
    return Object.fromEntries(header.map((name, k) => [name, cells[k].trim()]));
  });
}

function strictNumber(raw, field, id) {
  if (raw == null || String(raw).trim() === "") throw new Error(`${id}: missing ${field}`);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${id}: invalid ${field}`);
  return n;
}
function strictTime(s, field, id) {
  if (typeof s !== "string" || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(s)) {
    throw new Error(`${id}: ${field} requires timezone-aware ISO datetime`);
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new Error(`${id}: invalid ${field}`);
  return t;
}
export function normalizeRows(raw) {
  const seen = new Set();
  return raw.map(r => {
    const id = String(r.game_id || "").trim();
    if (!id || seen.has(id)) throw new Error("Missing or repeated game_id: " + id);
    seen.add(id);
    const tipoff = strictTime(r.tipoff_utc, "tipoff_utc", id);
    const quoteTime = strictTime(r.quote_checked_utc, "quote_checked_utc", id);
    const sharpTime = strictTime(r.sharp_checked_utc, "sharp_checked_utc", id);
    if (quoteTime >= tipoff || sharpTime >= tipoff) throw new Error(id + ": post-tipoff price leakage");
    if (tipoff - quoteTime > 30 * 60000 || tipoff - sharpTime > 30 * 60000) {
      throw new Error(id + ": stale price more than 30 minutes before tipoff");
    }
    const n = field => strictNumber(r[field], field, id);
    const spread = n("home_spread"), odds = n("american_odds");
    const sharpFair = n("sharp_no_vig_home_cover");
    const mean = n("pregame_expected_home_margin"), stddev = n("pregame_margin_stddev");
    const home = n("halftime_home_score"), away = n("halftime_away_score");
    if (odds === 0 || sharpFair <= 0 || sharpFair >= 1 ||
        stddev < 4 || stddev > 30 || !Number.isInteger(home) ||
        !Number.isInteger(away) || home < 0 || away < 0 || home > 130 || away > 130) {
      throw new Error(id + ": implausible odds, variance, or halftime score");
    }
    if (!["true", "false"].includes(String(r.rotation_confirmed).toLowerCase())) {
      throw new Error(id + ": rotation_confirmed must be true or false");
    }
    const margin = home - away;
    const push = Number.isInteger(-spread) && margin === -spread;
    const win = margin > -spread;
    return {
      id, tipoff, quoteTime, sharpTime, spread, odds, sharpFair,
      mean, stddev, margin, push, win,
      rotationConfirmed: String(r.rotation_confirmed).toLowerCase() === "true"
    };
  }).sort((a, b) => a.tipoff - b.tipoff || a.id.localeCompare(b.id));
}

function scoreForecast(p, outcome) {
  const q = Math.min(1 - 1e-12, Math.max(1e-12, p));
  return {brier: (p - outcome) ** 2,
    logLoss: -(outcome ? Math.log(q) : Math.log(1 - q))};
}
function summarizeScores(observations) {
  if (!observations.length) return {count: 0, brier: null, logLoss: null};
  return {count: observations.length,
    brier: observations.reduce((s, x) => s + x.brier, 0) / observations.length,
    logLoss: observations.reduce((s, x) => s + x.logLoss, 0) / observations.length};
}
function calibrationBins(rows) {
  return Array.from({length: 10}, (_, idx) => {
    const set = rows.filter(x => Math.min(9, Math.floor(x.prediction * 10)) === idx);
    return {bin: idx, count: set.length,
      averagePrediction: set.length ? set.reduce((s, x) => s + x.prediction, 0) / set.length : null,
      realizedRate: set.length ? set.reduce((s, x) => s + x.result, 0) / set.length : null};
  });
}

/**
 * Walk-forward calibration of past model residuals. To avoid incorrectly training
 * on same-night results unavailable at earlier tipoffs, only games at least
 * 24 hours old become available for the training window.
 *
 * Importantly, this is residual mean/variance adjustment, not fitting the
 * feature coefficients. All original projected margins must be frozen pregame.
 */
export function auditWalkForward(records, {minimumTrain = 30, minEv = 0.03} = {}) {
  if (!Number.isInteger(minimumTrain) || minimumTrain < 2 || !Number.isFinite(minEv)) {
    throw new Error("Invalid walk-forward settings");
  }
  const rows = [...records].sort((a, b) => a.tipoff - b.tipoff || a.id.localeCompare(b.id));
  const forecastRecords = [];
  let skippedForTraining = 0, skippedRotations = 0, evaluatedPushes = 0;
  for (const r of rows) {
    if (!r.rotationConfirmed) { skippedRotations++; continue; }
    const train = rows.filter(x => x.rotationConfirmed && x.tipoff <= r.tipoff - 86400000);
    if (train.length < minimumTrain) { skippedForTraining++; continue; }
    const residuals = train.map(x => x.margin - x.mean);
    const bias = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    const variance = residuals.reduce((s, x) => s + (x - bias) ** 2, 0) / (residuals.length - 1);
    // Conservative minimum variance and original pregame estimate.
    const distribution = {
      expectedHomeMargin: r.mean + bias,
      marginStdDev: Math.max(4, Math.sqrt(variance), r.stddev)
    };
    const probabilities = spreadOutcome(distribution, r.spread);
    const ev = sportsbookEv(probabilities, r.odds);
    const candidate = ev >= minEv;
    // Record PUSH separately, and use conditional on non-push outcome for
    // a fair apples-to-apples Brier/log-loss comparison with sharp benchmark.
    if (r.push) evaluatedPushes++;
    const usable = !r.push;
    const modelP = probabilities.win / (1 - probabilities.push);
    const sharpP = r.sharpFair; // benchmark MUST match same line and side, no-vig
    forecastRecords.push({
      id: r.id, tipoff: new Date(r.tipoff).toISOString(), homeSpread: r.spread,
      originalMean: r.mean, calibratedMean: distribution.expectedHomeMargin,
      estimatedStdDev: distribution.marginStdDev, trainingRows: train.length,
      winProbability: probabilities.win, pushProbability: probabilities.push,
      lossProbability: probabilities.loss, sharpFairCover: sharpP,
      evPerDollar: ev, shadowCandidate: candidate, outcome: r.push ? "PUSH" : r.win ? "WIN" : "LOSS",
      returnPerDollar: r.push ? 0 : r.win ? (r.odds > 0 ? r.odds / 100 : 100 / -r.odds) : -1,
      ...(usable ? {modelConditionalScore: scoreForecast(modelP, Number(r.win)),
        sharpConditionalScore: scoreForecast(sharpP, Number(r.win)),
        calibrationObservation: {prediction: modelP, result: Number(r.win)}} : {})
    });
  }
  const completed = forecastRecords.filter(r => r.outcome !== "PUSH");
  const candidates = forecastRecords.filter(r => r.shadowCandidate);
  const model = summarizeScores(completed.map(r => r.modelConditionalScore));
  const sharp = summarizeScores(completed.map(r => r.sharpConditionalScore));
  return {
    status: "SHADOW_ONLY", productionEligible: false,
    suppliedRows: rows.length, evaluatedRows: forecastRecords.length,
    skippedForTraining, skippedRotations, evaluatedPushes,
    minimumTrain, trainingLagHours: 24, minimumResearchEv: minEv,
    model, sharp,
    brierImprovement: model.count ? sharp.brier - model.brier : null,
    logLossImprovement: model.count ? sharp.logLoss - model.logLoss : null,
    reliability: calibrationBins(completed.map(r => r.calibrationObservation)),
    shadowCandidates: candidates.length,
    shadowCandidateWinRate: candidates.filter(r => r.outcome !== "PUSH").length ?
      candidates.filter(r => r.outcome === "WIN").length /
      candidates.filter(r => r.outcome !== "PUSH").length : null,
    shadowCandidateRoiPerDollar: candidates.length ?
      candidates.reduce((s, r) => s + r.returnPerDollar, 0) / candidates.length : null,
    note: "Research selection only. Inputs and market fair probabilities must be frozen pregame, with exact line matched.",
    rows: forecastRecords
  };
}

function arg(name) {
  const item = process.argv.find(x => x.startsWith(`--${name}=`));
  return item ? item.slice(name.length + 3) : null;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const input = arg("input"), output = arg("output");
  if (!input || !output) {
    process.stderr.write("Usage: node scripts/nba/backtest-first-half-shadow.mjs --input=history.csv --output=report.json\n");
    process.exitCode = 2;
  } else {
    try {
      const data = normalizeRows(parseCsv(fs.readFileSync(input, "utf8")));
      const report = auditWalkForward(data);
      fs.mkdirSync(path.dirname(output), {recursive: true});
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
      process.stdout.write(JSON.stringify({
        status: report.status, suppliedRows: report.suppliedRows,
        evaluatedRows: report.evaluatedRows, model: report.model, sharp: report.sharp,
        shadowCandidates: report.shadowCandidates
      }) + "\n");
    } catch (e) {
      process.stderr.write("Historical data validation failed: " + e.message + "\n");
      process.exitCode = 1;
    }
  }
}
