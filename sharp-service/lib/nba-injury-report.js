import {
  easternLocalToUtcIso
} from "./nfl-schedule-time.js";

const OFFICIAL_CDN =
  "https://ak-static.cms.nba.com/referee/injury";
const REPORT_CACHE_TTL_MS = 5 * 60 * 1000;

const state =
  globalThis.__edgeLabNbaInjuryReport ||
  (globalThis.__edgeLabNbaInjuryReport = {
    value: null,
    fetchedAt: 0,
    inFlight: null
  });

const TEAM_NAMES = [
  "Atlanta Hawks",
  "Boston Celtics",
  "Brooklyn Nets",
  "Charlotte Hornets",
  "Chicago Bulls",
  "Cleveland Cavaliers",
  "Dallas Mavericks",
  "Denver Nuggets",
  "Detroit Pistons",
  "Golden State Warriors",
  "Houston Rockets",
  "Indiana Pacers",
  "LA Clippers",
  "Los Angeles Lakers",
  "Memphis Grizzlies",
  "Miami Heat",
  "Milwaukee Bucks",
  "Minnesota Timberwolves",
  "New Orleans Pelicans",
  "New York Knicks",
  "Oklahoma City Thunder",
  "Orlando Magic",
  "Philadelphia 76ers",
  "Phoenix Suns",
  "Portland Trail Blazers",
  "Sacramento Kings",
  "San Antonio Spurs",
  "Toronto Raptors",
  "Utah Jazz",
  "Washington Wizards"
].sort((a, b) => b.length - a.length);

const TEAM_ALIASES = new Map(
  TEAM_NAMES.flatMap((name) => {
    const key = normalizeTeamName(name);
    const aliases = [[key, name]];
    if (name === "LA Clippers") {
      aliases.push([
        normalizeTeamName("Los Angeles Clippers"),
        name
      ]);
    }
    return aliases;
  })
);

function normalizeTeamName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizePlayerName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function canonicalTeam(value) {
  return TEAM_ALIASES.get(
    normalizeTeamName(value)
  ) || null;
}

function easternParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }
  );
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function reportDateString({
  year,
  month,
  day
}) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function reportTimeTokens(hour24, minute) {
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 =
    hour24 % 12 === 0 ? 12 : hour24 % 12;
  const hh = String(hour12).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");

  const tokens = [
    `${hh}_${mm}${suffix}`
  ];
  if (minute === 0) {
    tokens.push(`${hh}${suffix}`);
  }
  return tokens;
}

function candidateReportUrls(
  now = new Date(),
  {
    lookbackHours = 10,
    includePreviousDay = true
  } = {}
) {
  const p = easternParts(now);
  const roundedMinute =
    p.minute >= 30 ? 30 : 0;
  const wallClock = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    roundedMinute
  );

  const urls = [];
  const seen = new Set();
  const slots = Math.max(
    1,
    Math.ceil(lookbackHours * 2) + 1
  );

  for (let index = 0; index < slots; index += 1) {
    const local = new Date(
      wallClock - index * 30 * 60 * 1000
    );
    const date = reportDateString({
      year: local.getUTCFullYear(),
      month: local.getUTCMonth() + 1,
      day: local.getUTCDate()
    });
    for (const token of reportTimeTokens(
      local.getUTCHours(),
      local.getUTCMinutes()
    )) {
      const url =
        `${OFFICIAL_CDN}/Injury-Report_${date}_${token}.pdf`;
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }

  if (includePreviousDay) {
    const previous = new Date(
      Date.UTC(
        p.year,
        p.month - 1,
        p.day
      ) - 24 * 60 * 60 * 1000
    );
    const date = reportDateString({
      year: previous.getUTCFullYear(),
      month: previous.getUTCMonth() + 1,
      day: previous.getUTCDate()
    });
    for (const hour of [23, 22, 21, 20, 19, 18]) {
      for (const minute of [30, 0]) {
        for (const token of reportTimeTokens(
          hour,
          minute
        )) {
          const url =
            `${OFFICIAL_CDN}/Injury-Report_${date}_${token}.pdf`;
          if (!seen.has(url)) {
            seen.add(url);
            urls.push(url);
          }
        }
      }
    }
  }

  return urls;
}

async function reportExists(
  url,
  fetchImpl = fetch
) {
  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(4_000)
    });
    if (response.ok) return true;
    if (![403, 405].includes(response.status)) {
      return false;
    }
  } catch {
    // Fall through to a byte-range GET.
  }

  try {
    const response = await fetchImpl(url, {
      headers: { range: "bytes=0-0" },
      cache: "no-store",
      signal: AbortSignal.timeout(4_000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function discoverLatestOfficialReport({
  now = new Date(),
  fetchImpl = fetch,
  maxCandidates = 24
} = {}) {
  const candidates = candidateReportUrls(now)
    .slice(0, maxCandidates);

  for (const url of candidates) {
    if (await reportExists(url, fetchImpl)) {
      return {
        url,
        checked: candidates.indexOf(url) + 1
      };
    }
  }

  return {
    url: null,
    checked: candidates.length
  };
}

async function extractPdfText(
  arrayBuffer
) {
  const pdfjs = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    disableWorker: true,
    isEvalSupported: false
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber += 1
  ) {
    const page =
      await pdf.getPage(pageNumber);
    const text =
      await page.getTextContent();

    let current = "";
    const lines = [];
    for (const item of text.items || []) {
      const value = String(item?.str || "");
      if (value) {
        current +=
          current && !/^\s/.test(value)
            ? ` ${value}`
            : value;
      }
      if (item?.hasEOL) {
        if (current.trim()) {
          lines.push(current.trim());
        }
        current = "";
      }
    }
    if (current.trim()) {
      lines.push(current.trim());
    }
    pages.push(lines.join("\n"));
  }

  return pages.join("\n");
}

function reportTimestampFromHeader(text) {
  const match = String(text || "").match(
    /Injury Report:\s*(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i
  );
  if (!match) return null;

  const year =
    Number(match[3]) < 100
      ? 2000 + Number(match[3])
      : Number(match[3]);
  let hour = Number(match[4]) % 12;
  if (String(match[6]).toUpperCase() === "PM") {
    hour += 12;
  }
  const date = [
    year,
    String(match[1]).padStart(2, "0"),
    String(match[2]).padStart(2, "0")
  ].join("-");
  const time =
    `${String(hour).padStart(2, "0")}:${match[5]}`;
  return easternLocalToUtcIso(date, time);
}

function displayPlayerName(value) {
  const text = String(value || "").trim();
  const comma = text.indexOf(",");
  if (comma < 0) return text;
  const last = text.slice(0, comma).trim();
  const first = text.slice(comma + 1).trim();
  return `${first} ${last}`.trim();
}

function stripLeadingSchedule(value) {
  let text = String(value || "").trim();
  let gameDate = null;

  const dateMatch = text.match(
    /^(\d{2}\/\d{2}\/\d{4})\s+/
  );
  if (dateMatch) {
    gameDate = dateMatch[1];
    text = text.slice(dateMatch[0].length);
  }

  text = text.replace(
    /^\d{2}:\d{2}\s*\(ET\)\s+/,
    ""
  );
  text = text.replace(
    /^[A-Z]{2,3}@[A-Z]{2,3}\s+/,
    ""
  );

  return { text, gameDate };
}

function parseOfficialInjuryText(
  text,
  {
    sourceUrl = null
  } = {}
) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) =>
      line.replace(/\s+/g, " ").trim()
    )
    .filter(Boolean);

  let currentTeam = null;
  let currentGameDate = null;
  const entries = [];
  const unsubmittedTeams = new Set();
  const submittedTeams = new Set();

  for (const rawLine of lines) {
    if (
      /^Injury Report:/i.test(rawLine) ||
      /^Page \d+ of \d+/i.test(rawLine) ||
      /^Game Date Game Time Matchup Team Player Name Current Status Reason$/i.test(rawLine)
    ) {
      continue;
    }

    const stripped =
      stripLeadingSchedule(rawLine);
    let line = stripped.text;
    if (stripped.gameDate) {
      currentGameDate =
        stripped.gameDate;
    }

    let foundTeam = null;
    for (const team of TEAM_NAMES) {
      if (
        line === team ||
        line.startsWith(`${team} `)
      ) {
        foundTeam = team;
        currentTeam = team;
        submittedTeams.add(team);
        line = line.slice(team.length).trim();
        break;
      }
    }

    if (/NOT YET SUBMITTED/i.test(line)) {
      if (currentTeam || foundTeam) {
        const team =
          currentTeam || foundTeam;
        unsubmittedTeams.add(team);
        submittedTeams.delete(team);
      }
      continue;
    }

    const statusMatch = line.match(
      /\b(Out|Doubtful|Questionable|Probable|Available)\b/i
    );
    if (!statusMatch || !currentTeam) {
      continue;
    }

    const playerRaw =
      line.slice(0, statusMatch.index).trim();
    if (!playerRaw || !playerRaw.includes(",")) {
      continue;
    }

    const status =
      statusMatch[1][0].toUpperCase() +
      statusMatch[1].slice(1).toLowerCase();
    const reason = line
      .slice(
        statusMatch.index +
        statusMatch[0].length
      )
      .trim();

    entries.push({
      gameDate: currentGameDate,
      team: currentTeam,
      playerName:
        displayPlayerName(playerRaw),
      playerNameRaw: playerRaw,
      status,
      reason: reason || null
    });
  }

  return {
    source: "NBA Official",
    sourceUrl,
    reportTimestamp:
      reportTimestampFromHeader(text),
    parsed: true,
    entryCount: entries.length,
    entries,
    submittedTeams:
      [...submittedTeams],
    unsubmittedTeams:
      [...unsubmittedTeams]
  };
}

function normalizedStatus(value) {
  const status =
    String(value || "").toUpperCase();
  if (
    [
      "OUT",
      "DOUBTFUL",
      "QUESTIONABLE",
      "PROBABLE",
      "AVAILABLE"
    ].includes(status)
  ) {
    return status;
  }
  return null;
}

function resolveOfficialAvailability(
  report,
  {
    playerName,
    teamName = null,
    now = new Date(),
    maxNotListedAgeMinutes = 180
  }
) {
  if (!report?.parsed) {
    return {
      officialReportParsed: false,
      officialStatus: null,
      resolvedForPlay: false,
      availabilityBlocked: false,
      reason:
        "Official NBA injury report is unavailable or unparsed."
    };
  }

  const playerKey =
    normalizePlayerName(playerName);
  const team =
    canonicalTeam(teamName);
  const entry = (report.entries || []).find(
    (row) =>
      normalizePlayerName(
        row.playerName
      ) === playerKey &&
      (!team || row.team === team)
  );

  const reportMs = Date.parse(
    report.reportTimestamp || ""
  );
  const ageMinutes =
    Number.isFinite(reportMs)
      ? Math.max(
          0,
          (now.getTime() - reportMs) / 60000
        )
      : null;

  if (entry) {
    const status =
      normalizedStatus(entry.status);
    const blocked =
      ["OUT", "DOUBTFUL"].includes(
        status
      );
    const resolvedForPlay =
      ["AVAILABLE", "PROBABLE"].includes(
        status
      );

    return {
      officialReportParsed: true,
      officialStatus: status,
      resolvedForPlay,
      availabilityBlocked: blocked,
      reportTimestamp:
        report.reportTimestamp,
      reportAgeMinutes:
        ageMinutes === null
          ? null
          : Number(ageMinutes.toFixed(1)),
      sourceUrl:
        report.sourceUrl || null,
      team: entry.team,
      reasonDetail:
        entry.reason || null,
      reason: blocked
        ? `Official NBA injury report lists player as ${status}.`
        : resolvedForPlay
        ? `Official NBA injury report lists player as ${status}.`
        : `Official NBA injury report lists player as ${status}; participation is unresolved.`
    };
  }

  if (
    team &&
    report.unsubmittedTeams?.includes(
      team
    )
  ) {
    return {
      officialReportParsed: true,
      officialStatus:
        "NOT_YET_SUBMITTED",
      resolvedForPlay: false,
      availabilityBlocked: false,
      reportTimestamp:
        report.reportTimestamp,
      reportAgeMinutes:
        ageMinutes === null
          ? null
          : Number(ageMinutes.toFixed(1)),
      sourceUrl:
        report.sourceUrl || null,
      team,
      reason:
        "Team has not yet submitted its official NBA injury report."
    };
  }

  const teamSubmitted =
    team &&
    report.submittedTeams?.includes(team);
  const fresh =
    ageMinutes !== null &&
    ageMinutes <= maxNotListedAgeMinutes;

  if (teamSubmitted && fresh) {
    return {
      officialReportParsed: true,
      officialStatus: "NOT_LISTED",
      resolvedForPlay: true,
      availabilityBlocked: false,
      reportTimestamp:
        report.reportTimestamp,
      reportAgeMinutes:
        Number(ageMinutes.toFixed(1)),
      sourceUrl:
        report.sourceUrl || null,
      team,
      reason:
        "Player is not listed on the team's recent submitted official NBA injury report."
    };
  }

  return {
    officialReportParsed: true,
    officialStatus: null,
    resolvedForPlay: false,
    availabilityBlocked: false,
    reportTimestamp:
      report.reportTimestamp,
    reportAgeMinutes:
      ageMinutes === null
        ? null
        : Number(ageMinutes.toFixed(1)),
    sourceUrl:
      report.sourceUrl || null,
    team,
    reason:
      "Official report was parsed, but the player's current availability could not be resolved safely."
  };
}

async function fetchAndParseOfficialReport({
  now = new Date(),
  fetchImpl = fetch
} = {}) {
  const discovery =
    await discoverLatestOfficialReport({
      now,
      fetchImpl
    });
  if (!discovery.url) {
    return {
      parsed: false,
      source: "NBA Official",
      sourceUrl: null,
      reportTimestamp: null,
      entries: [],
      submittedTeams: [],
      unsubmittedTeams: [],
      error:
        "No recent official NBA injury-report PDF was discovered."
    };
  }

  const response = await fetchImpl(
    discovery.url,
    {
      cache: "no-store",
      signal:
        AbortSignal.timeout(10_000)
    }
  );
  if (!response.ok) {
    return {
      parsed: false,
      source: "NBA Official",
      sourceUrl: discovery.url,
      reportTimestamp: null,
      entries: [],
      submittedTeams: [],
      unsubmittedTeams: [],
      error:
        `Official NBA injury report fetch failed (${response.status}).`
    };
  }

  const text = await extractPdfText(
    await response.arrayBuffer()
  );
  return {
    ...parseOfficialInjuryText(
      text,
      { sourceUrl: discovery.url }
    ),
    discoveryChecked:
      discovery.checked
  };
}

async function loadOfficialNbaInjuryReport({
  now = new Date(),
  fetchImpl = fetch
} = {}) {
  const current = Date.now();
  if (
    state.value &&
    current - state.fetchedAt <
      REPORT_CACHE_TTL_MS
  ) {
    return state.value;
  }

  if (state.inFlight) {
    return state.inFlight;
  }

  const work =
    fetchAndParseOfficialReport({
      now,
      fetchImpl
    });
  state.inFlight = work;

  try {
    const value = await work;
    state.value = value;
    state.fetchedAt = Date.now();
    return value;
  } finally {
    if (state.inFlight === work) {
      state.inFlight = null;
    }
  }
}

export {
  OFFICIAL_CDN,
  TEAM_NAMES,
  canonicalTeam,
  normalizePlayerName,
  candidateReportUrls,
  discoverLatestOfficialReport,
  extractPdfText,
  parseOfficialInjuryText,
  resolveOfficialAvailability,
  fetchAndParseOfficialReport,
  loadOfficialNbaInjuryReport
};
