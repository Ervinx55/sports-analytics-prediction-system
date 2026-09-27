import { projectPlayerOpportunity } from './nfl-player-props.js';

export function createEventOpportunityProjector(context, project = projectPlayerOpportunity) {
  // The caller creates one projector per event and request. Context stays fixed;
  // book, stat and line change grading, but not the player's opportunity model.
  const cache = new Map();
  return ({ playerName, preferredTeam = null, preferredPosition = null, opponentSnapshot = null }) => {
    const key = JSON.stringify([playerName, preferredTeam, preferredPosition, opponentSnapshot]);
    if (!cache.has(key)) {
      cache.set(key, project({ ...context, playerName, preferredTeam, preferredPosition, opponentSnapshot }));
    }
    return cache.get(key);
  };
}
