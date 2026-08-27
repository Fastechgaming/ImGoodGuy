// The player's website account: one name, shared by the games page and the
// store. Logging in on either page logs you into both, because the name lives
// in a signed cookie rather than in either page's state.
//
// When the AngkorLink plugin is configured, the name is verified against the
// Minecraft server and the reply carries the player's UUID, coin balance and
// rank. Without the plugin the name is accepted on its own so the site still
// works — the response says which of the two happened via `linked`.
const express = require("express");
const gamestats = require("../lib/gamestats");
const angkorlink = require("../lib/angkorlink");
const store = require("../lib/store");
const { normalizeServerName, isValidRawName } = require("../public/js/playername");

const router = express.Router();

// Short, purely anti-spam: nothing is spendable from the website, so this only
// exists to stop someone hammering the verify endpoint.
const NAME_CHANGE_COOLDOWN_MS = 60 * 1000;

function current(req) {
  const account = req.session && req.session.account;
  return account && account.player ? account : null;
}

function payload(account, now = Date.now()) {
  if (!account) {
    return { player: null, edition: "java", canChange: true, canChangeAt: now, linked: angkorlink.enabled() };
  }
  const canChangeAt = account.setAt + NAME_CHANGE_COOLDOWN_MS;
  return {
    player: account.player,
    edition: account.edition,
    uuid: account.uuid || null,
    coins: account.coins ?? null,
    rank: account.rank || null,
    nextRank: account.nextRank || null,
    linked: Boolean(account.linked),
    setAt: account.setAt,
    canChangeAt,
    canChange: now >= canChangeAt,
    cooldownMs: NAME_CHANGE_COOLDOWN_MS,
  };
}

// Ask the plugin about a name. Falls back to "accept it, but we know nothing"
// when the plugin isn't set up yet.
async function verify(player, edition) {
  if (!angkorlink.enabled()) {
    return { linked: false, found: true, player, uuid: null, coins: null, rank: null, nextRank: null };
  }
  const res = await angkorlink.verifyPlayer(player, edition);
  if (!res.linked) {
    // Plugin configured but unreachable — let the player in rather than
    // locking the whole site behind a Minecraft server that is restarting.
    return { linked: false, found: true, player, uuid: null, coins: null, rank: null, nextRank: null, degraded: true };
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
  };
}

router.get("/", async (req, res) => {
  const account = current(req);
  // Refresh coins/rank on every page load, so the store never shows a stale
  // balance — but only when we actually have a UUID to ask about.
  if (account && account.uuid && angkorlink.enabled()) {
    const profile = await angkorlink.getProfile(account.uuid);
    if (profile.ok) {
      account.coins = typeof profile.coins === "number" ? profile.coins : account.coins;
      account.rank = profile.rank || null;
      account.nextRank = profile.nextRank || null;
      req.session.account = account;
    }
  }
  res.json(payload(account));
});

router.post("/", async (req, res) => {
  const now = Date.now();
  const body = req.body || {};
  const edition = body.edition === "bedrock" ? "bedrock" : "java";
  const raw = String(body.player || body.playerName || "");

  if (!isValidRawName(raw, edition)) {
    return res.status(400).json({ error: "Enter a valid Minecraft name first." });
  }
  const player = normalizeServerName(raw, edition);

  const existing = current(req);
  if (existing) {
    const sameName = existing.player.toLowerCase() === player.toLowerCase() && existing.edition === edition;
    // Re-submitting the same name is a no-op and must not restart the cooldown.
    if (!sameName && now < existing.setAt + NAME_CHANGE_COOLDOWN_MS) {
      return res.status(429).json({
        error: "Please wait a moment before changing your name again.",
        ...payload(existing, now),
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

  req.session.account = {
    player: checked.player || player,
    edition,
    uuid: checked.uuid,
    coins: checked.coins,
    rank: checked.rank,
    nextRank: checked.nextRank,
    linked: checked.linked,
    setAt: now,
  };
  res.json({ ...payload(req.session.account, now), changed: true, degraded: Boolean(checked.degraded) });
});

router.post("/logout", (req, res) => {
  if (req.session) req.session.account = null;
  res.json({ ok: true });
});

// The rank ladder the store prices upgrades against. Comes from the plugin when
// it is running (it knows the real groups), otherwise from the store catalogue.
router.get("/ranks", async (req, res) => {
  if (angkorlink.enabled()) {
    const fromPlugin = await angkorlink.getRanks();
    if (fromPlugin.ok && Array.isArray(fromPlugin.ranks) && fromPlugin.ranks.length) {
      return res.json({ ranks: fromPlugin.ranks, source: "plugin" });
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
  res.json({ ranks, source: "catalogue" });
});

// Shared by the games page; kept here so both pages read one shape.
router.get("/daily", (req, res) => {
  const account = current(req);
  if (!account) return res.status(401).json({ error: "Set your Minecraft name first." });
  res.json(gamestats.getDaily(account.player));
});

module.exports = { router, current, payload, NAME_CHANGE_COOLDOWN_MS };
