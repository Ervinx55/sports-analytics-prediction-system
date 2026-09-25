import {
  leagueBaselines,
  normalizeTeam,
  teamSnapshot
} from "./nba-model.js";

const NBA_PROP_CONTEXT_VERSION =
  "NBA Prop Context v1.1-shadow";

const CONTEXT_SHADOW_WEIGHT = 0.25;
const MAX_FULL_CONTEXT_MULTIPLIER_DELTA = 0.05;

const STAT_SIGNAL_WEIGHTS = Object.freeze({
  points: {
    teamTotal: 0.45,
    opponentDefense: 0.30,
    scoringEnvironment: 0.15,
    fatigue: -0.10
  },
  assists: {
    teamTotal: 0.40,
    opponentDefense: 0.20,
    scoringEnvironment: 0.20,
    fatigue: -0.10
  },
  threes_made: {
    teamTotal: 0.35,
    opponentDefense: 0.15,
    scoringEnvironment: 0.20,
    fatigue: -0.10
  },
  rebounds: {
    teamTotal: 0.05,
    opponentDefense: 0.05,
    scoringEnvironment: 0.20,
    fatigue: -0.10
  },
  turnovers: {
    teamTotal: 0.10,
    opponentDefense: 0,
    scoringEnvironment: 0.05,
    fatigue: 0.05
  },
  blocks: {
    teamTotal: 0,
    opponentDefense: 0,
    scoringEnvironment: 0,
    fatigue: -0.05
  },
  steals: {
    teamTotal: 0,
    opponentDefense: 0,
    scoringEnvironment: 0,
    fatigue: -0.05
  },
  blocks_steals: {
    teamTotal: 0,
    opponentDefense: 0,
    scoringEnvironment: 0,
    fatigue: -0.05
  },
  points_rebounds_assists: {
    teamTotal: 0.38,
    opponentDefense: 0.22,
    scoringEnvironment: 0.18,
    fatigue: -0.10
  },
  points_rebounds: {
    teamTotal: 0.32,
    opponentDefense: 0.20,
    scoringEnvironment: 0.18,
    fatigue: -0.10
  },
  points_assists: {
    teamTotal: 0.42,
    opponentDefense: 0.24,
    scoringEnvironment: 0.18,
    fatigue: -0.10
  },
  rebounds_assists: {
    teamTotal: 0.18,
    opponentDefense: 0.12,
    scoringEnvironment: 0.20,
    fatigue: -0.10
  }
});

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function num(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values) {
  const usable = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2
    ? usable[middle]
    : (usable[middle - 1] + usable[middle]) / 2;
}

function marketLine(side) {
  const consensus = num(side?.consensus?.line);
  if (consensus !== null) return consensus;
  return median(
    Object.values(side?.books || {})
      .map((row) => num(row?.line))
  );
}

function teamFromProviderRow(team = {}) {
  return normalizeTeam(
    team?.abbreviation ||
    team?.full_name ||
    team?.name
  );
}

function gameTeams(game) {
  return {
    home: teamFromProviderRow(game?.home_team),
    away: teamFromProviderRow(game?.visitor_team)
  };
}

function eventTeams(event) {
  return {
    home: normalizeTeam(
      event?.matchup?.home?.name ||
      event?.matchup?.home?.short
    ),
    away: normalizeTeam(
      event?.matchup?.away?.name ||
      event?.matchup?.away?.short
    )
  };
}

function matchBoardEvent(
  propEvent,
  boardEvents = [],
  {
    maxStartDifferenceMs = 4 * 60 * 60 * 1000
  } = {}
) {
  const wanted = eventTeams(propEvent);
  const propStart = Date.parse(
    propEvent?.startsAt || ""
  );

  const matches = (boardEvents || [])
    .filter((event) => {
      const teams = eventTeams(event);
      return (
        teams.home &&
        teams.away &&
        teams.home === wanted.home &&
        teams.away === wanted.away
      );
    })
    .map((event) => {
      const start = Date.parse(
        event?.startsAt || ""
      );
      const diff =
        Number.isFinite(propStart) &&
        Number.isFinite(start)
          ? Math.abs(start - propStart)
          : 0;
      return { event, diff };
    })
    .filter(
      (row) =>
        row.diff <= maxStartDifferenceMs
    )
    .sort((a, b) => a.diff - b.diff);

  return matches[0]?.event || null;
}

function allTeamSnapshots(
  games,
  startsAt,
  season
) {
  const teams = new Set();

  for (const game of games || []) {
    const { home, away } = gameTeams(game);
    if (home) teams.add(home);
    if (away) teams.add(away);
  }

  return [...teams]
    .map((team) =>
      teamSnapshot(
        games,
        team,
        startsAt,
        season
      )
    )
    .filter((row) => row.games > 0);
}

function impliedTeamTotals(
  boardEvent
) {
  const total = marketLine(
    boardEvent?.markets?.total?.over
  );
  const homeSpread = marketLine(
    boardEvent?.markets?.spread?.home
  );

  if (
    !Number.isFinite(total) ||
    !Number.isFinite(homeSpread)
  ) {
    return {
      total,
      homeSpread,
      home: null,
      away: null
    };
  }

  const home =
    total / 2 - homeSpread / 2;

  return {
    total,
    homeSpread,
    home,
    away: total - home
  };
}

function buildNbaPropGameContext({
  propEvent,
  boardEvent = null,
  games = [],
  season,
  playerTeamName = null
}) {
  const teams = eventTeams(propEvent);
  const playerTeam =
    normalizeTeam(playerTeamName);

  if (
    !teams.home ||
    !teams.away ||
    !playerTeam ||
    ![teams.home, teams.away].includes(
      playerTeam
    )
  ) {
    return {
      available: false,
      version: NBA_PROP_CONTEXT_VERSION,
      reason:
        "Player team could not be matched to the NBA event."
    };
  }

  const side =
    playerTeam === teams.home
      ? "home"
      : "away";
  const opponentTeam =
    side === "home"
      ? teams.away
      : teams.home;
  const startsAt =
    propEvent?.startsAt ||
    boardEvent?.startsAt ||
    new Date().toISOString();

  const playerSnapshot = teamSnapshot(
    games,
    playerTeam,
    startsAt,
    season
  );
  const opponentSnapshot = teamSnapshot(
    games,
    opponentTeam,
    startsAt,
    season
  );
  const snapshots = allTeamSnapshots(
    games,
    startsAt,
    season
  );
  const baselines = leagueBaselines(
    snapshots.length
      ? snapshots
      : [playerSnapshot, opponentSnapshot]
  );

  const implied =
    impliedTeamTotals(boardEvent);
  const leaguePoints =
    baselines?.pointsFor?.mean || 113;
  const leagueTotal =
    baselines?.total?.mean || 226;
  const playerImplied =
    side === "home"
      ? implied.home
      : implied.away;

  const recentEnvironment = median([
    playerSnapshot.total,
    opponentSnapshot.total
  ]);

  const teamTotalSignal =
    Number.isFinite(playerImplied)
      ? clamp(
          (playerImplied - leaguePoints) / 10,
          -1,
          1
        )
      : 0;
  const opponentDefenseSignal =
    Number.isFinite(
      opponentSnapshot.pointsAgainst
    )
      ? clamp(
          (
            opponentSnapshot.pointsAgainst -
            leaguePoints
          ) / 8,
          -1,
          1
        )
      : 0;
  const scoringEnvironmentSignal =
    Number.isFinite(recentEnvironment)
      ? clamp(
          (
            recentEnvironment -
            leagueTotal
          ) / 16,
          -1,
          1
        )
      : (
        Number.isFinite(implied.total)
          ? clamp(
              (
                implied.total -
                leagueTotal
              ) / 16,
              -1,
              1
            )
          : 0
      );
  const fatigueSignal = clamp(
    (
      playerSnapshot.schedule
        ?.fatiguePenalty || 0
    ) / 2,
    0,
    1
  );

  const featureCount = [
    Number.isFinite(playerImplied),
    Number.isFinite(
      opponentSnapshot.pointsAgainst
    ),
    Number.isFinite(
      recentEnvironment
    ) ||
      Number.isFinite(implied.total),
    Number.isFinite(
      playerSnapshot.schedule
        ?.fatiguePenalty
    )
  ].filter(Boolean).length;

  return {
    available: featureCount >= 2,
    version: NBA_PROP_CONTEXT_VERSION,
    playerTeam,
    opponentTeam,
    side,
    boardMatched: Boolean(boardEvent),
    marketTotal: implied.total,
    marketHomeSpread: implied.homeSpread,
    impliedTeamTotal: playerImplied,
    impliedOpponentTotal:
      side === "home"
        ? implied.away
        : implied.home,
    leaguePoints,
    leagueTotal,
    playerRecent: {
      games: playerSnapshot.games,
      pointsFor:
        playerSnapshot.pointsFor,
      pointsAgainst:
        playerSnapshot.pointsAgainst,
      gameTotal:
        playerSnapshot.total,
      schedule:
        playerSnapshot.schedule
    },
    opponentRecent: {
      games: opponentSnapshot.games,
      pointsFor:
        opponentSnapshot.pointsFor,
      pointsAgainst:
        opponentSnapshot.pointsAgainst,
      gameTotal:
        opponentSnapshot.total,
      schedule:
        opponentSnapshot.schedule
    },
    signals: {
      teamTotal: Number(
        teamTotalSignal.toFixed(4)
      ),
      opponentDefense: Number(
        opponentDefenseSignal.toFixed(4)
      ),
      scoringEnvironment: Number(
        scoringEnvironmentSignal.toFixed(4)
      ),
      fatigue: Number(
        fatigueSignal.toFixed(4)
      )
    },
    featureCount,
    reason:
      featureCount >= 2
        ? null
        : "Insufficient NBA game-environment features."
  };
}

function contextSignal(
  statID,
  context
) {
  if (!context?.available) return 0;
  const weights =
    STAT_SIGNAL_WEIGHTS[statID];
  if (!weights) return 0;

  return clamp(
    Object.entries(weights)
      .reduce(
        (sum, [key, weight]) =>
          sum +
          weight *
            (context.signals?.[key] || 0),
        0
      ),
    -1,
    1
  );
}

function applyNbaPropGameContext(
  projection,
  statID,
  context,
  {
    shadowWeight =
      CONTEXT_SHADOW_WEIGHT
  } = {}
) {
  if (
    !projection?.available ||
    !Number.isFinite(projection.mean)
  ) {
    return projection;
  }

  const rawMean =
    Number.isFinite(projection.rawMean)
      ? projection.rawMean
      : projection.mean;
  const signal =
    contextSignal(statID, context);
  const fullMultiplier =
    1 +
    signal *
      MAX_FULL_CONTEXT_MULTIPLIER_DELTA;
  const challengerMean =
    context?.available
      ? rawMean * fullMultiplier
      : rawMean;
  const weight =
    context?.available
      ? clamp(shadowWeight, 0, 1)
      : 0;
  const mean =
    rawMean +
    weight *
      (challengerMean - rawMean);

  return {
    ...projection,
    rawMean:
      Number(rawMean.toFixed(4)),
    mean:
      Number(mean.toFixed(4)),
    contextChallengerMean:
      Number(
        challengerMean.toFixed(4)
      ),
    contextShadowWeight: weight,
    contextSignal:
      Number(signal.toFixed(4)),
    contextMultiplier:
      Number(
        fullMultiplier.toFixed(5)
      ),
    gameContext:
      context || {
        available: false,
        version:
          NBA_PROP_CONTEXT_VERSION
      }
  };
}

export {
  NBA_PROP_CONTEXT_VERSION,
  CONTEXT_SHADOW_WEIGHT,
  MAX_FULL_CONTEXT_MULTIPLIER_DELTA,
  STAT_SIGNAL_WEIGHTS,
  matchBoardEvent,
  impliedTeamTotals,
  buildNbaPropGameContext,
  contextSignal,
  applyNbaPropGameContext
};
