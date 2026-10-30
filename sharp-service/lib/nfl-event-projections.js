import { buildNflPropContext } from './nfl-prop-context.js';
import { projectPlayerOpportunity } from './nfl-player-props.js';

export function createEventOpportunityProjector(context, project = projectPlayerOpportunity, buildContext = buildNflPropContext) {
  // The caller creates one projector per event and request. Context stays fixed;
  // book, stat and line change grading, but not the player's opportunity model.
  const cache = new Map();
  // Context is team-specific, not player-specific. This closure belongs to one
  // event/request, so mutable source arrays cannot leak a stale cross-request hit.
  const teamContexts = new Map();
  const contextBuilder = args => {
    const key = JSON.stringify([args.team, args.opponent]);
    if (!teamContexts.has(key)) teamContexts.set(key, buildContext(args));
    return teamContexts.get(key);
  };
  return ({ playerName, preferredTeam = null, preferredPosition = null, opponentSnapshot = null }) => {
    const key = JSON.stringify([playerName, preferredTeam, preferredPosition, opponentSnapshot]);
    if (!cache.has(key)) {
      cache.set(key, project({ ...context, contextBuilder, playerName, preferredTeam, preferredPosition, opponentSnapshot }));
    }
    return cache.get(key);
  };
}
