// Mini-game API. The browser runs the games, but the *coins* are decided here:
// a round has to be opened server-side, is only ever cashed in once, is sanity
// checked against the clock, and is finally clamped by the daily caps in
// lib/gamestats.js. That is what keeps the 500/day (and 2,500/day) promise
// honest even if someone pokes at the page's JavaScript.
const express = require("express");
const crypto = require("crypto");
const gamestats = require("../lib/gamestats");
const { normalizeServerName, isValidRawName } = require("../public/js/playername");

const router = express.Router();

// Open rounds live in memory only. A restart just voids whatever was in
// flight, which costs a player one round at worst.
const openRounds = new Map();
const ROUND_TTL_MS = 30 * 60 * 1000;
const MAX_OPEN_ROUNDS = 5000;

function sweep(now) {
  for (const [id, round] of openRounds) {
    if (now - round.startedAt > ROUND_TTL_MS) openRounds.delete(id);
  }
}

// Resolves the player the same way checkout does, so the coins land on the
// exact in-server name the player was shown.
function resolvePlayer(body) {
  const edition = body.edition === "bedrock" ? "bedrock" : "java";
  const raw = String(body.player || body.playerName || "");
  // Names arriving from the games hub are already normalized; re-normalizing is
  // a no-op for those and fixes anything typed by hand.
  if (!isValidRawName(raw, edition)) return null;
  return normalizeServerName(raw, edition);
}

router.get("/daily", (req, res) => {
  const player = String(req.query.player || "").trim();
  if (!player) return res.status(400).json({ error: "Missing player." });
  res.json(gamestats.getDaily(player));
});

router.post("/round/start", (req, res) => {
  const now = Date.now();
  sweep(now);

  const player = resolvePlayer(req.body || {});
  if (!player) return res.status(400).json({ error: "Enter a valid Minecraft name first." });

  const gameId = String((req.body || {}).gameId || "");
  if (!gamestats.GAMES[gameId]) return res.status(400).json({ error: "Unknown game." });

  if (openRounds.size >= MAX_OPEN_ROUNDS) {
    return res.status(503).json({ error: "Too many games running right now, try again in a moment." });
  }

  const roundId = crypto.randomBytes(12).toString("hex");
  openRounds.set(roundId, { player, gameId, startedAt: now });

  const daily = gamestats.getDaily(player, now);
  res.json({
    roundId,
    daily,
    remaining: gamestats.remainingFor(player, gameId, now),
  });
});

router.post("/round/finish", (req, res) => {
  const now = Date.now();
  sweep(now);

  const body = req.body || {};
  const roundId = String(body.roundId || "");
  const round = openRounds.get(roundId);
  if (!round) {
    return res.status(400).json({ error: "This round expired — play another one to earn coins." });
  }
  openRounds.delete(roundId); // one payout per round, no replays

  const cfg = gamestats.GAMES[round.gameId];
  const points = Math.max(0, Math.floor(Number(body.points) || 0));
  const elapsedSec = Math.max(1, (now - round.startedAt) / 1000);

  // Plausibility: cap the paid points at what the clock says was reachable.
  // The +10 grace covers the first couple of quick hits in a very short round.
  const plausiblePoints = Math.min(points, Math.floor(cfg.maxPointsPerSecond * elapsedSec) + 10);

  const rawCoins = Math.floor(plausiblePoints * cfg.coinsPerPoint);
  const roundCoins = Math.min(rawCoins, cfg.maxCoinsPerRound);

  const { granted, daily } = gamestats.award(round.player, round.gameId, roundCoins, now);
  const gameRow = daily.games[round.gameId];

  res.json({
    points,
    countedPoints: plausiblePoints,
    coinsEarned: granted,
    // true when the daily cap swallowed part (or all) of what the round was worth
    capped: granted < roundCoins,
    dailyEarned: gameRow.earned,
    dailyCap: gameRow.cap,
    dailyComplete: gameRow.earned >= gameRow.cap,
    total: daily.total,
    totalCap: daily.totalCap,
    resetAt: daily.resetAt,
    daily,
  });
});

module.exports = router;
