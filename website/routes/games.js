// Mini-game API. The browser runs the games, but the *coins* are decided here:
// a round has to be opened server-side, is only ever cashed in once, is sanity
// checked against the clock, and is finally clamped by the daily caps in
// lib/gamestats.js. That is what keeps the 500/day (and 2,500/day) promise
// honest even if someone pokes at the page's JavaScript.
//
// The player's name is bound to a signed cookie, so the games page only ever
// asks for it once and a name change is rate limited to once a day.
const express = require("express");
const crypto = require("crypto");
const cookieSession = require("cookie-session");
const gamestats = require("../lib/gamestats");
const { normalizeServerName, isValidRawName } = require("../public/js/playername");

const router = express.Router();

const NAME_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Its own cookie, separate from the admin session: it lives far longer and
// carries nothing privileged.
router.use(
  cookieSession({
    name: "angkorsmp_player",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    maxAge: 400 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
  })
);

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

/* ------------------------- the bound player ------------------------- */

function boundPlayer(req) {
  const account = req.session && req.session.account;
  if (!account || !account.player) return null;
  return account;
}

function accountPayload(account, now = Date.now()) {
  if (!account) return { player: null, edition: "java", canChange: true, canChangeAt: now };
  const canChangeAt = account.setAt + NAME_CHANGE_COOLDOWN_MS;
  return {
    player: account.player,
    edition: account.edition,
    setAt: account.setAt,
    canChangeAt,
    canChange: now >= canChangeAt,
    cooldownMs: NAME_CHANGE_COOLDOWN_MS,
  };
}

// Who am I? Called on every visit to the games page.
router.get("/player", (req, res) => {
  res.json(accountPayload(boundPlayer(req)));
});

// Claim a name, or change it once the 24h cooldown has passed.
router.post("/player", (req, res) => {
  const now = Date.now();
  const body = req.body || {};
  const edition = body.edition === "bedrock" ? "bedrock" : "java";
  const raw = String(body.player || body.playerName || "");

  if (!isValidRawName(raw, edition)) {
    return res.status(400).json({ error: "Enter a valid Minecraft name first." });
  }
  const player = normalizeServerName(raw, edition);

  const current = boundPlayer(req);
  if (current) {
    // Re-submitting the same name is a no-op, not a change - it must not
    // restart the cooldown or lock someone out of their own account.
    const sameName = current.player.toLowerCase() === player.toLowerCase() && current.edition === edition;
    if (sameName) return res.json({ ...accountPayload(current, now), changed: false });

    if (now < current.setAt + NAME_CHANGE_COOLDOWN_MS) {
      return res.status(429).json({
        error: "You can only change your name once a day.",
        ...accountPayload(current, now),
      });
    }
  }

  req.session.account = { player, edition, setAt: now };
  res.json({ ...accountPayload(req.session.account, now), changed: true });
});

/* ------------------------------ the games ------------------------------ */

router.get("/daily", (req, res) => {
  const account = boundPlayer(req);
  const player = account ? account.player : String(req.query.player || "").trim();
  if (!player) return res.status(400).json({ error: "Missing player." });
  res.json(gamestats.getDaily(player));
});

router.get("/leaderboard", (req, res) => {
  const account = boundPlayer(req);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  res.json(gamestats.getLeaderboard(limit, account ? account.player : String(req.query.player || "")));
});

router.post("/round/start", (req, res) => {
  const now = Date.now();
  sweep(now);

  // Rounds always run as the bound player - the body can't name someone else.
  const account = boundPlayer(req);
  if (!account) return res.status(401).json({ error: "Set your Minecraft name first." });

  const gameId = String((req.body || {}).gameId || "");
  if (!gamestats.GAMES[gameId]) return res.status(400).json({ error: "Unknown game." });

  if (openRounds.size >= MAX_OPEN_ROUNDS) {
    return res.status(503).json({ error: "Too many games running right now, try again in a moment." });
  }

  const roundId = crypto.randomBytes(12).toString("hex");
  openRounds.set(roundId, { player: account.player, gameId, startedAt: now });

  res.json({
    roundId,
    daily: gamestats.getDaily(account.player, now),
    remaining: gamestats.remainingFor(account.player, gameId, now),
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
  // The leaderboard counts the same vetted figure the coins were paid on.
  gamestats.addPoints(round.player, plausiblePoints, now);
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
    leaderboard: gamestats.getLeaderboard(5, round.player),
  });
});

module.exports = router;
