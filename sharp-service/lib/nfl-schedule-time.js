const EASTERN_TIME_ZONE = "America/New_York";

function numPart(parts, type) {
  const value = parts.find((part) => part.type === type)?.value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function easternLocalToUtcIso(dateText, timeText) {
  const dateMatch = String(dateText || "").match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );
  const timeMatch = String(timeText || "").match(
    /^(\d{1,2}):(\d{2})/
  );
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  const desiredWallClock = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    0
  );
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

  let guess = desiredWallClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = formatter.formatToParts(new Date(guess));
    const observed = Date.UTC(
      numPart(parts, "year"),
      numPart(parts, "month") - 1,
      numPart(parts, "day"),
      numPart(parts, "hour"),
      numPart(parts, "minute"),
      0
    );
    if (!Number.isFinite(observed)) return null;
    const delta = desiredWallClock - observed;
    guess += delta;
    if (delta === 0) break;
  }

  const result = new Date(guess);
  return Number.isFinite(result.getTime())
    ? result.toISOString()
    : null;
}

export function scheduleKickoffIso(game = {}) {
  const gameday = String(game.gameday || "").trim();
  const gametime = String(game.gametime || "").trim();

  const exact = easternLocalToUtcIso(gameday, gametime);
  if (exact) return {
    startsAt: exact,
    source: "gameday+gametime",
    conservativeFallback: false
  };

  const fallback = Date.parse(`${gameday}T00:00:00Z`);
  if (Number.isFinite(fallback)) {
    return {
      startsAt: new Date(fallback).toISOString(),
      source: "gameday-start",
      conservativeFallback: true
    };
  }

  return {
    startsAt: null,
    source: "unavailable",
    conservativeFallback: true
  };
}
