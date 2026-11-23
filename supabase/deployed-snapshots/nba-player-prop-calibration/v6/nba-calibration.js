function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function outcomeTarget(outcome) {
  if (outcome === "W") return 1;
  if (outcome === "L") return 0;
  return null;
}

function brier(rows, field) {
  const usable = rows
    .map((row) => ({
      probability: num(row?.[field]),
      target: outcomeTarget(row?.outcome)
    }))
    .filter(
      (row) =>
        row.probability !== null &&
        row.target !== null
    );

  if (!usable.length) return null;

  return usable.reduce((sum, row) => {
    const diff = row.probability - row.target;
    return sum + diff * diff;
  }, 0) / usable.length;
}

function logLoss(rows, field) {
  const usable = rows
    .map((row) => ({
      probability: num(row?.[field]),
      target: outcomeTarget(row?.outcome)
    }))
    .filter(
      (row) =>
        row.probability !== null &&
        row.target !== null
    );

  if (!usable.length) return null;

  return usable.reduce((sum, row) => {
    const p = Math.max(
      1e-6,
      Math.min(1 - 1e-6, row.probability)
    );
    return (
      sum -
      (
        row.target * Math.log(p) +
        (1 - row.target) * Math.log(1 - p)
      )
    );
  }, 0) / usable.length;
}

function avg(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length
    ? usable.reduce((sum, value) => sum + value, 0) / usable.length
    : null;
}

function probabilityBucket(value) {
  const p = num(value);
  if (p === null) return "NO_PROBABILITY";
  const low = Math.floor(p * 10) / 10;
  const high = Math.min(1, low + 0.1);
  return `${low.toFixed(1)}-${high.toFixed(1)}`;
}

function calibrationBuckets(rows, field) {
  const groups = new Map();

  for (const row of rows) {
    const p = num(row?.[field]);
    const target = outcomeTarget(row?.outcome);
    if (p === null || target === null) continue;

    const key = probabilityBucket(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ p, target });
  }

  return Object.fromEntries(
    [...groups.entries()].map(([key, values]) => {
      const meanProbability = avg(values.map((row) => row.p));
      const winRate = avg(values.map((row) => row.target));
      return [
        key,
        {
          rows: values.length,
          meanProbability:
            meanProbability === null
              ? null
              : Number(meanProbability.toFixed(4)),
          observedWinRate:
            winRate === null
              ? null
              : Number(winRate.toFixed(4)),
          calibrationGapPp:
            meanProbability === null || winRate === null
              ? null
              : Number(
                  (
                    (meanProbability - winRate) *
                    100
                  ).toFixed(3)
                )
        }
      ];
    })
  );
}

function summarize(rows) {
  const graded = rows.filter((row) =>
    ["W", "L", "PUSH", "VOID"].includes(
      String(row?.outcome || "")
    )
  );
  const decisive = graded.filter((row) =>
    ["W", "L"].includes(String(row?.outcome || ""))
  );
  const wins = decisive.filter((row) => row.outcome === "W").length;
  const losses = decisive.filter((row) => row.outcome === "L").length;
  const pushes = graded.filter((row) => row.outcome === "PUSH").length;
  const voids = graded.filter((row) => row.outcome === "VOID").length;

  const rawBrier = brier(decisive, "rawProbability");
  const contextBrier = brier(decisive, "contextProbability");
  const marketBrier = brier(decisive, "marketProbability");

  const rawLogLoss = logLoss(decisive, "rawProbability");
  const contextLogLoss = logLoss(decisive, "contextProbability");
  const marketLogLoss = logLoss(decisive, "marketProbability");

  return {
    rows: rows.length,
    graded: graded.length,
    decisive: decisive.length,
    wins,
    losses,
    pushes,
    voids,
    winRate:
      wins + losses
        ? Number((wins / (wins + losses)).toFixed(4))
        : null,
    brier: {
      raw:
        rawBrier === null ? null : Number(rawBrier.toFixed(6)),
      context:
        contextBrier === null ? null : Number(contextBrier.toFixed(6)),
      market:
        marketBrier === null ? null : Number(marketBrier.toFixed(6)),
      contextImprovementVsRaw:
        rawBrier === null || contextBrier === null
          ? null
          : Number((rawBrier - contextBrier).toFixed(6)),
      contextImprovementVsMarket:
        marketBrier === null || contextBrier === null
          ? null
          : Number((marketBrier - contextBrier).toFixed(6))
    },
    logLoss: {
      raw:
        rawLogLoss === null ? null : Number(rawLogLoss.toFixed(6)),
      context:
        contextLogLoss === null ? null : Number(contextLogLoss.toFixed(6)),
      market:
        marketLogLoss === null ? null : Number(marketLogLoss.toFixed(6))
    },
    sampleStatus:
      decisive.length >= 250
        ? "EVALUABLE"
        : decisive.length >= 75
        ? "EARLY"
        : "INSUFFICIENT_SAMPLE"
  };
}

function group(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(keyFn(row) ?? "UNKNOWN");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return Object.fromEntries(
    [...groups.entries()].map(([key, values]) => [
      key,
      summarize(values)
    ])
  );
}

function marketIntegrityState(raw) {
  const integrity = raw?.marketIntegrity;
  if (!integrity) return "UNKNOWN";
  if (integrity.blocked) return "BLOCKED";
  const score = num(integrity.score);
  if (score === null) return "UNKNOWN";
  if (score >= 0.9) return "STRONG";
  if (score >= 0.7) return "OK";
  return "WEAK";
}

function roleState(raw) {
  if (raw?.roleChangeDetected === true) return "ROLE_CHANGE";
  const stability = num(raw?.roleStability);
  if (stability === null) return "UNKNOWN";
  if (stability >= 0.85) return "STABLE";
  if (stability >= 0.7) return "MIXED";
  return "UNSTABLE";
}

export {
  num,
  outcomeTarget,
  brier,
  logLoss,
  probabilityBucket,
  calibrationBuckets,
  summarize,
  group,
  marketIntegrityState,
  roleState
};
