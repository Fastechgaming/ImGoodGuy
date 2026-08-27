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

const PER_GAME_DAILY_CAP = 500;
const TOTAL_DAILY_CAP = 2500;
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7, Cambodia

// Per-game tuning. `coinsPerPoint` is set so a strong round is worth roughly
// 100-150 coins, i.e. about four good rounds to fill that game's daily budget.
// `maxPointsPerSecond` is the plausibility ceiling: no honest player can score
// faster than this, so anything above it gets clamped rather than paid out.
const GAMES = {
  "bow-shot": { name: "Bow Shot", coinsPerPoint: 0.2, maxPointsPerSecond: 45, maxCoinsPerRound: 200 },
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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STATS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, STATS_FILE);
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
};
