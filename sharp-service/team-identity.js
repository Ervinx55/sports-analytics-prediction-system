import {TEAM_REGISTRY} from './team-registry.js';

// This registry is presentation only. It must never replace provider IDs,
// establish a wager side, or participate in quote/model matching.
const text = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const normalized = value => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const league = value => text(value).toUpperCase() === 'CFB' ? 'NCAAF' : text(value).toUpperCase();
const aliases = new Map();
for (const team of TEAM_REGISTRY) {
  if (!aliases.has(team.sport)) aliases.set(team.sport, new Map());
  const index = aliases.get(team.sport);
  for (const alias of team.aliases) {
    const key = normalized(alias);
    if (!key) continue;
    if (!index.has(key)) index.set(key, team);
    else if (index.get(key)?.espnTeamId !== team.espnTeamId) index.set(key, null);
  }
}

function inputTeam(team) {
  if (typeof team === 'string') return {name:text(team)};
  if (!team || typeof team !== 'object' || Array.isArray(team)) return {name:''};
  const name = text(team.name) || text(team.teamName) || text(team.names?.long) || text(team.names?.medium);
  const id = text(team.id) || text(team.teamId) || text(team.teamID);
  return {name, ...(id ? {id} : {})};
}

function initials(name) {
  const words = normalized(name).split(' ').filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 3) : words.slice(0, 3).map(word => word[0]).join('')).toUpperCase();
}

/** Exact, sport-scoped display identity. Ambiguous aliases and conflicting
 * source identities retain readable text without borrowing another logo.
 * Numeric IDs are intentionally not interpreted as ESPN or other provider IDs.
 */
export function getTeamIdentity(sport, team) {
  const source = inputTeam(team), sportId = league(sport), index = aliases.get(sportId);
  const nameKey = normalized(source.name);
  const nameMatch = index?.get(nameKey) || null;
  const provider = source.id?.match(/^(.+)_(NBA|NFL|NHL|MLB|NCAAF|CFB)$/i);
  const providerSport = provider ? league(provider[2]) : null;
  const idMatch = providerSport === sportId ? index?.get(normalized(provider[1])) || null : null;
  const conflict = provider && providerSport !== sportId || nameMatch && idMatch && nameMatch.espnTeamId !== idMatch.espnTeamId;
  // A meaningful but unrecognized source name cannot be replaced solely by ID.
  const known = conflict ? null : nameMatch || (!source.name ? idMatch : null);
  const rawName = source.name || known?.name || 'Team unavailable';
  const isShortAlias = known && (normalized(rawName) === normalized(known.abbreviation) || !/\s/.test(rawName));
  return {
    sport:sportId,
    teamId:source.id || null,
    name:known && isShortAlias ? known.name : rawName,
    canonicalName:known?.name || null,
    abbreviation:known?.abbreviation || initials(rawName),
    logoSrc:known?.logoSrc || null,
    source:known ? 'espn' : 'fallback',
  };
}

/** Append inline, accessible team identity. The text is always readable even
 * if a logo is unavailable; source-supplied image URLs are never used.
 */
export function appendTeamIdentity(parent, sport, team, {compact=false}={}) {
  const identity = getTeamIdentity(sport, team);
  const document = parent.ownerDocument || globalThis.document;
  const create = (tag, className, value) => {
    const node = document.createElement(tag);
    node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const container = create('span', 'team-identity' + (compact ? ' is-compact' : ''));
  const badge = create('span', 'team-logo-badge');
  badge.setAttribute('aria-hidden', 'true');
  const fallback = create('span', 'team-logo-fallback', identity.abbreviation);
  fallback.hidden = Boolean(identity.logoSrc);
  if (identity.logoSrc) {
    const image = create('img', 'team-logo');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.onerror = () => {
      image.onerror = null;
      image.onload = null;
      image.hidden = true;
      fallback.hidden = false;
      if (container.dataset) container.dataset.teamLogoSource = 'fallback';
    };
    image.onload = () => { fallback.hidden = true; };
    image.src = identity.logoSrc;
    badge.append(image);
  }
  badge.append(fallback);
  container.append(badge);
  container.append(create('span', 'team-name', identity.name));
  if (container.dataset) container.dataset.teamLogoSource = identity.source;
  parent.append(container);
  return container;
}

/** Extract source display order only. A "vs" string does not establish home
 * advantage or selection identity; callers must keep their wager-side logic.
 */
export function getMatchupTeams(matchup) {
  if (typeof matchup === 'string') {
    const parts = text(matchup).split(/\s+(@|at|vs\.?)\s+/i);
    if (parts.length !== 3 || !text(parts[0]) || !text(parts[2])) return null;
    return {away:{name:text(parts[0])}, home:{name:text(parts[2])}, separator:/^vs/i.test(parts[1]) ? 'vs' : 'at'};
  }
  if (!matchup || typeof matchup !== 'object' || Array.isArray(matchup)) return null;
  const away = inputTeam(matchup.away), home = inputTeam(matchup.home);
  if (!away.name || !home.name) return null;
  if (!away.id && text(matchup.awayID)) away.id = text(matchup.awayID);
  if (!home.id && text(matchup.homeID)) home.id = text(matchup.homeID);
  return {away, home, separator:/^vs\.?$/i.test(text(matchup.separator)) ? 'vs' : 'at'};
}
