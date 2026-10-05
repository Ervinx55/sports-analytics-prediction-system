// Freshness follows the oldest quote actually used, never the recheck time.
export function sharpQuoteTimestamp(gate) {
  const sources = Object.values(gate?.raw?.sources || {}).filter(source => source?.valid === true);
  if (!sources.length) return null;
  const times = sources.map(source => Date.parse(source.updatedAt || ''));
  if (times.some(time => !Number.isFinite(time))) return null;
  return new Date(Math.min(...times)).toISOString();
}
