// Provider identifiers, not the legacy sharp-source approval contract.
// https://sportsgameodds.com/docs/data-types/bookmakers
export function canonicalBookmaker(book) {
  const id = String(book ?? '').trim().toLowerCase();
  return ['bookmaker', 'bookmaker.eu'].includes(id) ? 'bookmakereu' : id;
}

export function bookmakerIds(books = []) {
  return [...new Set(books.map(canonicalBookmaker).filter(Boolean))].sort();
}

export function bookmakerQuery(value) {
  const text = Array.isArray(value) ? value[0] : value;
  return bookmakerIds(String(text ?? '').split(',').slice(0, 20));
}

const DFS = new Set(['prizepicks', 'underdog', 'sleeper', 'parlayplay', 'hotstreak']);
const EXCHANGES = new Set(['kalshi', 'polymarket', 'novig', 'betfairexchange', 'matchbook', 'sporttrade']);
const SPORTSBOOKS = new Set(['pinnacle', 'circa', 'bookmakereu', 'bovada', 'draftkings', 'fanduel', 'betmgm', 'caesars', 'betonline', 'betrivers', 'bet365', 'fanatics']);

export function bookmakerType(id) {
  id = canonicalBookmaker(id);
  return DFS.has(id) ? 'dfs' : EXCHANGES.has(id) ? 'exchange' : SPORTSBOOKS.has(id) ? 'sportsbook' : 'unknown';
}

// Counts individual returned quote sides. This does not assert paired prices,
// matching settlement rules, user access, model validation, or an approved play.
export function bookCoverage({ requestedBooks = [], quotes = [], now = Date.now(), maxAgeMs = 300000 } = {}) {
  const requested = bookmakerIds(requestedBooks);
  const rows = new Map();
  const ensure = id => {
    if (!rows.has(id)) rows.set(id, { id, type: bookmakerType(id), observedQuoteSides: 0, availableQuoteSides: 0, freshQuoteSides: 0 });
    return rows.get(id);
  };
  requested.forEach(ensure);
  for (const { book, price } of quotes) {
    const id = canonicalBookmaker(book);
    if (!id || !price) continue;
    const row = ensure(id);
    row.observedQuoteSides++;
    const odds = Number(price.odds);
    const available = price.available === true && Number.isFinite(odds) && Math.abs(odds) >= 100;
    if (available) row.availableQuoteSides++;
    const age = now - Date.parse(price.updatedAt ?? '');
    if (available && Number.isFinite(age) && age >= 0 && age <= maxAgeMs) row.freshQuoteSides++;
  }
  const books = [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
  const observed = books.filter(row => row.observedQuoteSides > 0).map(row => row.id);
  return {
    requested, observed, missingRequested: requested.filter(id => !observed.includes(id)), books,
    freshnessLimitSeconds: maxAgeMs / 1000, checkedAt: new Date(now).toISOString(),
    productionApproval: false,
    scope: 'Returned quote sides only; coverage does not establish a complete market or authorize a play. DFS payouts and exchange fees/liquidity require separate checks.'
  };
}

export function boardBookCoverage(events, requestedBooks) {
  const quotes = [];
  for (const event of events) for (const market of Object.values(event.markets ?? {})) {
    for (const side of Object.values(market ?? {})) for (const [book, price] of Object.entries(side?.books ?? {})) quotes.push({ book, price });
  }
  return bookCoverage({ requestedBooks, quotes });
}
