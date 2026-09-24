const MLB_SCHEDULE_BASE =
  "https://statsapi.mlb.com/api/v1/schedule";

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function normalizeMlbSchedule(payload, {
  now = Date.now(),
  hours = 36
} = {}) {
  const lower = now - 4 * 60 * 60 * 1000;
  const upper = now + hours * 60 * 60 * 1000;
  const games = [];

  for (const date of payload?.dates || []) {
    for (const game of date?.games || []) {
      const startsAt = Date.parse(game?.gameDate || "");
      if (!Number.isFinite(startsAt)) continue;
      if (startsAt < lower || startsAt > upper) continue;

      games.push({
        event_id: game?.gamePk ? `mlb-${game.gamePk}` : null,
        game_pk: Number.isFinite(Number(game?.gamePk))
          ? Number(game.gamePk)
          : null,
        sport: "MLB",
        starts_at: new Date(startsAt).toISOString(),
        away_team:
          game?.teams?.away?.team?.name ||
          game?.teams?.away?.team?.clubName ||
          "Away",
        home_team:
          game?.teams?.home?.team?.name ||
          game?.teams?.home?.team?.clubName ||
          "Home",
        status:
          game?.status?.detailedState ||
          game?.status?.abstractGameState ||
          "Scheduled",
        source: "MLB Stats API",
        schedule_only: true
      });
    }
  }

  return games.sort(
    (a, b) =>
      Date.parse(a.starts_at || "") -
      Date.parse(b.starts_at || "")
  );
}

export async function fetchScheduleFallback({
  sport = "MLB",
  hours = 36,
  now = Date.now(),
  fetchImpl = fetch
} = {}) {
  const normalizedSport = String(sport || "MLB").toUpperCase();

  if (normalizedSport !== "MLB") {
    return {
      source: null,
      games: [],
      supported: false,
      reason: `No schedule fallback configured for ${normalizedSport}`
    };
  }

  const start = new Date(now - 4 * 60 * 60 * 1000);
  const end = new Date(now + hours * 60 * 60 * 1000);
  const url =
    `${MLB_SCHEDULE_BASE}?sportId=1` +
    `&startDate=${encodeURIComponent(isoDate(start))}` +
    `&endDate=${encodeURIComponent(isoDate(end))}` +
    "&hydrate=team";

  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "user-agent": "edge-lab/1.0"
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000)
  });

  if (!response.ok) {
    throw new Error(
      `MLB schedule fallback returned ${response.status}`
    );
  }

  const payload = await response.json();
  return {
    source: "MLB Stats API",
    supported: true,
    games: normalizeMlbSchedule(payload, { now, hours })
  };
}
