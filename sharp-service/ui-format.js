// Presentation helpers only. These functions never resolve roster identity,
// change a decision, or calculate a new model probability.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
const unavailableName = /^(?:player(?: name)? unavailable|name unavailable|unavailable|unknown(?: player)?|player|n\/?a|none|null|undefined|tbd|[-—–])$/i;
const opaque = value => /^[a-f\d]{16,}$/i.test(value) || /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const nameCharacters = /^[\p{L}\p{M} .'’\-]+$/u;
const initials = new Set(['AJ', 'CJ', 'DJ', 'JJ', 'JP', 'JT', 'KJ', 'MJ', 'OG', 'PJ', 'RJ', 'TJ']);

function suppliedName(value) {
  const candidate = text(value);
  return candidate && candidate.length <= 160 && !unavailableName.test(candidate) &&
    !opaque(candidate) && nameCharacters.test(candidate) && /\p{L}/u.test(candidate) ? candidate : null;
}

function nameFromProviderId(value) {
  const id = text(value);
  // The numeric player discriminator is required: a team ID such as
  // BOSTON_CELTICS_NBA must not become a player's display name.
  const match = /^(.+)_\d+_(NBA|NFL|NHL|MLB|CFB)$/i.exec(id);
  if (!match) return null;
  const words = match[1].split('_');
  if (!words.length || words.length > 10 || words.some(word => !word || word.length > 32 ||
    opaque(word) || !nameCharacters.test(word) || !/\p{L}/u.test(word))) return null;
  const name = words.map(word => {
    const upper = word.toUpperCase();
    if (initials.has(upper) || /^(?:II|III|IV|V)$/.test(upper) || word.length === 1) return upper;
    if (upper === 'JR' || upper === 'SR') return upper[0] + 'r.';
    // Preserve existing boundaries. Do not guess missing apostrophes or split
    // a token such as KARLANTHONY into a purportedly verified spelling.
    return word.toLowerCase().replace(/(^|[-'’ .])(\p{L})/gu, (_, boundary, letter) => boundary + letter.toUpperCase());
  }).join(' ');
  return suppliedName(name);
}

export function displayPlayerName(name, playerID) {
  const supplied = suppliedName(name);
  if (supplied && supplied !== text(playerID)) return { name: supplied, source: 'supplied' };
  const fallback = nameFromProviderId(playerID) || nameFromProviderId(name);
  return fallback ? { name: fallback, source: 'provider-id' } : { name: 'Name unavailable', source: 'unavailable' };
}

const centralFormatters = [false, true].map(seconds => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', year: 'numeric', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), timeZoneName: 'short'
}));

export function formatCentralTime(value, { seconds = false } = {}) {
  let timestamp;
  if (value instanceof Date) timestamp = value.getTime();
  else if (finite(value)) timestamp = value;
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value.trim())) {
    // Require a timezone so the visitor's device cannot reinterpret a timestamp.
    timestamp = Date.parse(value.trim());
  }
  if (!finite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) return 'N/A';
  return centralFormatters[seconds ? 1 : 0].format(timestamp).replace(/[\u202f\u00a0]/g, ' ');
}

export function formatNumber(value, { digits = 1, suffix = '' } = {}) {
  if (!finite(value)) return 'N/A';
  const precision = Number.isInteger(digits) && digits >= 0 && digits <= 20 ? digits : 1;
  return (Object.is(value, -0) ? 0 : value).toLocaleString('en-US', {
    minimumFractionDigits: precision, maximumFractionDigits: precision
  }) + (typeof suffix === 'string' ? suffix : '');
}

export function formatProbability(value) {
  return finite(value) && value >= 0 && value <= 1 ? formatNumber(value * 100, { suffix: '%' }) : 'N/A';
}

const reasonLabels = Object.freeze({
  MODEL_NOT_APPROVED: 'Model not approved',
  MODEL_APPROVAL_MISSING: 'Model not approved',
  MODEL_APPROVAL_EXPIRED: 'Model approval expired',
  MODEL_HASH_MISMATCH: 'Model approval mismatch',
  EXPLICIT_AVAILABILITY_REQUIRED: 'Availability unverified',
  AVAILABILITY_UNVERIFIED: 'Availability unverified',
  PLAYER_INJURY_CLEARANCE_UNVERIFIED: 'Injury status unverified',
  PARTICIPATION_UNVERIFIED: 'Participation unverified',
  PROJECTED_MINUTES_UNAVAILABLE: 'Projected minutes unavailable',
  PROJECTED_MINUTES_UNVERIFIED: 'Projected minutes unverified',
  ROTATION_UNCONFIRMED: 'Rotation unconfirmed',
  PLAYER_EVENT_IDENTITY_UNVERIFIED: 'Player identity unverified',
  PLAYER_IDENTITY_UNVERIFIED: 'Player identity unverified',
  UNVERIFIED_PLAYER_IDENTITY: 'Player identity unverified',
  PREGAME_EVENT_UNVERIFIED: 'Game timing unverified',
  MATCHUP_AND_ROLE_ADJUSTMENTS_UNVALIDATED: 'Matchup adjustments unvalidated',
  PROP_CALIBRATION_UNVALIDATED: 'Prop model unvalidated',
  NO_PROSPECTIVE_VALIDATION: 'Model validation pending',
  INSUFFICIENT_HISTORY: 'Insufficient historical data',
  INSUFFICIENT_HISTORICAL_DATA: 'Insufficient historical data',
  INSUFFICIENT_EDGE: 'Insufficient edge',
  EDGE_TOO_LOW: 'Insufficient edge',
  INSUFFICIENT_EV: 'Insufficient expected return',
  EV_TOO_LOW: 'Insufficient expected return',
  STALE_MARKET_PRICE: 'Market price stale',
  QUOTE_STALE: 'Market price stale',
  STALE_QUOTE: 'Market price stale',
  QUOTE_UNAVAILABLE: 'Market price unavailable',
  QUOTE_TIMESTAMP_UNVERIFIED: 'Price timestamp unverified',
  MISSING_PAIRED_QUOTE: 'Paired quote missing',
  PAIRED_QUOTE_UNAVAILABLE: 'Paired quote missing',
  DECISION_EXPIRED: 'Decision expired',
  FORECAST_EXPIRED: 'Forecast expired',
  CONFLICTING_MODEL_RECORDS: 'Conflicting model records'
});

function brief(value, limit) {
  const result = text(value);
  return result.length > limit ? result.slice(0, limit - 1).trimEnd() + '…' : result;
}

export function shortReason(reasons, fallback = 'Details unavailable') {
  const codes = Array.isArray(reasons) ? reasons : typeof reasons === 'string' ? [reasons] : [];
  const labels = [], seen = new Set();
  for (const raw of codes) {
    const code = text(raw);
    if (!code) continue;
    const human = /^[A-Z][A-Z\d]*(?:_[A-Z\d]+)+$/.test(code) ?
      code[0] + code.slice(1).toLowerCase().replace(/_/g, ' ') : code;
    const label = brief(Object.hasOwn(reasonLabels, code) ? reasonLabels[code] : human, 64), key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); labels.push(label);
    if (labels.length === 3) break;
  }
  return labels.length ? labels.join(' · ') : brief(fallback, 160) || 'Details unavailable';
}
