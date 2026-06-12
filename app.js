const LEADERBOARD_STORAGE_KEY = "us-open-2026-custom-leaderboard";
const PICKS_STORAGE_KEY = "us-open-2026-custom-picks";
const FIELD_STORAGE_KEY = "us-open-2026-player-field";
const APP_VERSION = "2026.06.12.07";
const LEADERBOARD_REFRESH_INTERVAL_MS = 120000;
const DATA_FILES = {
  config: "./data/config.json",
  picks: "./data/picks.json",
  leaderboard: "./data/leaderboard.json",
  players: "./data/players.txt"
};

const DEFAULT_ENTRY_NAMES = ["Mike", "Gary", "Eames"];

const elements = {
  tournamentName: document.getElementById("tournament-name"),
  tournamentSubtitle: document.getElementById("tournament-subtitle"),
  tournamentDates: document.getElementById("tournament-dates"),
  tournamentVenue: document.getElementById("tournament-venue"),
  eventLeader: document.getElementById("event-leader"),
  poolLeader: document.getElementById("pool-leader"),
  boardUpdate: document.getElementById("board-update"),
  scoresLastUpdated: document.getElementById("scores-last-updated"),
  boardPlayerCount: document.getElementById("board-player-count"),
  boardVersion: document.getElementById("board-version"),
  mastersBoard: document.getElementById("masters-board"),
  mastersBoardMobile: document.getElementById("masters-board-mobile"),
  scoreboard: document.getElementById("scoreboard"),
  leaderboard: document.getElementById("leaderboard"),
  adminBackdrop: document.getElementById("admin-backdrop"),
  adminPanel: document.getElementById("admin-panel"),
  leaderboardInput: document.getElementById("leaderboard-input"),
  csvFileInput: document.getElementById("csv-file-input"),
  playerFieldInput: document.getElementById("player-field-input"),
  playerFieldFileInput: document.getElementById("player-field-file-input"),
  entryBuilder: document.getElementById("entry-builder"),
  fieldCount: document.getElementById("field-count"),
  picksStatus: document.getElementById("picks-status"),
  adminStatus: document.getElementById("admin-status"),
  toggleAdmin: document.getElementById("toggle-admin"),
  closeAdmin: document.getElementById("close-admin"),
  applyData: document.getElementById("apply-data"),
  publishData: document.getElementById("publish-data"),
  saveField: document.getElementById("save-field"),
  resetLocalData: document.getElementById("reset-local-data"),
  savePicks: document.getElementById("save-picks"),
  publishPicks: document.getElementById("publish-picks"),
  clearPicks: document.getElementById("clear-picks"),
  emptyStateTemplate: document.getElementById("empty-state-template")
};

let repoLeaderboard = null;
let repoPicks = null;
let latestEntries = [];
let latestPicks = null;
let latestLeaderboard = null;
let latestConfig = null;
let latestFieldPlayers = [];
let boardSort = {
  key: "score",
  direction: "asc"
};

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

async function loadText(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.text();
}

function stableStringify(value) {
  return JSON.stringify(value);
}

async function loadData() {
  try {
    const [config, picks, leaderboard] = await Promise.all([
      loadJson(DATA_FILES.config),
      loadJson(DATA_FILES.picks),
      loadJson(DATA_FILES.leaderboard)
    ]);

    return { config, picks, leaderboard };
  } catch (error) {
    if (window.US_OPEN_CONFIG && window.US_OPEN_PICKS && window.US_OPEN_LEADERBOARD) {
      return {
        config: window.US_OPEN_CONFIG,
        picks: window.US_OPEN_PICKS,
        leaderboard: window.US_OPEN_LEADERBOARD
      };
    }

    throw error;
  }
}

function parseScoreToPar(value) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "E") return 0;
  const parsed = Number(normalized.replace("+", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/,\s*[a-z .'-]+$/i, "")
    .replace(/\([^)]+\)/g, "")
    .replace(/\./g, "")
    .replace(/\bcameron young\b/g, "cam young")
    .replace(/\bj j spaun\b/g, "jj spaun")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizePlayerName(value) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned.includes(",")) {
    return cleaned;
  }

  const row = parseCsvRow(cleaned);
  if (row.length >= 2) {
    return row[0].trim();
  }

  return cleaned.replace(/,\s*[A-Za-z .'-]+$/, "").trim();
}

function formatScore(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : `${value}`;
}

function formatLastUpdated(value) {
  if (!value) return "waiting for data";
  return value;
}

function renderTournamentName(name) {
  const value = String(name || "").trim();
  const normalized = value.replace(/\bU\.S\.\b/g, "US");
  const suffix = "Pick Scoreboard";

  if (normalized.endsWith(suffix)) {
    const firstLine = normalized.slice(0, -suffix.length).trim();
    return `
      <span class="hero-title-line hero-title-line-primary">${escapeHtml(firstLine)}</span>
      <span class="hero-title-line hero-title-line-secondary">${escapeHtml(suffix)}</span>
    `;
  }

  return `<span class="hero-title-line hero-title-line-primary">${escapeHtml(normalized)}</span>`;
}

function buildTournamentLeaderTextFromRows(rows, header) {
  const playerColumnIndex = findColumnIndex(header, ["PLAYER", "NAME"]);
  const positionColumnIndex = findColumnIndex(header, ["POS", "POSITION", "PLACE"]);
  const toParColumnIndex = findColumnIndex(header, ["TO PAR", "TO_PAR", "TOPAR", "SCORE", "TOTAL"]);

  if (playerColumnIndex === -1 || toParColumnIndex === -1) return null;

  const parsedRows = rows
    .map((row) => {
      const name = row[playerColumnIndex];
      const toPar = row[toParColumnIndex];
      const position = positionColumnIndex >= 0 ? row[positionColumnIndex] : "";
      const scoreToPar = parseScoreToPar(toPar);
      return {
        name,
        position,
        toPar,
        scoreToPar
      };
    })
    .filter((row) => row.name && typeof row.scoreToPar === "number");

  if (!parsedRows.length) return null;

  const bestScore = Math.min(...parsedRows.map((row) => row.scoreToPar));
  const leaders = parsedRows.filter((row) => row.scoreToPar === bestScore).slice(0, 3);
  return leaders.map((row) => `${row.name} (${formatScore(row.scoreToPar)})`).join(" / ");
}

function getScoreClass(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "na";
  if (value > 0) return "over";
  if (value < 0) return "under";
  return "even";
}

function formatPlayerStatus(player) {
  const thru = String(player?.thru || "").trim().toUpperCase();
  if (thru === "F") return "Finished";
  return player?.status || (player?.found ? "Active" : "Not found");
}

function hasLiveRoundData(player) {
  const thru = String(player.thru || "").trim().toUpperCase();
  const today = String(player.today || "").trim().toUpperCase();
  const status = String(player.status || "").trim().toLowerCase();

  if (typeof player.scoreToPar === "number") return true;
  if (thru && thru !== "--") return true;
  if (today && today !== "--") return true;
  return status.includes("live") || status.includes("final") || status.includes("complete") || status.includes("round");
}

function parsePosition(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function parseTeeTime(value) {
  if (!value || value === "--") return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hours = Number(match[1]) % 12;
  const minutes = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === "PM") hours += 12;
  return (hours * 60) + minutes;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeReadStorage(key) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function getStoredLeaderboard() {
  return safeReadStorage(LEADERBOARD_STORAGE_KEY);
}

function getStoredPicks() {
  return safeReadStorage(PICKS_STORAGE_KEY);
}

function getStoredFieldPlayers() {
  return safeReadStorage(FIELD_STORAGE_KEY);
}

function normalizeEntry(entry, teamSize) {
  const picks = Array.isArray(entry?.picks) ? entry.picks : [];
  return {
    name: String(entry?.name || "Entry").trim() || "Entry",
    picks: picks
      .map((pick) => sanitizePlayerName(pick))
      .filter(Boolean)
      .slice(0, teamSize)
  };
}

function normalizePicksData(payload, config) {
  const teamSize = config?.scoring?.teamSize || 7;
  const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
  const preferredNames = rawEntries.length ? rawEntries.map((entry) => entry?.name) : DEFAULT_ENTRY_NAMES;
  const names = preferredNames.slice(0, 3);

  while (names.length < 3) {
    names.push(DEFAULT_ENTRY_NAMES[names.length] || `Entry ${names.length + 1}`);
  }

  return {
    entries: names.map((name, index) => {
      const source = rawEntries[index] || { name, picks: [] };
      return normalizeEntry({ name, picks: source.picks }, teamSize);
    })
  };
}

function validateLeaderboardData(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.players)) {
    throw new Error("Leaderboard JSON must include a players array.");
  }
  return normalizeLeaderboardData(payload);
}

function isCompletedTournamentStatus(player) {
  const status = String(player.status || "").toLowerCase();
  return status.includes("final") ||
    status.includes("complete") ||
    status.includes("completed") ||
    status.includes("champion") ||
    status.includes("round 4");
}

function normalizeLeaderboardData(payload) {
  const players = payload.players.map((player) => ({
    ...player,
    isChampion: Boolean(player.isChampion)
  }));

  const explicitChampions = players.filter((player) => player.isChampion);
  if (explicitChampions.length === 1) {
    return { ...payload, players };
  }

  const inferredChampions = players.filter((player) => (
    parsePosition(player.position) === 1 && isCompletedTournamentStatus(player)
  ));

  if (inferredChampions.length === 1) {
    const championName = normalizeName(inferredChampions[0].name);
    return {
      ...payload,
      players: players.map((player) => ({
        ...player,
        isChampion: normalizeName(player.name) === championName
      }))
    };
  }

  return { ...payload, players };
}

function collectDraftedPlayers(picks) {
  return Array.from(
    new Set(
      picks.entries.flatMap((entry) => entry.picks.map((name) => sanitizePlayerName(name))).filter(Boolean)
    )
  );
}

function buildLookup(players) {
  const lookup = new Map();
  players.forEach((player) => {
    lookup.set(normalizeName(player.name), { ...player, scoreToPar: parseScoreToPar(player.toPar) });
  });
  return lookup;
}

function detectRowDelimiter(line) {
  if (line.includes("\t")) return "\t";
  return ",";
}

function parseCsvRow(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  const delimiter = detectRowDelimiter(line);

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  values.push(current.trim());
  return values.map((value) => value.replace(/^"|"$/g, "").trim());
}

function findColumnIndex(header, names) {
  return header.findIndex((cell) => names.includes(cell));
}

function fixCommonMojibake(value) {
  return String(value || "")
    .replace(/Ã…/g, "Å")
    .replace(/Ã¤/g, "ä")
    .replace(/Ã„/g, "Ä")
    .replace(/Ã¶/g, "ö")
    .replace(/Ã–/g, "Ö")
    .replace(/Ã¼/g, "ü")
    .replace(/Ãœ/g, "Ü")
    .replace(/Ã¸/g, "ø")
    .replace(/Ã˜/g, "Ø")
    .replace(/Ã¦/g, "æ")
    .replace(/Ã†/g, "Æ")
    .replace(/Ã©/g, "é")
    .replace(/Ã‰/g, "É")
    .replace(/Ã¨/g, "è")
    .replace(/Ã¡/g, "á")
    .replace(/ÃÁ/g, "Á")
    .replace(/Ãí/g, "í")
    .replace(/Ãñ/g, "ñ")
    .replace(/ÃÑ/g, "Ñ")
    .replace(/â€™/g, "'")
    .replace(/â€“/g, "-")
    .replace(/â€”/g, "-");
}

function cleanImportedName(value) {
  return fixCommonMojibake(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function parsePlayerField(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) {
    throw new Error("Paste player names or import a player file first.");
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let names = [];

  if (lines.length && /(PLAYER|NAME)/i.test(lines[0])) {
    const header = parseCsvRow(lines[0]).map((cell) => cell.toUpperCase());
    const nameIndex = findColumnIndex(header, ["PLAYER", "NAME"]);
    const firstNameIndex = findColumnIndex(header, ["FIRST NAME", "FIRST_NAME", "FIRST"]);
    const lastNameIndex = findColumnIndex(header, ["LAST NAME", "LAST_NAME", "LAST"]);

    if (nameIndex === -1 && (firstNameIndex === -1 || lastNameIndex === -1)) {
      throw new Error("Player import file must include a PLAYER/NAME column or FIRST NAME and LAST NAME columns.");
    }

    names = lines
      .slice(1)
      .map(parseCsvRow)
      .map((row) => {
        if (nameIndex >= 0) {
          return row[nameIndex];
        }

        const firstName = cleanImportedName(row[firstNameIndex]);
        const lastName = cleanImportedName(row[lastNameIndex]);
        return `${firstName} ${lastName}`.trim();
      })
      .filter(Boolean);
  } else {
    names = lines.map((line) => {
      const row = parseCsvRow(line);
      if (row.length >= 2) {
        return row[0];
      }
      return line;
    });
  }

  const deduped = [];
  const seen = new Set();
  names.forEach((name) => {
    const clean = sanitizePlayerName(cleanImportedName(name));
    if (!clean) return;
    const normalized = normalizeName(clean);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    deduped.push(clean);
  });

  if (!deduped.length) {
    throw new Error("No player names were recognized in the imported field.");
  }

  return deduped.sort((a, b) => a.localeCompare(b));
}

function parseLeaderboardCsv(rawText, currentLeaderboard, picks) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error("CSV file is empty.");
  }

  const header = parseCsvRow(lines[0]).map((cell) => cell.toUpperCase());
  const csvRows = lines.slice(1).map(parseCsvRow);
  const playerColumnIndex = findColumnIndex(header, ["PLAYER", "NAME"]);
  const teeTimeColumnIndex = findColumnIndex(header, ["TEE TIME", "TEE_TIME", "TEETIME"]);
  const positionColumnIndex = findColumnIndex(header, ["POS", "POSITION", "PLACE"]);
  const toParColumnIndex = findColumnIndex(header, ["TO PAR", "TO_PAR", "TOPAR", "SCORE", "TOTAL"]);
  const todayColumnIndex = findColumnIndex(header, ["TODAY", "ROUND", "R1", "ROUND 1"]);
  const thruColumnIndex = findColumnIndex(header, ["THRU", "THROUGH"]);
  const statusColumnIndex = findColumnIndex(header, ["STATUS"]);

  if (playerColumnIndex === -1) {
    throw new Error("CSV must include a PLAYER column.");
  }

  if (
    teeTimeColumnIndex === -1 &&
    positionColumnIndex === -1 &&
    toParColumnIndex === -1 &&
    todayColumnIndex === -1 &&
    thruColumnIndex === -1 &&
    statusColumnIndex === -1
  ) {
    throw new Error("CSV must include tee time or score columns to import.");
  }

  const draftedPlayers = collectDraftedPlayers(picks);
  const currentLookup = buildLookup(currentLeaderboard.players);
  const draftedByName = new Map(
    draftedPlayers.map((name) => [normalizeName(name), name])
  );
  const updates = new Map();

  csvRows.forEach((row) => {
    const rawPlayerName = row[playerColumnIndex];
    if (!rawPlayerName) return;

    const normalized = normalizeName(rawPlayerName);
    const draftedName = draftedByName.get(normalized);
    if (!draftedName) return;

    const existing = currentLookup.get(normalized) || {
      name: draftedName,
      position: "--",
      toPar: "--",
      today: "--",
      thru: "--",
      teeTime: "--",
      status: "Updated",
      madeCut: false,
      isChampion: false,
      scoreToPar: null
    };

    const rawToday = todayColumnIndex >= 0 ? row[todayColumnIndex] : "";
    const rawToPar = toParColumnIndex >= 0 ? row[toParColumnIndex] : "";
    const rawThru = thruColumnIndex >= 0 ? row[thruColumnIndex] : "";
    const rawTeeTime = teeTimeColumnIndex >= 0 ? row[teeTimeColumnIndex] : "";
    const thruLooksLikeTeeTime = parseTeeTime(rawThru) !== null;
    const normalizedThru = rawThru && !thruLooksLikeTeeTime ? rawThru.toUpperCase() : "--";
    const normalizedTeeTime = rawTeeTime
      ? rawTeeTime
      : thruLooksLikeTeeTime
        ? rawThru
        : existing.teeTime || "--";
    const fallbackToPar = rawToPar || ((existing.toPar === "--" || !existing.toPar) ? rawToday : "");
    const normalizedToPar = fallbackToPar ? fallbackToPar.toUpperCase() : existing.toPar || "--";

    updates.set(normalized, {
      ...existing,
      name: draftedName,
      position: positionColumnIndex >= 0 && row[positionColumnIndex] ? row[positionColumnIndex].toUpperCase() : existing.position || "--",
      toPar: normalizedToPar,
      today: rawToday ? rawToday.toUpperCase() : existing.today || "--",
      thru: normalizedThru,
      teeTime: normalizedTeeTime,
      status: statusColumnIndex >= 0 && row[statusColumnIndex]
        ? row[statusColumnIndex]
        : thruLooksLikeTeeTime
          ? "Scheduled"
          : (rawToday || rawThru) ? "Live" : existing.status || "Updated",
      madeCut: (statusColumnIndex >= 0 && /cut/i.test(row[statusColumnIndex])) ? false : existing.madeCut,
      isChampion: existing.isChampion || false,
      scoreToPar: parseScoreToPar(normalizedToPar)
    });
  });

  if (!updates.size) {
    throw new Error("No drafted golfers were recognized in the CSV.");
  }

  const tournamentLeaderText = buildTournamentLeaderTextFromRows(csvRows, header);

  const mergedPlayers = draftedPlayers.map((name) => {
    const normalized = normalizeName(name);
    return updates.get(normalized) || currentLookup.get(normalized) || {
      name,
      position: "--",
      toPar: "--",
      today: "--",
      thru: "--",
      teeTime: "--",
      status: "Not found",
      madeCut: false,
      isChampion: false,
      scoreToPar: null
    };
  });

  return {
    lastUpdated: `Imported CSV on ${new Date().toLocaleString()}`,
    tournamentLeaderText,
    players: mergedPlayers
  };
}

function parseRawLeaderboardInput(rawText, currentLeaderboard, picks) {
  const draftedPlayers = collectDraftedPlayers(picks);
  const currentLookup = buildLookup(currentLeaderboard.players);
  const normalizedDrafted = draftedPlayers.map((name) => ({
    name,
    normalized: normalizeName(name)
  }));

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const matched = new Map();

  lines.forEach((line) => {
    const normalizedLine = normalizeName(line);
    const drafted = normalizedDrafted.find((player) => normalizedLine.includes(player.normalized));
    if (!drafted) return;

    const positionMatch = line.match(/\b(T?\d+|CUT|WD|DQ)\b/i);
    const scoreMatch = line.match(/(^|\s)(E|[+-]\d+)(?=\s|$)/i);
    const thruMatch = line.match(/\b(F|WD|DQ|CUT|[1-9]|1[0-8])\b/i);

    const afterName = line.split(new RegExp(escapeRegExp(drafted.name), "i"))[1] || "";
    const trailingScoreMatches = Array.from(afterName.matchAll(/\b(E|[+-]\d+)\b/gi)).map((match) => match[1]);
    const todayValue = trailingScoreMatches.length > 1 ? trailingScoreMatches[1] : trailingScoreMatches[0] || "--";

    const existing = currentLookup.get(drafted.normalized) || { name: drafted.name };

    matched.set(drafted.normalized, {
      ...existing,
      name: drafted.name,
      position: positionMatch ? positionMatch[1].toUpperCase() : existing.position || "--",
      toPar: scoreMatch ? scoreMatch[2].toUpperCase() : existing.toPar || "--",
      today: todayValue,
      thru: thruMatch ? thruMatch[1].toUpperCase() : existing.thru || "--",
      teeTime: existing.teeTime || "--",
      status: /cut/i.test(line) ? "Cut" : /wd/i.test(line) ? "WD" : existing.status || "Updated",
      scoreToPar: parseScoreToPar(scoreMatch ? scoreMatch[2] : existing.toPar),
      madeCut: /cut/i.test(line) ? false : existing.madeCut,
      isChampion: existing.isChampion || false
    });
  });

  if (!matched.size) {
    throw new Error("No drafted golfers were recognized. Paste rows that include player names.");
  }

  const mergedPlayers = draftedPlayers.map((name) => {
    const normalized = normalizeName(name);
    return matched.get(normalized) || currentLookup.get(normalized) || {
      name,
      position: "--",
      toPar: "--",
      today: "--",
      thru: "--",
      teeTime: "--",
      status: "Not found",
      madeCut: false,
      isChampion: false
    };
  });

  return {
    lastUpdated: `Imported on ${new Date().toLocaleString()}`,
    players: mergedPlayers
  };
}

function computeEntry(entry, lookup, scoring) {
  const picks = entry.picks.map((name) => {
    const player = lookup.get(normalizeName(name));
    if (!player) {
      return { name, found: false, counted: false, scoreToPar: null, position: "--", status: "Not found" };
    }
    return { ...player, name, found: true, counted: false };
  });

  const sortable = picks
    .filter((pick) => pick.found && typeof pick.scoreToPar === "number")
    .sort((a, b) => a.scoreToPar - b.scoreToPar);

  sortable.slice(0, scoring.countBest).forEach((pick) => {
    pick.counted = true;
  });

  const counted = picks.filter((pick) => pick.counted);
  const rawScore = counted.reduce((sum, pick) => sum + pick.scoreToPar, 0);
  const championCount = picks.filter((pick) => pick.found && pick.isChampion).length;
  const topTenCount = picks.filter((pick) => pick.found && (parsePosition(pick.position) ?? 999) <= 10).length;
  const madeCutCount = picks.filter((pick) => pick.found && pick.madeCut).length;
  const bonus =
    championCount * scoring.bonuses.champion +
    topTenCount * scoring.bonuses.top10 +
    madeCutCount * scoring.bonuses.madeCut;

  return {
    name: entry.name,
    rawScore,
    bonus,
    adjustedScore: counted.length ? rawScore - bonus : null,
    counted,
    picks,
    championCount,
    topTenCount,
    madeCutCount,
    hasChampion: championCount > 0
  };
}

function compareEntries(a, b) {
  if (a.hasChampion && !b.hasChampion) return -1;
  if (!a.hasChampion && b.hasChampion) return 1;
  if (a.adjustedScore === null) return 1;
  if (b.adjustedScore === null) return -1;
  if (a.adjustedScore !== b.adjustedScore) return a.adjustedScore - b.adjustedScore;
  if (a.rawScore !== b.rawScore) return a.rawScore - b.rawScore;
  return a.name.localeCompare(b.name);
}

function renderEmptyState(target) {
  target.innerHTML = elements.emptyStateTemplate.innerHTML;
}

function downloadTextFile(filename, contents, mimeType = "application/json;charset=utf-8") {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildLeaderboardFileContents() {
  if (!latestLeaderboard) {
    throw new Error("No leaderboard data is loaded yet.");
  }

  const jsonText = `${JSON.stringify(latestLeaderboard, null, 2)}\n`;
  const jsText = `window.US_OPEN_LEADERBOARD = ${JSON.stringify(latestLeaderboard, null, 2)};\n`;
  return { jsonText, jsText };
}

function buildPicksFileContents() {
  if (!latestPicks) {
    throw new Error("No picks are loaded yet.");
  }

  const jsonText = `${JSON.stringify(latestPicks, null, 2)}\n`;
  const jsText = `window.US_OPEN_PICKS = ${JSON.stringify(latestPicks, null, 2)};\n`;
  return { jsonText, jsText };
}

async function saveFileWithPicker(suggestedName, contents, mimeType, extension) {
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: [
      {
        description: `${extension.toUpperCase()} files`,
        accept: {
          [mimeType]: [extension]
        }
      }
    ]
  });

  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}

async function publishLeaderboardFiles() {
  const { jsonText, jsText } = buildLeaderboardFileContents();

  if (window.showSaveFilePicker) {
    await saveFileWithPicker("leaderboard.json", jsonText, "application/json", ".json");
    await saveFileWithPicker("leaderboard.js", jsText, "text/javascript", ".js");
    return "Saved leaderboard.json and leaderboard.js. Commit and push both files so mobile devices get the update.";
  }

  downloadTextFile("leaderboard.json", jsonText, "application/json;charset=utf-8");
  downloadTextFile("leaderboard.js", jsText, "text/javascript;charset=utf-8");
  return "Downloaded leaderboard.json and leaderboard.js. Replace both repo files, then commit and push.";
}

async function publishPicksFiles() {
  const { jsonText, jsText } = buildPicksFileContents();

  if (window.showSaveFilePicker) {
    await saveFileWithPicker("picks.json", jsonText, "application/json", ".json");
    await saveFileWithPicker("picks.js", jsText, "text/javascript", ".js");
    return "Saved picks.json and picks.js. Commit and push both files when you want the picks shared.";
  }

  downloadTextFile("picks.json", jsonText, "application/json;charset=utf-8");
  downloadTextFile("picks.js", jsText, "text/javascript;charset=utf-8");
  return "Downloaded picks.json and picks.js. Replace both repo files, then commit and push.";
}

function applyResponsiveBoardMode() {
  const useCompactTable = window.matchMedia("(max-width: 920px)").matches;
  elements.mastersBoard.style.display = "";
  elements.mastersBoardMobile.style.display = useCompactTable ? "none" : "";

  const boardTableWrap = elements.mastersBoard;
  if (useCompactTable) {
    boardTableWrap.style.display = "block";
    boardTableWrap.style.overflowX = "auto";
  } else {
    boardTableWrap.style.display = "";
    boardTableWrap.style.overflowX = "";
  }
}

function renderScoreboard(entries) {
  if (!entries.length) return renderEmptyState(elements.scoreboard);

  const rows = entries.map((entry, index) => `
    <tr>
      <td><span class="rank-pill">${index + 1}</span></td>
      <td><strong>${escapeHtml(entry.name)}</strong></td>
      <td><span class="score-pill ${index === 0 ? "leading" : ""} ${entry.hasChampion ? "" : getScoreClass(entry.rawScore)}">${entry.hasChampion ? "Winner drafted" : formatScore(entry.rawScore)}</span></td>
    </tr>
  `).join("");

  elements.scoreboard.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Entry</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderLeaderboard(players) {
  if (!players || !players.length) {
    renderEmptyState(elements.leaderboard);
    return;
  }

  const topFive = players
    .filter((player) => hasLiveRoundData(player))
    .slice()
    .sort((a, b) => {
      const aScore = a.scoreToPar ?? 999;
      const bScore = b.scoreToPar ?? 999;
      if (aScore !== bScore) return aScore - bScore;
      const aPos = parsePosition(a.position) ?? 999;
      const bPos = parsePosition(b.position) ?? 999;
      if (aPos !== bPos) return aPos - bPos;
      const aThru = a.thru === "F" ? 99 : (Number(a.thru) || 0);
      const bThru = b.thru === "F" ? 99 : (Number(b.thru) || 0);
      if (aThru !== bThru) return bThru - aThru;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 5);

  if (!topFive.length) {
    elements.leaderboard.innerHTML = `
      <div class="empty-state">
        <p>Top drafted golfers will show here once live round data starts coming in.</p>
      </div>
    `;
    return;
  }

  const rows = topFive.map((player, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(player.name)}</strong></td>
      <td>${escapeHtml(player.position || "--")}</td>
      <td><span class="mini-score ${getScoreClass(player.scoreToPar)}">${formatScore(player.scoreToPar)}</span></td>
      <td>${escapeHtml(player.thru || "--")}</td>
    </tr>
  `).join("");

  elements.leaderboard.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th>Pos</th>
          <th>Score</th>
          <th>Thru</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderMastersBoard(entries) {
  const draftedPlayers = new Map();

  entries.forEach((entry) => {
    entry.picks.forEach((pick) => {
      const key = normalizeName(pick.name);
      if (!draftedPlayers.has(key)) {
        draftedPlayers.set(key, {
          ...pick,
          owners: [entry.name]
        });
      } else {
        draftedPlayers.get(key).owners.push(entry.name);
      }
    });
  });

  const boardPlayers = Array.from(draftedPlayers.values())
    .sort(compareBoardPlayers);

  if (!boardPlayers.length) {
    elements.boardPlayerCount.textContent = "No picks saved yet";
    renderEmptyState(elements.mastersBoard);
    renderEmptyState(elements.mastersBoardMobile);
    return;
  }

  elements.boardPlayerCount.textContent = `${boardPlayers.length} drafted golfers`;

  const rows = boardPlayers.map((player) => {
    const totalClass = getScoreClass(player.scoreToPar);
    return `
      <tr>
        <td class="board-owner">${player.owners.map((owner) => `<span class="owner-chip">${escapeHtml(owner)}</span>`).join("")}</td>
        <td>${escapeHtml(player.position || "--")}</td>
        <td class="board-player">${escapeHtml(player.name)}</td>
        <td class="board-total"><span class="board-score-pill ${totalClass}">${formatScore(player.scoreToPar)}</span></td>
        <td>${escapeHtml(player.teeTime || "--")}</td>
        <td>${escapeHtml(player.thru || "--")}</td>
        <td>${escapeHtml(player.today || "--")}</td>
        <td>${escapeHtml(formatPlayerStatus(player))}</td>
      </tr>
    `;
  }).join("");

  const mobileCards = boardPlayers.map((player) => {
    const totalClass = getScoreClass(player.scoreToPar);
    return `
      <article class="mobile-board-card">
        <div class="mobile-board-top">
          <div class="mobile-board-owners">${player.owners.map((owner) => `<span class="owner-chip">${escapeHtml(owner)}</span>`).join("")}</div>
          <div class="mobile-board-pos">${escapeHtml(player.position || "--")}</div>
        </div>
        <div class="mobile-board-player">${escapeHtml(player.name)}</div>
        <div class="mobile-board-tee"><strong>Tee Time</strong> ${escapeHtml(player.teeTime || "--")}</div>
        <div class="mobile-board-total ${totalClass}">${formatScore(player.scoreToPar)}</div>
        <div class="mobile-board-meta">
          <span><strong>Thru</strong> ${escapeHtml(player.thru || "--")}</span>
          <span><strong>Today</strong> ${escapeHtml(player.today || "--")}</span>
          <span><strong>Status</strong> ${escapeHtml(formatPlayerStatus(player))}</span>
        </div>
      </article>
    `;
  }).join("");

  elements.mastersBoard.innerHTML = `
    <table class="masters-board">
      <thead>
        <tr>
          <th class="picked-by"><button class="sort-button active" type="button" data-sort-key="owners">Picked By${renderSortLabel("owners")}</button></th>
          <th><button class="sort-button" type="button" data-sort-key="position">Pos${renderSortLabel("position")}</button></th>
          <th><button class="sort-button" type="button" data-sort-key="player">Player${renderSortLabel("player")}</button></th>
          <th><button class="sort-button" type="button" data-sort-key="score">Total${renderSortLabel("score")}</button></th>
          <th><button class="sort-button" type="button" data-sort-key="teeTime">Tee Time${renderSortLabel("teeTime")}</button></th>
          <th>Thru</th>
          <th>Today</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  elements.mastersBoardMobile.innerHTML = mobileCards;
  applyResponsiveBoardMode();

  elements.mastersBoard.querySelectorAll("[data-sort-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.getAttribute("data-sort-key");
      if (boardSort.key === key) {
        boardSort.direction = boardSort.direction === "asc" ? "desc" : "asc";
      } else {
        boardSort.key = key;
        boardSort.direction = "asc";
      }
      renderMastersBoard(latestEntries);
    });
  });
}

function updateHeader(config, entries, leaderboard) {
  elements.tournamentName.innerHTML = renderTournamentName(config.tournament.name);
  elements.tournamentSubtitle.textContent = config.tournament.subtitle;
  elements.tournamentDates.textContent = config.tournament.dates;
  elements.tournamentVenue.textContent = config.tournament.venue;
  const lastUpdatedText = `Scores last updated: ${formatLastUpdated(leaderboard.lastUpdated)}`;
  elements.boardUpdate.textContent = lastUpdatedText;
  elements.scoresLastUpdated.textContent = lastUpdatedText;
  elements.boardVersion.textContent = `Build ${APP_VERSION}`;

  const sortedLeaders = leaderboard.players
    .slice()
    .sort((a, b) => {
      const aScore = parseScoreToPar(a.toPar) ?? 999;
      const bScore = parseScoreToPar(b.toPar) ?? 999;
      if (aScore !== bScore) return aScore - bScore;
      return (parsePosition(a.position) ?? 999) - (parsePosition(b.position) ?? 999);
    });

  const bestLeaderScore = sortedLeaders.length ? (parseScoreToPar(sortedLeaders[0].toPar) ?? 999) : 999;
  const fallbackLeader = sortedLeaders
    .filter((player) => (parseScoreToPar(player.toPar) ?? 999) === bestLeaderScore)
    .slice(0, 3)
    .map((player) => `${player.name} (${formatScore(parseScoreToPar(player.toPar))})`)
    .join(" / ");

  const rawLeaderText = String(leaderboard.tournamentLeaderText || "").trim();
  const malformedLeaderText = (
    !rawLeaderText ||
    rawLeaderText.length > 120 ||
    /[{}[\]]/.test(rawLeaderText) ||
    /(firstName|lastName|displayName|bettingProfile|countryFlag|abbreviations)/i.test(rawLeaderText)
  );
  elements.eventLeader.textContent = malformedLeaderText ? (fallbackLeader || "No leaderboard data") : rawLeaderText;
  elements.poolLeader.textContent = entries[0]
    ? `${entries[0].name} (${entries[0].hasChampion ? "winner drafted" : formatScore(entries[0].rawScore)})`
    : "No pool entries";
}

function seedAdminEditor() {
  elements.leaderboardInput.value = "";
  elements.leaderboardInput.placeholder = "Paste JSON, leaderboard rows, or CSV here.";
}

function renderFieldStatus() {
  elements.fieldCount.textContent = latestFieldPlayers.length
    ? `${latestFieldPlayers.length} players loaded`
    : "No player field loaded yet";
}

function buildPickSelectOptions(selectedName) {
  const sortedPlayers = latestFieldPlayers.slice().sort((a, b) => a.localeCompare(b));
  const options = [`<option value="">Open slot</option>`];
  sortedPlayers.forEach((name) => {
    const selected = name === selectedName ? " selected" : "";
    options.push(`<option value="${escapeHtml(name)}"${selected}>${escapeHtml(name)}</option>`);
  });
  return options.join("");
}

function renderEntryBuilder(picks, config) {
  const teamSize = config.scoring.teamSize;
  if (!latestFieldPlayers.length) {
    elements.entryBuilder.innerHTML = `
      <div class="builder-empty">
        <p>Import the championship field first, then your pick selectors for Mike, Gary, and Eames will appear here.</p>
      </div>
    `;
    return;
  }

  const cards = picks.entries.map((entry, entryIndex) => {
    const slots = [];
    for (let slotIndex = 0; slotIndex < teamSize; slotIndex += 1) {
      const selectedName = entry.picks[slotIndex] || "";
      slots.push(`
        <label class="pick-slot">
          <span>Pick ${slotIndex + 1}</span>
          <select data-entry-index="${entryIndex}" data-slot-index="${slotIndex}">
            ${buildPickSelectOptions(selectedName)}
          </select>
        </label>
      `);
    }

    return `
      <section class="entry-card">
        <div class="entry-card-header">
          <h3>${escapeHtml(entry.name)}</h3>
          <p>${entry.picks.filter(Boolean).length} of ${teamSize} picks selected</p>
        </div>
        <div class="pick-grid">
          ${slots.join("")}
        </div>
      </section>
    `;
  }).join("");

  elements.entryBuilder.innerHTML = cards;
  elements.entryBuilder.querySelectorAll("select[data-entry-index]").forEach((select) => {
    select.addEventListener("change", handlePickSelectionChange);
  });
}

function updatePicksStatus(message, isError = false) {
  elements.picksStatus.textContent = message;
  elements.picksStatus.classList.toggle("status-error", isError);
}

function saveFieldPlayers(players) {
  latestFieldPlayers = players.slice();
  localStorage.setItem(FIELD_STORAGE_KEY, JSON.stringify(latestFieldPlayers));
  renderFieldStatus();
  renderEntryBuilder(latestPicks, latestConfig);
}

function savePicksToStorage(picks) {
  latestPicks = picks;
  localStorage.setItem(PICKS_STORAGE_KEY, JSON.stringify(picks));
}

function resetLocalAppData() {
  localStorage.removeItem(LEADERBOARD_STORAGE_KEY);
  localStorage.removeItem(PICKS_STORAGE_KEY);
  localStorage.removeItem(FIELD_STORAGE_KEY);
  window.location.reload();
}

function handlePickSelectionChange(event) {
  const select = event.currentTarget;
  const entryIndex = Number(select.getAttribute("data-entry-index"));
  const slotIndex = Number(select.getAttribute("data-slot-index"));
  const nextValue = select.value.trim();

  const nextPicks = {
    entries: latestPicks.entries.map((entry) => ({
      name: entry.name,
      picks: entry.picks.slice()
    }))
  };

  while (nextPicks.entries[entryIndex].picks.length < latestConfig.scoring.teamSize) {
    nextPicks.entries[entryIndex].picks.push("");
  }

  nextPicks.entries[entryIndex].picks[slotIndex] = nextValue;
  nextPicks.entries = nextPicks.entries.map((entry) => ({
    name: entry.name,
    picks: entry.picks.map((pick) => String(pick || "").trim()).filter(Boolean)
  }));

  savePicksToStorage(nextPicks);
  renderApp(latestConfig, nextPicks, latestLeaderboard);
  renderEntryBuilder(nextPicks, latestConfig);
  updatePicksStatus("Pick updated in this browser.");
}

function clearAllPicks() {
  const cleared = {
    entries: latestPicks.entries.map((entry) => ({
      name: entry.name,
      picks: []
    }))
  };
  savePicksToStorage(cleared);
  renderApp(latestConfig, cleared, latestLeaderboard);
  renderEntryBuilder(cleared, latestConfig);
  updatePicksStatus("Cleared all picks for Mike, Gary, and Eames.");
}

function renderApp(config, picks, leaderboard) {
  const normalizedPicks = normalizePicksData(picks, config);
  const normalizedLeaderboard = normalizeLeaderboardData(leaderboard);
  const lookup = buildLookup(normalizedLeaderboard.players);
  const entries = normalizedPicks.entries.map((entry) => computeEntry(entry, lookup, config.scoring)).sort(compareEntries);
  latestEntries = entries;
  latestPicks = normalizedPicks;
  latestLeaderboard = normalizedLeaderboard;
  latestConfig = config;
  updateHeader(config, entries, normalizedLeaderboard);
  renderMastersBoard(entries);
  renderScoreboard(entries);
  renderLeaderboard(normalizedLeaderboard.players);
  renderFieldStatus();
  renderEntryBuilder(normalizedPicks, config);
  seedAdminEditor();
}

function setAdminOpen(isOpen) {
  document.body.classList.toggle("admin-open", isOpen);
  elements.adminBackdrop.classList.toggle("hidden", !isOpen);
  elements.adminBackdrop.setAttribute("aria-hidden", String(!isOpen));
  elements.adminPanel.classList.toggle("hidden", !isOpen);
  elements.adminPanel.setAttribute("aria-hidden", String(!isOpen));
}

function parseAdminInput(rawInput, currentLeaderboard, picks) {
  if (rawInput.startsWith("{")) {
    return validateLeaderboardData(JSON.parse(rawInput));
  }

  if (/PLAYER|NAME/i.test(rawInput) && /(TEE\s*TIME|POS|POSITION|TO\s*PAR|SCORE|TOTAL|THRU|TODAY|STATUS|R1|ROUND\s*1)/i.test(rawInput)) {
    return parseLeaderboardCsv(rawInput, currentLeaderboard, picks);
  }

  return parseRawLeaderboardInput(rawInput, currentLeaderboard, picks);
}

async function refreshLeaderboardFromRepo() {
  const storedLeaderboard = getStoredLeaderboard();
  if (storedLeaderboard || !latestConfig || !latestPicks) {
    return;
  }

  try {
    const refreshed = await loadJson(DATA_FILES.leaderboard);
    const normalized = normalizeLeaderboardData(refreshed);
    if (stableStringify(normalized) === stableStringify(latestLeaderboard)) {
      return;
    }

    repoLeaderboard = normalized;
    renderApp(latestConfig, latestPicks, normalized);
  } catch (error) {
    console.warn("Unable to refresh leaderboard from repo.", error);
  }
}

function compareText(a, b) {
  return a.localeCompare(b);
}

function renderSortLabel(key) {
  if (boardSort.key !== key) return "";
  return boardSort.direction === "asc" ? " +" : " -";
}

function compareBoardPlayers(a, b) {
  let result = 0;

  if (boardSort.key === "owners") {
    result = compareText(a.owners.join(", "), b.owners.join(", "));
  } else if (boardSort.key === "position") {
    result = (parsePosition(a.position) ?? 999) - (parsePosition(b.position) ?? 999);
    if (result === 0) result = (a.scoreToPar ?? 999) - (b.scoreToPar ?? 999);
  } else if (boardSort.key === "teeTime") {
    result = (parseTeeTime(a.teeTime) ?? 9999) - (parseTeeTime(b.teeTime) ?? 9999);
    if (result === 0) result = compareText(a.name, b.name);
  } else if (boardSort.key === "player") {
    result = compareText(a.name, b.name);
  } else {
    result = (a.scoreToPar ?? 999) - (b.scoreToPar ?? 999);
    if (result === 0) result = (parsePosition(a.position) ?? 999) - (parsePosition(b.position) ?? 999);
  }

  if (result === 0) result = compareText(a.name, b.name);
  return boardSort.direction === "asc" ? result : -result;
}

async function init() {
  try {
    const { config, picks, leaderboard: leaderboardFromRepo } = await loadData();

    repoPicks = normalizePicksData(picks, config);
    repoLeaderboard = leaderboardFromRepo;

    const storedLeaderboard = getStoredLeaderboard();
    const storedPicks = getStoredPicks();
    const storedFieldPlayers = getStoredFieldPlayers();
    const activeLeaderboard = storedLeaderboard ? validateLeaderboardData(storedLeaderboard) : leaderboardFromRepo;
    const activePicks = storedPicks ? normalizePicksData(storedPicks, config) : repoPicks;
    latestFieldPlayers = Array.isArray(storedFieldPlayers) ? storedFieldPlayers : [];

    if (!latestFieldPlayers.length) {
      try {
        const defaultPlayersText = await loadText(DATA_FILES.players);
        const defaultPlayers = parsePlayerField(defaultPlayersText);
        latestFieldPlayers = defaultPlayers;
        localStorage.setItem(FIELD_STORAGE_KEY, JSON.stringify(defaultPlayers));
      } catch (fieldError) {
        console.warn("Unable to preload default player field.", fieldError);
        latestFieldPlayers = collectDraftedPlayers(activePicks);
      }
    }

    renderApp(config, activePicks, activeLeaderboard);

    elements.toggleAdmin.addEventListener("click", () => {
      const isHidden = elements.adminPanel.classList.contains("hidden");
      setAdminOpen(isHidden);
    });
    elements.closeAdmin.addEventListener("click", () => setAdminOpen(false));
    elements.adminBackdrop.addEventListener("click", () => setAdminOpen(false));
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !elements.adminPanel.classList.contains("hidden")) {
        setAdminOpen(false);
      }
    });
    window.addEventListener("resize", applyResponsiveBoardMode);
    window.setInterval(refreshLeaderboardFromRepo, LEADERBOARD_REFRESH_INTERVAL_MS);

    elements.applyData.addEventListener("click", () => {
      try {
        const rawInput = elements.leaderboardInput.value.trim();
        const parsed = parseAdminInput(rawInput, latestLeaderboard || repoLeaderboard, latestPicks || activePicks);

        localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(parsed));
        renderApp(config, latestPicks || activePicks, parsed);
        elements.adminStatus.textContent = "Leaderboard update applied in this browser.";
      } catch (error) {
        elements.adminStatus.textContent = error.message;
      }
    });

    elements.publishData.addEventListener("click", async () => {
      try {
        const message = await publishLeaderboardFiles();
        elements.adminStatus.textContent = message;
      } catch (error) {
        elements.adminStatus.textContent = error.message;
      }
    });

    elements.saveField.addEventListener("click", () => {
      try {
        const players = parsePlayerField(elements.playerFieldInput.value);
        saveFieldPlayers(players);
        updatePicksStatus(`Saved ${players.length} players to the field list.`);
      } catch (error) {
        updatePicksStatus(error.message, true);
      }
    });

    elements.resetLocalData.addEventListener("click", () => {
      resetLocalAppData();
    });

    elements.savePicks.addEventListener("click", () => {
      savePicksToStorage(latestPicks);
      renderApp(config, latestPicks, latestLeaderboard);
      updatePicksStatus("Picks saved in this browser.");
    });

    elements.publishPicks.addEventListener("click", async () => {
      try {
        const message = await publishPicksFiles();
        updatePicksStatus(message);
      } catch (error) {
        updatePicksStatus(error.message, true);
      }
    });

    elements.clearPicks.addEventListener("click", () => {
      clearAllPicks();
    });

    elements.csvFileInput.addEventListener("change", async (event) => {
      try {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        const csvText = await file.text();
        elements.leaderboardInput.value = csvText;
        const parsed = parseLeaderboardCsv(csvText, latestLeaderboard || repoLeaderboard, latestPicks || activePicks);

        localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(parsed));
        renderApp(config, latestPicks || activePicks, parsed);
        elements.adminStatus.textContent = `Imported CSV update from ${file.name}.`;
        event.target.value = "";
      } catch (error) {
        elements.adminStatus.textContent = error.message;
      }
    });

    elements.playerFieldFileInput.addEventListener("change", async (event) => {
      try {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const text = await file.text();
        elements.playerFieldInput.value = text;
        const players = parsePlayerField(text);
        saveFieldPlayers(players);
        updatePicksStatus(`Imported ${players.length} players from ${file.name}.`);
        event.target.value = "";
      } catch (error) {
        updatePicksStatus(error.message, true);
      }
    });

    const hasSavedField = latestFieldPlayers.length > 0;
    const hasAnyPicks = activePicks.entries.some((entry) => entry.picks.length > 0);
    if (!hasSavedField || !hasAnyPicks) {
      updatePicksStatus("Use the Import Field And Build Picks button when you are ready to load the field or make picks.");
    }
  } catch (error) {
    console.error(error);
    [elements.mastersBoard, elements.mastersBoardMobile, elements.scoreboard, elements.leaderboard].forEach(renderEmptyState);
    elements.poolLeader.textContent = "Unable to load";
    elements.eventLeader.textContent = "Unable to load";
    elements.boardUpdate.textContent = "Load error";
  }
}

init();
