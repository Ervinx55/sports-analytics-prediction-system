import {
  PLAYER_PROP_TF_SHADOW_BUNDLE as BUNDLE
} from "../ml/player-prop-tf-shadow-bundle.js";

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sigmoid(x) {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function activation(name, value) {
  if (name === "relu") return Math.max(0, value);
  if (name === "sigmoid") return sigmoid(value);
  return value;
}

function dense(input, layer) {
  const out = Array(layer.bias.length).fill(0);
  for (let j = 0; j < out.length; j += 1) {
    let value = Number(layer.bias[j] || 0);
    for (let i = 0; i < input.length; i += 1) {
      value += Number(input[i] || 0) * Number(layer.kernel[i]?.[j] || 0);
    }
    out[j] = activation(layer.activation, value);
  }
  return out;
}

function rowValue(row, feature, nowMs) {
  const map = {
    line: row.line,
    model_mean: row.modelMean,
    raw_independent_probability: row.rawIndependentProbability,
    model_probability: row.modelProbability,
    push_probability: row.pushProbability,
    market_fair_probability: row.marketFairProbability,
    edge_pct_points: row.edgePctPoints,
    best_odds: row.bestOdds,
    exact_line_book_count: row.exactLineBookCount,
    paired_books: row.pairedBooks,
    ev_pct: row.evPct,
    data_quality: row.dataQuality
  };
  if (feature !== "minutes_to_start") return num(map[feature]);

  const starts = Date.parse(row.startsAt || "");
  if (!Number.isFinite(starts)) return null;
  return Math.max(0, Math.min(1440, (starts - nowMs) / 60000));
}

function transformedInput(row, nowMs) {
  const values = [];

  for (let i = 0; i < BUNDLE.numericFeatures.length; i += 1) {
    const feature = BUNDLE.numericFeatures[i];
    const mean = Number(BUNDLE.numericMean[i] || 0);
    const scale = Number(BUNDLE.numericScale[i] || 1) || 1;
    const raw = rowValue(row, feature, nowMs);
    const value = raw === null ? mean : raw;
    values.push((value - mean) / scale);
  }

  const categoricalValues = {
    stat_id: String(row.statID || ""),
    side: String(row.side || "")
  };

  for (let i = 0; i < BUNDLE.categoricalFeatures.length; i += 1) {
    const feature = BUNDLE.categoricalFeatures[i];
    const current = categoricalValues[feature] || "";
    for (const category of BUNDLE.categoricalCategories[i] || []) {
      values.push(current === String(category) ? 1 : 0);
    }
  }

  return values;
}

export function tensorflowShadowMetadata() {
  return {
    modelVersion: BUNDLE.model,
    mode: BUNDLE.mode,
    eligibleForProduction: Boolean(BUNDLE.eligibleForProduction),
    productionWeight: Number(BUNDLE.productionWeight || 0),
    selectedValidationWeight: Number(BUNDLE.selectedValidationWeight || 0),
    coverage: BUNDLE.coverage,
    testMetrics: BUNDLE.testMetrics
  };
}

export function scorePlayerPropTensorflowShadow(row, nowMs = Date.now()) {
  const champion = num(row?.modelProbability);
  const market = num(row?.marketFairProbability);
  if (
    champion === null ||
    market === null ||
    !row?.statID ||
    !row?.side
  ) {
    return {
      ...tensorflowShadowMetadata(),
      available: false,
      affectsDecision: false,
      probability: null,
      ensembleProbability: champion,
      reason: "required shadow-model features are missing"
    };
  }

  let layer = transformedInput(row, nowMs);
  for (const spec of BUNDLE.layers) {
    layer = dense(layer, spec);
  }

  const probability = num(layer[0]);
  const eligible = Boolean(BUNDLE.eligibleForProduction);
  const productionWeight = eligible
    ? Number(BUNDLE.productionWeight || 0)
    : 0;
  const ensembleProbability =
    probability === null
      ? champion
      : (1 - productionWeight) * champion +
        productionWeight * probability;

  return {
    ...tensorflowShadowMetadata(),
    available: probability !== null,
    affectsDecision: eligible && productionWeight > 0,
    probability:
      probability === null ? null : Number(probability.toFixed(6)),
    ensembleProbability:
      ensembleProbability === null
        ? null
        : Number(ensembleProbability.toFixed(6)),
    championProbability: champion,
    marketProbability: market,
    probabilityDeltaVsChampion:
      probability === null
        ? null
        : Number((probability - champion).toFixed(6)),
    reason:
      eligible && productionWeight > 0
        ? "promoted ensemble challenger"
        : "shadow-only challenger; zero production weight"
  };
}
