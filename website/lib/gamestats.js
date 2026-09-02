// Server-side ledger for the website mini-games.
//
// The rules the ledger enforces (the browser is never trusted with these):
//   * each game can be played 3 times a day. A play is counted the moment a
//     round STARTS, so closing the panel mid-game still uses one up.
//   * a round pays 1-50 coins depending on how well it went.
//   * all games together pay at most 500 coins a day.
//   * the day rolls over at 00:00 Cambodia time (UTC+7).
//
// Points are tracked separately and forever, for the leaderboard.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const STATS_FILE = path.join(DATA_DIR, "gamestats.json");
const BOARD_FILE = path.join(DATA_DIR, "leaderboard.json");

const PLAYS_PER_GAME_PER_DAY = 3;
const COINS_PER_DAY = 1000;
const MAX_COINS_PER_PLAY = 75;
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7, Cambodia

// Per-game tuning. `pointsForFullCoins` is the score that earns the full 75
// coins; anything less scales down proportionally, with a floor of 1 coin for
// a round that scored at all. `maxPointsPerSecond` is the plausibility
// ceiling - no honest player scores faster than this, so anything above it is
// clamped rather than paid out.
const GAMES = {
  "lava-run": { name: "Lava Run", pointsForFullCoins: 340, maxPointsPerSecond: 14 },
  "block-breaker": { name: "Block Breaker", pointsForFullCoins: 420, maxPointsPerSecond: 20 },
  "wind-charge-dodge": { name: "Wind Charge Dodge", pointsForFullCoins: 190, maxPointsPerSecond: 9 },
  "diamond-rush": { name: "Diamond Rush", pointsForFullCoins: 260, maxPointsPerSecond: 22 },
  "tnt-escape": { name: "TNT Escape", pointsForFullCoins: 240, maxPointsPerSecond: 10 },
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

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

function writeJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Names are matched case-insensitively so ".Steve" and ".steve" are one player.
function playerKey(playerName) {
  return String(playerName || "").trim().toLowerCase();
}

// Keep today plus the two previous days; older rows are dead weight.
function prune(data, today) {
  for (const key of Object.keys(data)) {
    if (key >= today) continue;
    const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${key}T00:00:00Z`)) / 86400000;
    if (!Number.isFinite(age) || age > 2) delete data[key];
  }
}

function blankRow() {
  const plays = {};
  for (const id of GAME_IDS) plays[id] = 0;
  return { plays, coins: 0 };
}

function readRow(data, today, key) {
  const stored = (data[today] && data[today][key]) || {};
  const row = blankRow();
  for (const id of GAME_IDS) {
    row.plays[id] = Math.max(0, Math.min(PLAYS_PER_GAME_PER_DAY, Number((stored.plays || {})[id]) || 0));
  }
  row.coins = Math.max(0, Math.min(COINS_PER_DAY, Number(stored.coins) || 0));
  return row;
}

/* -------------------------------- reading --------------------------------- */

// Everything the games page needs to draw its counters.
function getDaily(playerName, now = Date.now()) {
  const today = dayKey(now);
  const row = readRow(readJson(STATS_FILE), today, playerKey(playerName));

  const games = {};
  for (const id of GAME_IDS) {
    games[id] = {
      plays: row.plays[id],
      playCap: PLAYS_PER_GAME_PER_DAY,
      playsLeft: PLAYS_PER_GAME_PER_DAY - row.plays[id],
    };
  }

  return {
    day: today,
    resetAt: nextResetAt(now),
    coinsEarned: row.coins,
    coinCap: COINS_PER_DAY,
    coinsLeft: Math.max(0, COINS_PER_DAY - row.coins),
    coinCapReached: row.coins >= COINS_PER_DAY,
    playCap: PLAYS_PER_GAME_PER_DAY,
    maxCoinsPerPlay: MAX_COINS_PER_PLAY,
    games,
  };
}

function canPlay(playerName, gameId, now = Date.now()) {
  const daily = getDaily(playerName, now);
  const game = daily.games[gameId];
  return Boolean(game && game.playsLeft > 0);
}

/* -------------------------------- writing --------------------------------- */

function mutate(playerName, today, fn) {
  const key = playerKey(playerName);
  const data = readJson(STATS_FILE);
  prune(data, today);
  const row = readRow(data, today, key);
  const result = fn(row);
  if (!data[today]) data[today] = {};
  data[today][key] = row;
  writeJson(STATS_FILE, data);
  return result;
}

// Burns one of the player's 5 daily plays for this game. Called when a round
// is opened, so quitting mid-game still costs a play.
function recordPlay(playerName, gameId, now = Date.now()) {
  if (!GAMES[gameId]) throw new Error(`Unknown game: ${gameId}`);
  const today = dayKey(now);
  const allowed = mutate(playerName, today, (row) => {
    if (row.plays[gameId] >= PLAYS_PER_GAME_PER_DAY) return false;
    row.plays[gameId] += 1;
    return true;
  });
  return { allowed, daily: getDaily(playerName, now) };
}

// Credits coins, clamped to what is left of the 500/day allowance.
function award(playerName, coins, now = Date.now()) {
  const today = dayKey(now);
  const granted = mutate(playerName, today, (row) => {
    const headroom = Math.max(0, COINS_PER_DAY - row.coins);
    const give = Math.max(0, Math.min(headroom, Math.floor(Number(coins) || 0)));
    row.coins += give;
    return give;
  });
  return { granted, daily: getDaily(playerName, now) };
}

// Score -> coins. 30 for a great round, 1 for a round that barely scored.
function coinsForRound(gameId, points) {
  const cfg = GAMES[gameId];
  if (!cfg || points <= 0) return 0;
  const scaled = Math.round((points / cfg.pointsForFullCoins) * MAX_COINS_PER_PLAY);
  return Math.max(1, Math.min(MAX_COINS_PER_PLAY, scaled));
}

// Block Breaker only: coins scale with blocks broken, piecewise-linear
// between the exact points a level is cleared (10/20/30/40 blocks, out of
// PER_LEVEL=10 across the 4 LEVELS in public/js/arcade.js) rather than the
// single points-wide formula every other game uses above - so a round that
// only gets through level 1 pays 1-10 coins, level 2 pays 10-25, level 3
// pays 25-40, and clearing level 4 (all 40 blocks) pays the full 75.
const BREAKER_BLOCK_BREAKPOINTS = [0, 10, 20, 30, 40];
const BREAKER_COIN_BREAKPOINTS = [0, 10, 25, 40, MAX_COINS_PER_PLAY];
function coinsForBreaker(blocksBroken) {
  const blocks = Math.max(0, Math.min(40, Math.floor(Number(blocksBroken) || 0)));
  for (let i = 1; i < BREAKER_BLOCK_BREAKPOINTS.length; i++) {
    if (blocks > BREAKER_BLOCK_BREAKPOINTS[i]) continue;
    const loBlocks = BREAKER_BLOCK_BREAKPOINTS[i - 1];
    const hiBlocks = BREAKER_BLOCK_BREAKPOINTS[i];
    const loCoins = BREAKER_COIN_BREAKPOINTS[i - 1];
    const hiCoins = BREAKER_COIN_BREAKPOINTS[i];
    const frac = (blocks - loBlocks) / (hiBlocks - loBlocks);
    return Math.round(loCoins + frac * (hiCoins - loCoins));
  }
  return MAX_COINS_PER_PLAY;
}

/* ------------------------- points leaderboard ------------------------- */
//
// Lifetime points per player, kept separately from the daily ledger so it
// survives the nightly reset. Only the *counted* points from a finished round
// are added, i.e. the figure that already passed the plausibility check.
const MAX_BOARD_ROWS = 2000;

function addPoints(playerName, points, now = Date.now()) {
  const gained = Math.max(0, Math.floor(Number(points) || 0));
  if (!gained) return;
  const key = playerKey(playerName);
  if (!key) return;

  const board = readJson(BOARD_FILE);
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
  const board = readJson(BOARD_FILE);
  const rows = Object.entries(board)
    .map(([key, row]) => ({ key, name: row.name || key, points: row.points || 0, rounds: row.rounds || 0 }))
    // Ties break on name so the order is stable between requests.
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
    you:
      index === -1
        ? null
        : { rank: index + 1, name: rows[index].name, points: rows[index].points, rounds: rows[index].rounds },
  };
}

module.exports = {
  GAMES,
  GAME_IDS,
  PLAYS_PER_GAME_PER_DAY,
  COINS_PER_DAY,
  MAX_COINS_PER_PLAY,
  dayKey,
  nextResetAt,
  getDaily,
  canPlay,
  recordPlay,
  award,
  coinsForRound,
  coinsForBreaker,
  addPoints,
  getLeaderboard,
};
