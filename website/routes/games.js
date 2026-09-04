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
const angkorstore = require("../lib/angkorstore");
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
  // Games always run, plugin or not - only the real-coin delivery on finish
  // depends on it (see round/finish below and lib/angkorstore.js).
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
  openRounds.set(roundId, {
    player: account.player,
    uuid: account.uuid || null,
    edition: account.edition,
    gameId,
    startedAt: now,
  });

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

  // Block Breaker pays by level reached instead of the generic points curve
  // every other game uses - see gamestats.coinsForBreaker's own comment.
  // 40 is a hard ceiling regardless of elapsedSec: that's the total blocks
  // across all 4 levels (public/js/arcade.js), so no per-second plausibility
  // clamp is needed the way points/coins get one above.
  const roundCoins =
    round.gameId === "block-breaker"
      ? gamestats.coinsForBreaker(body.blocksBroken)
      : gamestats.coinsForRound(round.gameId, countedPoints);
  gamestats.addPoints(round.player, countedPoints, now); // points always count - they're a website stat, not real coins

  let daily = gamestats.getDaily(round.player, now);
  let granted = 0;
  let delivered = null;
  if (roundCoins > 0 && angkorstore.enabled()) {
    // Transaction id is the round id, so a retry can never pay twice.
    const result = await angkorstore.grantCoins({
      transactionId: `round_${roundId}`,
      uuid: round.uuid,
      name: round.player,
      edition: round.edition,
      amount: roundCoins,
      reason: cfg.name,
      meta: { gameId: round.gameId, roundId },
    });
    if (result.ok) {
      // Only now, once the plugin has actually confirmed it landed, commit
      // the same amount to the local ledger (still tracked for stats, just
      // no longer capped against an overall daily allowance).
      const awarded = gamestats.award(round.player, roundCoins, now);
      granted = awarded.granted;
      daily = awarded.daily;
      delivered = { ok: true, balance: result.balanceAfter ?? null };
    } else {
      delivered = { ok: false };
    }
  }

  res.json({
    points,
    countedPoints,
    coinsEarned: granted,
    // True only when this round's coins actually reached the game. The
    // client must not show a "+N Coins" result unless this is true - a
    // local-only number that never lands in-game is worse than none at all.
    coinsLive: Boolean(delivered && delivered.ok),
    maxCoinsPerPlay: gamestats.MAX_COINS_PER_PLAY,
    daily,
    delivered,
    leaderboard: gamestats.getLeaderboard(5, round.player),
  });
});

module.exports = router;
