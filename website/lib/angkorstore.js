// Client for the AngkorStore Minecraft plugin (see ../../AngkorStore/README.md).
//
// The plugin is what lets this website ask the server questions: is this a real
// player, how many coins do they have, what rank(s) are they. Until it is
// running, every call here reports `linked: false` and the site falls back to
// its own local ledger — so nothing breaks while the plugin isn't installed.
//
// Set these in .env to switch it on:
//   ANGKORSTORE_URL=http://your-server:8123
//   ANGKORSTORE_SECRET=...
//
// Auth is one shared secret in a header, not a signed request — deliberately
// simpler than the old key+HMAC scheme so a mismatch is a one-line `curl`
// check instead of a signature-debugging session. If this server isn't on
// localhost or a private network, put the plugin's port behind a
// tunnel/VPN so that secret isn't sent in the clear (see the plugin's README).
const TIMEOUT_MS = 4000;

function config() {
  return {
    url: (process.env.ANGKORSTORE_URL || "").replace(/\/+$/, ""),
    secret: process.env.ANGKORSTORE_SECRET || "",
  };
}

function enabled() {
  const { url, secret } = config();
  return Boolean(url && secret);
}

async function request(method, path, payload) {
  const { url, secret } = config();
  if (!url || !secret) return { ok: false, linked: false, error: "AngkorStore is not configured." };

  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const headers = { "X-AngkorStore-Secret": secret };
  if (body) headers["Content-Type"] = "application/json";

  try {
    const res = await fetch(`${url}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(`[angkorstore] ${method} ${path} -> ${res.status} ${data.error || ""}`);
      return { ok: false, linked: true, status: res.status, ...data };
    }
    return { ...data, ok: true, linked: true };
  } catch (err) {
    // The server being down must never take the website down with it.
    console.warn(`[angkorstore] ${method} ${path} failed: ${err.message}`);
    return { ok: false, linked: false, error: "Could not reach the Minecraft server." };
  }
}

/* ------------------------------- the calls ------------------------------- */

// Name -> does this player exist, and who are they. Also brings back coins and
// every configured rank they hold, so the store and games pages need only
// this one call.
function verifyPlayer(name, edition) {
  return request("POST", "/api/v1/player/verify", { name, edition });
}

function getProfile(uuid) {
  return request("GET", `/api/v1/player/${encodeURIComponent(uuid)}/profile`);
}

function getRanks() {
  return request("GET", "/api/v1/ranks");
}

function getBans() {
  return request("GET", "/api/v1/bans");
}

// Mini-game payout. `transactionId` must be stable for the round so a retry
// cannot pay twice - the plugin de-duplicates on it.
//
// `edition` is always sent alongside `name`, even though `uuid` should
// normally already be known by this point: the plugin only needs `name` (and
// therefore `edition`, to normalise it correctly) when `uuid` is missing, but
// leaving `edition` out entirely made it silently default to "java" on the
// plugin side - which fails Bedrock names (they start with a literal ".",
// which the Java name pattern rejects) and gets misreported as "player not
// found" instead of the real problem.
function grantCoins({ transactionId, uuid, name, edition, amount, reason, meta }) {
  return request("POST", "/api/v1/coins/grant", {
    transactionId,
    uuid,
    name,
    edition,
    amount,
    reason,
    source: "minigame",
    meta,
  });
}

// Store delivery, after the owner presses Accept in Telegram. See the note on
// grantCoins above - edition matters here for the exact same reason.
function deliverPurchase({ transactionId, uuid, name, edition, itemId, itemName, commands, requiresOnline }) {
  return request("POST", "/api/v1/purchase/deliver", {
    transactionId,
    uuid,
    name,
    edition,
    itemId,
    itemName,
    commands,
    requiresOnline: Boolean(requiresOnline),
  });
}

// `expectedFromRankId` is the rank the store priced the upgrade against - the
// plugin refuses with 409/RANK_CHANGED if the player's real rank has moved on
// since, rather than silently acting on stale pricing.
function upgradeRank({ transactionId, uuid, toRankId, expectedFromRankId }) {
  return request("POST", "/api/v1/rank/upgrade", {
    transactionId,
    uuid,
    toRankId,
    expectedFromRankId,
  });
}

function health() {
  return request("GET", "/api/v1/health");
}

module.exports = {
  enabled,
  verifyPlayer,
  getProfile,
  getRanks,
  getBans,
  grantCoins,
  deliverPurchase,
  upgradeRank,
  health,
};
