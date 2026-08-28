// Mini-game API. The browser runs the games, but the *coins* are decided here:
// a round has to be opened server-side (which burns one of the player's five
// daily plays for that game), is only ever cashed in once, is sanity checked
// against the clock, and is finally clamped by the 500 coins/day allowance in
// lib/gamestats.js.
//
// The player comes from the shared account cookie (routes/account.js), never
// from the request body.
const express = require("express");
const crypto = require("crypto");
const gamestats = require("../lib/gamestats");
const angkorlink = require("../lib/angkorlink");
const { current, GAMES_SCOPE } = require("./account");

const router = express.Router();

// Open rounds live in memory only. A restart just voids whatever was in
// flight; the play is already counted, which is the safe way round.
const openRounds = new Map();
const ROUND_TTL_MS = 30 * 60 * 1000;
const MAX_OPEN_ROUNDS = 5000;

function sweep(now) {
  for (const [id, round] of openRounds) {
    if (now - round.startedAt > ROUND_TTL_MS) openRounds.delete(id);
  }
}

router.get("/daily", (req, res) => {
  const account = current(req, GAMES_SCOPE);
  if (!account) return res.status(401).json({ error: "Set your Minecraft name first." });
  res.json(gamestats.getDaily(account.player));
});

router.get("/leaderboard", (req, res) => {
  const account = current(req, GAMES_SCOPE);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  res.json(gamestats.getLeaderboard(limit, account ? account.player : ""));
});

router.post("/round/start", (req, res) => {
  const now = Date.now();
  sweep(now);

  const account = current(req, GAMES_SCOPE);
  if (!account) return res.status(401).json({ error: "Set your Minecraft name first." });

  const gameId = String((req.body || {}).gameId || "");
  if (!gamestats.GAMES[gameId]) return res.status(400).json({ error: "Unknown game." });

  if (openRounds.size >= MAX_OPEN_ROUNDS) {
    return res.status(503).json({ error: "Too many games running right now, try again in a moment." });
  }

  // Burn a play up front, so quitting the panel mid-game still costs one.
  const { allowed, daily } = gamestats.recordPlay(account.player, gameId, now);
  if (!allowed) {
    return res.status(429).json({ error: "No plays left for this game today.", code: "NO_PLAYS_LEFT", daily });
  }

  const roundId = crypto.randomBytes(12).toString("hex");
  openRounds.set(roundId, { player: account.player, uuid: account.uuid || null, gameId, startedAt: now });

  res.json({ roundId, daily });
});

router.post("/round/finish", async (req, res) => {
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
  const countedPoints = Math.min(points, Math.floor(cfg.maxPointsPerSecond * elapsedSec) + 10);
  const roundCoins = gamestats.coinsForRound(round.gameId, countedPoints);

  const { granted, daily } = gamestats.award(round.player, roundCoins, now);
  gamestats.addPoints(round.player, countedPoints, now);

  // Push the coins into the game itself when the plugin is up. The round id is
  // the transaction id, so a retry can never pay twice.
  let delivered = null;
  if (granted > 0 && angkorlink.enabled()) {
    const result = await angkorlink.grantCoins({
      transactionId: `round_${roundId}`,
      uuid: round.uuid,
      name: round.player,
      amount: granted,
      reason: cfg.name,
      meta: { gameId: round.gameId, roundId },
    });
    delivered = result.ok ? { ok: true, balance: result.balanceAfter ?? null } : { ok: false };
  }

  res.json({
    points,
    countedPoints,
    coinsEarned: granted,
    maxCoinsPerPlay: gamestats.MAX_COINS_PER_PLAY,
    // true when the daily allowance swallowed part (or all) of the round
    capped: granted < roundCoins,
    daily,
    delivered,
    leaderboard: gamestats.getLeaderboard(5, round.player),
  });
});

module.exports = router;
