const TEAM_CODES = new Map(Object.entries({
  atlantahawks: "ATL",
  bostonceltics: "BOS",
  brooklynnets: "BKN",
  charlottehornets: "CHA",
  chicagobulls: "CHI",
  clevelandcavaliers: "CLE",
  dallasmavericks: "DAL",
  denvernuggets: "DEN",
  detroitpistons: "DET",
  goldenstatewarriors: "GSW",
  houstonrockets: "HOU",
  indianapacers: "IND",
  laclippers: "LAC",
  losangelesclippers: "LAC",
  losangeleslakers: "LAL",
  memphisgrizzlies: "MEM",
  miamiheat: "MIA",
  milwaukeebucks: "MIL",
  minnesotatimberwolves: "MIN",
  neworleanspelicans: "NOP",
  newyorkknicks: "NYK",
  oklahomacitythunder: "OKC",
  orlandomagic: "ORL",
  philadelphia76ers: "PHI",
  phoenixsuns: "PHX",
  portlandtrailblazers: "POR",
  sacramentokings: "SAC",
  sanantoniospurs: "SAS",
  torontoraptors: "TOR",
  utahjazz: "UTA",
  washingtonwizards: "WAS"
}));

const STAT_FIELDS = Object.freeze({
  points: "points",
  rebounds: "reboundsTotal",
  assists: "assists",
  threes_made: "threePointersMade",
  blocks: "blocks",
  steals: "steals",
  turnovers: "turnovers"
});

const COMBO_FIELDS = Object.freeze({
  blocks_steals: ["blocks", "steals"],
  points_rebounds_assists: ["points", "rebounds", "assists"],
  points_rebounds: ["points", "rebounds"],
  points_assists: ["points", "assists"],
  rebounds_assists: ["rebounds", "assists"]
});

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTeam(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function teamCode(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(raw)) return raw;
  return TEAM_CODES.get(normalizeTeam(value)) || null;
}

function normalizePlayerName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function scheduleGames(payload) {
  const dates = payload?.leagueSchedule?.gameDates;
  if (!Array.isArray(dates)) return [];
  return dates.flatMap((block) =>
    (Array.isArray(block?.games) ? block.games : []).map((game) => ({
      ...game,
      __scheduleDate: block?.gameDate || null
    }))
  );
}

function gameStartMs(game) {
  for (const value of [
    game?.gameDateTimeUTC,
    game?.gameTimeUTC,
    game?.gameDateTimeEst,
    game?.gameDateEst,
    game?.__scheduleDate
  ]) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function findScheduleGame(payload, observation) {
  const away = teamCode(observation?.away_team);
  const home = teamCode(observation?.home_team);
  const starts = Date.parse(String(observation?.starts_at || ""));
  if (!away || !home) return null;

  const candidates = scheduleGames(payload)
    .filter((game) => {
      const gameAway =
        String(
          game?.awayTeam?.teamTricode ||
          game?.awayTeam?.teamTricode ||
          ""
        ).toUpperCase();
      const gameHome =
        String(
          game?.homeTeam?.teamTricode ||
          game?.homeTeam?.teamTricode ||
          ""
        ).toUpperCase();
      return gameAway === away && gameHome === home;
    })
    .map((game) => {
      const at = gameStartMs(game);
      const diff =
        Number.isFinite(starts) && Number.isFinite(at)
          ? Math.abs(at - starts)
          : Number.POSITIVE_INFINITY;
      return { game, diff };
    })
    .sort((a, b) => a.diff - b.diff);

  if (!candidates.length) return null;

  const best = candidates[0];
  if (
    Number.isFinite(starts) &&
    Number.isFinite(best.diff) &&
    best.diff > 36 * 60 * 60 * 1000
  ) {
    return null;
  }

  return best.game;
}

function allPlayers(boxscore) {
  return [
    ...(boxscore?.game?.awayTeam?.players || []),
    ...(boxscore?.game?.homeTeam?.players || [])
  ];
}

function findBoxscorePlayer(boxscore, observation) {
  const wanted = normalizePlayerName(observation?.player_name);
  if (!wanted) return null;

  const players = allPlayers(boxscore);
  const exact = players.find((player) =>
    normalizePlayerName(
      player?.name ||
      [player?.firstName, player?.familyName].filter(Boolean).join(" ")
    ) === wanted
  );
  if (exact) return exact;

  const providerId = String(observation?.player_id || "");
  const numeric = providerId.match(/(?:^|_)(\d{5,})(?:_|$)/)?.[1];
  if (numeric) {
    const byId = players.find(
      (player) => String(player?.personId || "") === numeric
    );
    if (byId) return byId;
  }

  return null;
}

function actualStat(player, statId) {
  const stats = player?.statistics || {};
  if (STAT_FIELDS[statId]) {
    return num(stats?.[STAT_FIELDS[statId]]);
  }

  const components = COMBO_FIELDS[statId];
  if (!components) return null;

  let total = 0;
  for (const component of components) {
    const value = actualStat(player, component);
    if (!Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

function playerParticipated(player) {
  if (!player) return false;
  if (player?.played === true || String(player?.played).toLowerCase() === "true") {
    return true;
  }
  const minutes = String(player?.statistics?.minutes || "");
  return /^PT(?=.*\d)/.test(minutes) && !/^PT0M(?:0+(?:\.0+)?)?S?$/.test(minutes);
}

function settleObservation(observation, boxscore) {
  if (Number(boxscore?.game?.gameStatus) !== 3) {
    return {
      ready: false,
      reason: "NBA game is not final."
    };
  }

  const player = findBoxscorePlayer(boxscore, observation);
  if (!player) {
    return {
      ready: false,
      reason: "Player was not found in the official NBA boxscore."
    };
  }

  if (!playerParticipated(player)) {
    return {
      ready: true,
      actualValue: null,
      outcome: "VOID",
      won: null,
      pushed: false,
      player,
      reason: "Official NBA boxscore shows no game participation."
    };
  }

  const actual = actualStat(player, observation?.stat_id);
  const line = num(observation?.line);
  if (!Number.isFinite(actual) || !Number.isFinite(line)) {
    return {
      ready: false,
      reason: "Required final stat or decision line is unavailable."
    };
  }

  const side = String(observation?.side || "").toLowerCase();
  if (!["over", "under"].includes(side)) {
    return {
      ready: false,
      reason: "Unsupported prop side."
    };
  }

  let outcome = "L";
  let won = false;
  let pushed = false;

  if (Math.abs(actual - line) <= 1e-9) {
    outcome = "PUSH";
    pushed = true;
  } else if (
    (side === "over" && actual > line) ||
    (side === "under" && actual < line)
  ) {
    outcome = "W";
    won = true;
  }

  return {
    ready: true,
    actualValue: actual,
    outcome,
    won,
    pushed,
    player,
    reason: null
  };
}

export {
  TEAM_CODES,
  STAT_FIELDS,
  COMBO_FIELDS,
  num,
  normalizeTeam,
  teamCode,
  normalizePlayerName,
  scheduleGames,
  gameStartMs,
  findScheduleGame,
  findBoxscorePlayer,
  actualStat,
  playerParticipated,
  settleObservation
};
