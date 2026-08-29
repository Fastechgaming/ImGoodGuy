// The player's website account. This used to be one identity shared by both
// pages; it is now two independent identities in the same signed cookie:
//
//   session.account = { games: {...} | null, store: {...} | null }
//
// The very FIRST name anyone ever types, on either page, seeds both — so a
// brand new visitor is "logged in" everywhere the moment they verify once.
// After that, each page's identity only moves when THAT page's Change Name
// form is used; the other page is untouched. This is also why the two scopes
// have different cooldowns: the games page (5 plays/day per game, a coin
// allowance) is worth protecting from someone farming a fresh daily budget
// under a new name every few minutes, so it's 24h. The store has nothing to
// farm — it only exists to know who to deliver an order to — so its cooldown
// is a token 60s, purely to stop someone hammering the verify endpoint.
//
// When the AngkorStore plugin is configured, verifying checks the name against
// the Minecraft server and the reply carries the player's UUID, coin balance
// and rank. Without the plugin the name is accepted on its own so the site
// still works — the response says which of the two happened via `linked`.
const express = require("express");
const gamestats = require("../lib/gamestats");
const angkorstore = require("../lib/angkorstore");
const store = require("../lib/store");
const { normalizeServerName, isValidRawName } = require("../public/js/playername");

const router = express.Router();

const GAMES_SCOPE = "games";
const STORE_SCOPE = "store";
const COOLDOWN_MS = {
  [GAMES_SCOPE]: 24 * 60 * 60 * 1000,
  [STORE_SCOPE]: 60 * 1000,
};

function normalizeScope(raw) {
  return raw === STORE_SCOPE ? STORE_SCOPE : GAMES_SCOPE; // unknown/missing -> games
}

// Reads both identities out of the cookie. Also migrates the old single-
// identity shape (from before accounts were split per page) into both scopes,
// so a visitor who was already signed in doesn't get logged out by this change.
function pair(req) {
  const raw = req.session && req.session.account;
  if (!raw) return { games: null, store: null };
  if (Object.prototype.hasOwnProperty.call(raw, "games") || Object.prototype.hasOwnProperty.call(raw, "store")) {
    return { games: raw.games || null, store: raw.store || null };
  }
  if (raw.player) return { games: raw, store: { ...raw } }; // old flat shape
  return { games: null, store: null };
}

function current(req, scope) {
  const identity = pair(req)[normalizeScope(scope)];
  return identity && identity.player ? identity : null;
}

function payload(identity, scope, now = Date.now()) {
  const cooldownMs = COOLDOWN_MS[normalizeScope(scope)];
  if (!identity) {
    return { player: null, edition: "java", canChange: true, canChangeAt: now, cooldownMs, linked: angkorstore.enabled() };
  }
  const canChangeAt = identity.setAt + cooldownMs;
  const linked = Boolean(identity.linked);
  return {
    player: identity.player,
    edition: identity.edition,
    uuid: identity.uuid || null,
    // Never hand back a coin figure the plugin didn't just confirm — a
    // cached number from before an outage is worse than no number at all.
    coins: linked ? identity.coins ?? null : null,
    rank: identity.rank || null,
    nextRank: identity.nextRank || null,
    ranks: identity.ranks || [],
    linked,
    setAt: identity.setAt,
    canChangeAt,
    canChange: now >= canChangeAt,
    cooldownMs,
  };
}

// Ask the plugin about a name. Falls back to "accept it, but we know nothing"
// when the plugin isn't set up yet.
async function verify(player, edition) {
  if (!angkorstore.enabled()) {
    return { linked: false, found: true, player, uuid: null, coins: null, rank: null, nextRank: null, ranks: [] };
  }
  const res = await angkorstore.verifyPlayer(player, edition);
  if (!res.linked) {
    // Plugin configured but unreachable — let the player in rather than
    // locking the whole site behind a Minecraft server that is restarting.
    return { linked: false, found: true, player, uuid: null, coins: null, rank: null, nextRank: null, ranks: [], degraded: true };
  }
  if (!res.ok || res.found === false) {
    return { linked: true, found: false, reason: res.reason || "NEVER_JOINED" };
  }
  return {
    linked: true,
    found: true,
    player: res.name || player,
    uuid: res.uuid || null,
    coins: typeof res.coins === "number" ? res.coins : null,
    rank: res.rank || null,
    nextRank: res.nextRank || null,
    ranks: Array.isArray(res.ranks) ? res.ranks : [],
  };
}

router.get("/", async (req, res) => {
  const scope = normalizeScope(req.query.scope);
  const identity = current(req, scope);
  // Refresh coins/rank on every page load (and on the client's 10s poll), so
  // the coin figure is never stale — but only when we actually have a UUID
  // to ask about. `linked` is re-derived from THIS call, not carried over
  // from whenever the player last verified: a plugin that goes down mid-
  // session must flip the site to "Unavailable" on the very next check,
  // not keep showing whatever balance happened to be cached.
  if (identity && identity.uuid && angkorstore.enabled()) {
    const profile = await angkorstore.getProfile(identity.uuid);
    identity.linked = Boolean(profile.ok);
    if (profile.ok) {
      identity.coins = typeof profile.coins === "number" ? profile.coins : identity.coins;
      identity.rank = profile.rank || null;
      identity.nextRank = profile.nextRank || null;
      identity.ranks = Array.isArray(profile.ranks) ? profile.ranks : identity.ranks || [];
    }
    const both = pair(req);
    both[scope] = identity;
    req.session.account = both;
  } else if (identity && !angkorstore.enabled()) {
    identity.linked = false;
  }
  res.json(payload(identity, scope));
});

router.post("/", async (req, res) => {
  // No hard gate here: verify() below already falls back to "accept the name,
  // we just can't confirm it" when the plugin isn't configured or reachable
  // (see its own comment) - games and the store both stay usable, just
  // without live coins/rank until the plugin answers again.
  const now = Date.now();
  const body = req.body || {};
  const scope = normalizeScope(body.scope);
  const edition = body.edition === "bedrock" ? "bedrock" : "java";
  const raw = String(body.player || body.playerName || "");

  if (!isValidRawName(raw, edition)) {
    return res.status(400).json({ error: "Enter a valid Minecraft name first." });
  }
  const player = normalizeServerName(raw, edition);

  const both = pair(req);
  const isFirstEver = !both.games && !both.store;
  const existing = both[scope];

  if (existing) {
    const sameName = existing.player.toLowerCase() === player.toLowerCase() && existing.edition === edition;
    // Re-submitting the same name is a no-op and must not restart the cooldown.
    if (!sameName && now < existing.setAt + COOLDOWN_MS[scope]) {
      return res.status(429).json({
        error: "Please wait before changing your name again.",
        ...payload(existing, scope, now),
      });
    }
  }

  const checked = await verify(player, edition);
  if (checked.found === false) {
    return res.status(404).json({
      error: "That name has never joined AngkorSMP. Join the server once, then try again.",
      code: "NEVER_JOINED",
    });
  }

  const identity = {
    player: checked.player || player,
    edition,
    uuid: checked.uuid,
    coins: checked.coins,
    rank: checked.rank,
    nextRank: checked.nextRank,
    ranks: checked.ranks || [],
    linked: checked.linked,
    setAt: now,
  };

  if (isFirstEver) {
    // The very first name anyone types, on either page, signs them into both
    // — two independent copies from here on, not a shared reference.
    both.games = identity;
    both.store = { ...identity };
  } else {
    both[scope] = identity;
  }
  req.session.account = both;
  res.json({ ...payload(identity, scope, now), changed: true, degraded: Boolean(checked.degraded) });
});

router.post("/logout", (req, res) => {
  const scope = normalizeScope((req.body || {}).scope);
  const both = pair(req);
  both[scope] = null;
  req.session.account = both;
  res.json({ ok: true });
});

// The rank ladder the store prices upgrades against. Comes from the plugin when
// it is running (it knows the real groups), otherwise from the store catalogue.
// Shared with routes/api.js, which needs the same ladder to price an upgrade
// order server-side rather than trust whatever the browser computed.
async function getRankLadder() {
  if (angkorstore.enabled()) {
    const fromPlugin = await angkorstore.getRanks();
    if (fromPlugin.ok && Array.isArray(fromPlugin.ranks) && fromPlugin.ranks.length) {
      return { ranks: fromPlugin.ranks, source: "plugin" };
    }
  }
  // Catalogue order is price order, which is also the rank order.
  const ranks = (store.getItems().ranks || [])
    .filter((item) => !item.comingSoon)
    .map((item, index) => ({
      id: item.id.replace(/^rank-/, ""),
      itemId: item.id,
      displayName: item.name,
      weight: (index + 1) * 10,
      priceUsd: Number(item.price) || 0,
    }))
    .sort((a, b) => a.priceUsd - b.priceUsd)
    .map((rank, index) => ({ ...rank, weight: (index + 1) * 10 }));
  return { ranks, source: "catalogue" };
}

// Not scoped — the ladder itself is the same regardless of who's asking.
router.get("/ranks", async (req, res) => {
  res.json(await getRankLadder());
});

// Shared by the games page; kept here so both pages read one shape. Always
// the games-scoped identity — the daily coin ledger tracks games-page play.
router.get("/daily", (req, res) => {
  const identity = current(req, GAMES_SCOPE);
  if (!identity) return res.status(401).json({ error: "Set your Minecraft name first." });
  res.json(gamestats.getDaily(identity.player));
});

module.exports = { router, current, payload, getRankLadder, GAMES_SCOPE, STORE_SCOPE, COOLDOWN_MS };
