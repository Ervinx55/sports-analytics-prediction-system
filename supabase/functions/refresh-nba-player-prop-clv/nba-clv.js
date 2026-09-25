function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function implied(odds) {
  const value = num(odds);
  if (value === null || value === 0) return null;
  return value > 0
    ? 100 / (value + 100)
    : Math.abs(value) / (Math.abs(value) + 100);
}

function fair(candidateOdds, opponentOdds) {
  const a = implied(candidateOdds);
  const b = implied(opponentOdds);
  if (a === null || b === null || a + b <= 0) return null;
  return a / (a + b);
}

function median(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const middle = Math.floor(xs.length / 2);
  return xs.length % 2
    ? xs[middle]
    : (xs[middle - 1] + xs[middle]) / 2;
}

function eqLine(a, b) {
  const x = num(a);
  const y = num(b);
  return x !== null && y !== null && Math.abs(x - y) < 0.001;
}

function normalizePlayer(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function latestAt(quotes, cutoffMs) {
  const map = new Map();
  for (const quote of quotes || []) {
    const at = Date.parse(quote?.observed_at || "");
    if (!Number.isFinite(at) || at > cutoffMs) continue;
    const key = `${String(quote.book).toLowerCase()}|${quote.side}`;
    const current = map.get(key);
    if (!current || Date.parse(current.observed_at) < at) {
      map.set(key, quote);
    }
  }
  return [...map.values()];
}

function openingRefs(quotes) {
  const map = new Map();
  const sorted = [...(quotes || [])].sort(
    (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at)
  );
  for (const quote of sorted) {
    const key = `${String(quote.book).toLowerCase()}|${quote.side}`;
    if (map.has(key)) continue;
    map.set(key, {
      ...quote,
      line: quote.provider_open_line ?? quote.line,
      odds: quote.provider_open_odds ?? quote.odds
    });
  }
  return [...map.values()];
}

function marketMetrics(rows, decisionLine, selectedSide, decisionBook) {
  const sideRows = (rows || []).filter(
    (quote) =>
      quote.side === selectedSide &&
      quote.available !== false &&
      num(quote.line) !== null &&
      num(quote.odds) !== null
  );

  const consensusLine = median(sideRows.map((quote) => Number(quote.line)));
  const exact = sideRows.filter((quote) => eqLine(quote.line, decisionLine));
  const bestOdds = exact.length
    ? Math.max(...exact.map((quote) => Number(quote.odds)))
    : null;
  const sameBook = decisionBook
    ? exact.find(
        (quote) =>
          String(quote.book).toLowerCase() === String(decisionBook).toLowerCase()
      )
    : null;

  const byBook = new Map();
  for (const quote of rows || []) {
    if (
      quote.available === false ||
      num(quote.line) === null ||
      num(quote.odds) === null
    ) {
      continue;
    }
    const book = String(quote.book).toLowerCase();
    if (!byBook.has(book)) byBook.set(book, {});
    byBook.get(book)[quote.side] = quote;
  }

  const fairs = [];
  let pairedBooks = 0;
  for (const pair of byBook.values()) {
    const over = pair.over;
    const under = pair.under;
    if (
      !over ||
      !under ||
      !eqLine(over.line, decisionLine) ||
      !eqLine(under.line, decisionLine)
    ) {
      continue;
    }
    const probability =
      selectedSide === "over"
        ? fair(over.odds, under.odds)
        : fair(under.odds, over.odds);
    if (probability !== null) {
      fairs.push(probability);
      pairedBooks += 1;
    }
  }

  const quoteTimes = sideRows
    .map((quote) => Date.parse(quote.observed_at))
    .filter(Number.isFinite);

  return {
    consensusLine,
    bestOdds,
    sameBookOdds: sameBook ? num(sameBook.odds) : null,
    marketFair:
      fairs.length
        ? fairs.reduce((sum, value) => sum + value, 0) / fairs.length
        : null,
    quoteAt:
      quoteTimes.length
        ? new Date(Math.max(...quoteTimes)).toISOString()
        : null,
    bookCount: new Set(
      sideRows.map((quote) => String(quote.book).toLowerCase())
    ).size,
    pairedBooks
  };
}

function clvClass(finalized, close, lineClv, fairClv, sameBookClv, ageMinutes) {
  if (!finalized) return "TRACKING";
  if (!close || close.bookCount === 0) return "NO_CLOSE";
  if (ageMinutes !== null && ageMinutes > 15) return "STALE_CLOSE";
  if (lineClv !== null && lineClv >= 0.49) return "POSITIVE_LINE_CLV";
  if (lineClv !== null && lineClv <= -0.49) return "NEGATIVE_LINE_CLV";
  if (fairClv !== null && fairClv >= 0.5) return "POSITIVE_PRICE_CLV";
  if (fairClv !== null && fairClv <= -0.5) return "NEGATIVE_PRICE_CLV";
  if (sameBookClv !== null && sameBookClv >= 0.5) return "POSITIVE_PRICE_CLV";
  if (sameBookClv !== null && sameBookClv <= -0.5) return "NEGATIVE_PRICE_CLV";
  return "NEUTRAL_CLV";
}

function quoteMatchesObservation(quote, observation) {
  if (quote.event_id !== observation.event_id) return false;
  if (quote.stat_id !== observation.stat_id) return false;
  const quotePlayer = normalizePlayer(quote.player_name);
  const obsPlayer = normalizePlayer(observation.player_name);
  if (quotePlayer && obsPlayer && quotePlayer !== obsPlayer) return false;
  if (
    quote.player_id &&
    observation.player_id &&
    String(quote.player_id) !== String(observation.player_id) &&
    quotePlayer !== obsPlayer
  ) {
    return false;
  }
  return true;
}

export {
  num,
  implied,
  fair,
  median,
  eqLine,
  normalizePlayer,
  latestAt,
  openingRefs,
  marketMetrics,
  clvClass,
  quoteMatchesObservation
};
