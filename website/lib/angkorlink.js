// Client for the AngkorLink Minecraft plugin (see PLUGIN_PROMPT.md).
//
// The plugin is what lets this website ask the server questions: is this a real
// player, how many coins do they have, what rank are they. Until it is running,
// every call here reports `linked: false` and the site falls back to its own
// local ledger — so nothing breaks while the plugin is being written.
//
// Set these in .env to switch it on:
//   ANGKORLINK_URL=http://your-server:8123
//   ANGKORLINK_KEY=...
//   ANGKORLINK_SECRET=...
const crypto = require("crypto");

const TIMEOUT_MS = 4000;

function config() {
  return {
    url: (process.env.ANGKORLINK_URL || "").replace(/\/+$/, ""),
    key: process.env.ANGKORLINK_KEY || "",
    secret: process.env.ANGKORLINK_SECRET || "",
  };
}

function enabled() {
  const { url, key } = config();
  return Boolean(url && key);
}

// Signature over "<timestamp>\n<METHOD>\n<path>\n<body>", per the plugin brief.
function sign(secret, timestamp, method, path, body) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}\n${method}\n${path}\n${body}`)
    .digest("hex");
}

async function request(method, path, payload) {
  const { url, key, secret } = config();
  if (!url || !key) return { ok: false, linked: false, error: "AngkorLink is not configured." };

  const body = payload === undefined ? "" : JSON.stringify(payload);
  const timestamp = Date.now();
  const headers = { "X-AngkorSMP-Key": key };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["X-AngkorSMP-Timestamp"] = String(timestamp);
    headers["X-AngkorSMP-Signature"] = sign(secret, timestamp, method, path, body);
  }

  try {
    const res = await fetch(`${url}${path}`, {
      method,
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(`[angkorlink] ${method} ${path} -> ${res.status} ${data.error || ""}`);
      return { ok: false, linked: true, status: res.status, ...data };
    }
    return { ...data, ok: true, linked: true };
  } catch (err) {
    // The server being down must never take the website down with it.
    console.warn(`[angkorlink] ${method} ${path} failed: ${err.message}`);
    return { ok: false, linked: false, error: "Could not reach the Minecraft server." };
  }
}

/* ------------------------------- the calls ------------------------------- */

// Name -> does this player exist, and who are they. Also brings back coins and
// rank, so the store and games pages need only this one call.
function verifyPlayer(name, edition) {
  return request("POST", "/api/v1/player/verify", { name, edition });
}

function getProfile(uuid) {
  return request("GET", `/api/v1/player/${encodeURIComponent(uuid)}/profile`);
}

function getRanks() {
  return request("GET", "/api/v1/ranks");
}

// Mini-game payout. `transactionId` must be stable for the round so a retry
// cannot pay twice - the plugin de-duplicates on it.
function grantCoins({ transactionId, uuid, name, amount, reason, meta }) {
  return request("POST", "/api/v1/coins/grant", {
    transactionId,
    uuid,
    name,
    amount,
    reason,
    source: "minigame",
    meta,
  });
}

// Store delivery, after the owner presses Accept in Telegram.
function deliverPurchase({ transactionId, uuid, name, itemId, itemName, commands, requiresOnline }) {
  return request("POST", "/api/v1/purchase/deliver", {
    transactionId,
    uuid,
    name,
    itemId,
    itemName,
    commands,
    requiresOnline: Boolean(requiresOnline),
  });
}

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
  grantCoins,
  deliverPurchase,
  upgradeRank,
  health,
};
