import { projectPlayerOpportunity, createProjectionInputIndex } from './nfl-player-props.js';
import {loadWeatherContext,normalizeTeam} from './nfl-model.js';

export async function loadEventWeatherContexts(events, context, loadWeather = loadWeatherContext) {
  const results = new Map();
  for (let i = 0; i < events.length; i += 4) {
    await Promise.all(events.slice(i, i + 4).map(async event => {
      const homeTeam = normalizeTeam(event?.matchup?.home?.name || event?.matchup?.home?.short);
      results.set(event, homeTeam ? await loadWeather({...context,event,homeTeam}) : null);
    }));
  }
  return results;
}

export function createEventOpportunityProjector(context, project = projectPlayerOpportunity) {
  // The caller creates one projector per event and request. Context stays fixed;
  // book, stat and line change grading, but not the player's opportunity model.
  const cache = new Map();
  const inputs = context.projectionInputIndex || createProjectionInputIndex(context);
  return ({ playerName, preferredTeam = null, preferredPosition = null, opponentSnapshot = null }) => {
    const key = JSON.stringify([playerName, preferredTeam, preferredPosition, opponentSnapshot]);
    if (!cache.has(key)) {
      cache.set(key, project({ ...context, ...inputs.forPlayer({event:context.event,playerName,preferredTeam,preferredPosition}), playerName, preferredTeam, preferredPosition, opponentSnapshot }));
    }
    return cache.get(key);
  };
}
