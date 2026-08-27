// Server-side coin ledger for the website mini-games.
//
// Rules the ledger enforces (the browser is never trusted with these):
//   * every game has its own 500 coins/day budget
//   * all five games together cap at 2,500 coins/day
//   * the day rolls over at 00:00 Cambodia time (UTC+7)
//
// A round must be opened by the server (`startRound`) before it can be
// cashed in (`finishRound`), which gives us a trustworthy clock to sanity
// check the score against and stops the same round being claimed twice.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const STATS_FILE = path.join(DATA_DIR, "gamestats.json");
const BOARD_FILE = path.join(DATA_DIR, "leaderboard.json");

const PER_GAME_DAILY_CAP = 500;
const TOTAL_DAILY_CAP = 2500;
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7, Cambodia

// Per-game tuning. `coinsPerPoint` is set so a strong round is worth roughly
// 100-150 coins, i.e. about four good rounds to fill that game's daily budget.
// `maxPointsPerSecond` is the plausibility ceiling: no honest player can score
// faster than this, so anything above it gets clamped rather than paid out.
const GAMES = {
  "lava-run": { name: "Lava Run", coinsPerPoint: 0.25, maxPointsPerSecond: 25, maxCoinsPerRound: 200 },
  "block-breaker": { name: "Block Breaker", coinsPerPoint: 0.45, maxPointsPerSecond: 24, maxCoinsPerRound: 200 },
  "wind-charge-dodge": { name: "Wind Charge Dodge", coinsPerPoint: 0.5, maxPointsPerSecond: 12, maxCoinsPerRound: 200 },
  "diamond-rush": { name: "Diamond Rush", coinsPerPoint: 0.35, maxPointsPerSecond: 40, maxCoinsPerRound: 200 },
  "build-it": { name: "Build It!", coinsPerPoint: 0.3, maxPointsPerSecond: 40, maxCoinsPerRound: 200 },
};

const GAME_IDS = Object.keys(GAMES);

/* ------------------------- day boundaries (UTC+7) ------------------------- */

// "2026-08-27" for whatever date it currently is in Cambodia.
function dayKey(now = Date.now()) {
  return new Date(now + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

// Epoch ms of the next 00:00 UTC+7 - the frontend uses this for its countdown.
function nextResetAt(now = Date.now()) {
  const shifted = now + TZ_OFFSET_MS;
  const startOfShiftedDay = Math.floor(shifted / 86400000) * 86400000;
  return startOfShiftedDay + 86400000 - TZ_OFFSET_MS;
}

/* ------------------------------ persistence ------------------------------- */

function readAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

function writeAll(data) {
  writeJson(STATS_FILE, data);
}

function writeJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Names are matched case-insensitively so ".Steve" and ".steve" share a budget.
function playerKey(playerName) {
  return String(playerName || "").trim().toLowerCase();
}

// Keep today plus the two previous days; older rows are dead weight.
function prune(data, today) {
  for (const key of Object.keys(data)) {
    if (key < today) {
      const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${key}T00:00:00Z`)) / 86400000;
      if (!Number.isFinite(age) || age > 2) delete data[key];
    }
  }
}

/* -------------------------------- reading --------------------------------- */

function blankLedger() {
  const games = {};
  for (const id of GAME_IDS) games[id] = { earned: 0, cap: PER_GAME_DAILY_CAP };
  return games;
}

// Everything the games page needs to draw its progress bars.
function getDaily(playerName, now = Date.now()) {
  const today = dayKey(now);
  const data = readAll();
  const stored = (data[today] && data[today][playerKey(playerName)]) || {};

  const games = blankLedger();
  let total = 0;
  for (const id of GAME_IDS) {
    const earned = Math.max(0, Math.min(PER_GAME_DAILY_CAP, Number(stored[id]) || 0));
    games[id].earned = earned;
    total += earned;
  }

  return {
    day: today,
    resetAt: nextResetAt(now),
    perGameCap: PER_GAME_DAILY_CAP,
    totalCap: TOTAL_DAILY_CAP,
    total,
    totalRemaining: Math.max(0, TOTAL_DAILY_CAP - total),
    games,
  };
}

// How many coins this player could still earn in this game right now.
function remainingFor(playerName, gameId, now = Date.now()) {
  const daily = getDaily(playerName, now);
  const game = daily.games[gameId];
  if (!game) return 0;
  return Math.max(0, Math.min(game.cap - game.earned, daily.totalRemaining));
}

/* -------------------------------- writing --------------------------------- */

// Credits `coins` and returns what was actually granted after both caps.
function award(playerName, gameId, coins, now = Date.now()) {
  if (!GAMES[gameId]) throw new Error(`Unknown game: ${gameId}`);
  const today = dayKey(now);
  const key = playerKey(playerName);
  const data = readAll();
  prune(data, today);

  if (!data[today]) data[today] = {};
  if (!data[today][key]) data[today][key] = {};
  const row = data[today][key];

  let usedToday = 0;
  for (const id of GAME_IDS) {
    row[id] = Math.max(0, Math.min(PER_GAME_DAILY_CAP, Number(row[id]) || 0));
    usedToday += row[id];
  }

  const headroom = Math.max(
    0,
    Math.min(PER_GAME_DAILY_CAP - row[gameId], TOTAL_DAILY_CAP - usedToday)
  );
  const granted = Math.max(0, Math.min(headroom, Math.floor(Number(coins) || 0)));

  row[gameId] += granted;
  writeAll(data);

  return { granted, daily: getDaily(playerName, now) };
}

/* ------------------------- points leaderboard ------------------------- */
//
// Lifetime points per player, kept separately from the daily coin ledger so it
// survives the nightly reset. Only the *counted* points from a finished round
// are added, i.e. the figure that already passed the plausibility check.
const MAX_BOARD_ROWS = 2000;

function readBoard() {
  try {
    const parsed = JSON.parse(fs.readFileSync(BOARD_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

function addPoints(playerName, points, now = Date.now()) {
  const gained = Math.max(0, Math.floor(Number(points) || 0));
  if (!gained) return;
  const key = playerKey(playerName);
  if (!key) return;

  const board = readBoard();
  const row = board[key] || { name: playerName, points: 0, rounds: 0, updatedAt: now };
  row.name = playerName; // keep the latest capitalisation the player used
  row.points += gained;
  row.rounds += 1;
  row.updatedAt = now;
  board[key] = row;

  // Cap the file: keep the best MAX_BOARD_ROWS players by points.
  const keys = Object.keys(board);
  if (keys.length > MAX_BOARD_ROWS) {
    const trimmed = {};
    keys
      .sort((a, b) => board[b].points - board[a].points)
      .slice(0, MAX_BOARD_ROWS)
      .forEach((k) => {
        trimmed[k] = board[k];
      });
    writeJson(BOARD_FILE, trimmed);
    return;
  }
  writeJson(BOARD_FILE, board);
}

// Ranked list, plus where `playerName` sits even if they're off the end of it.
function getLeaderboard(limit = 50, playerName = "") {
  const board = readBoard();
  const rows = Object.entries(board)
    .map(([key, row]) => ({ key, name: row.name || key, points: row.points || 0, rounds: row.rounds || 0 }))
    // Ties break on who got there first, so a new player can't leapfrog on equal points.
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  const wanted = playerKey(playerName);
  const index = wanted ? rows.findIndex((r) => r.key === wanted) : -1;

  return {
    total: rows.length,
    top: rows.slice(0, Math.max(1, Math.min(200, limit))).map((row, i) => ({
      rank: i + 1,
      name: row.name,
      points: row.points,
      rounds: row.rounds,
    })),
    you: index === -1 ? null : { rank: index + 1, name: rows[index].name, points: rows[index].points, rounds: rows[index].rounds },
  };
}

module.exports = {
  GAMES,
  GAME_IDS,
  PER_GAME_DAILY_CAP,
  TOTAL_DAILY_CAP,
  dayKey,
  nextResetAt,
  getDaily,
  remainingFor,
  award,
  addPoints,
  getLeaderboard,
};
