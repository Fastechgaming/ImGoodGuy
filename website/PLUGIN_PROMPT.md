# Prompt: build the `AngkorLink` Minecraft plugin

> Copy everything below the line into the AI that will write the plugin.
> It is written as a self-contained brief — that AI does not need access to this
> repository, because every contract it must match is spelled out here.

---

## Your task

Write a **Minecraft server plugin** called **AngkorLink** that connects the
AngkorSMP Minecraft server to the AngkorSMP website.

The website already exists (Node.js + Express). It has a store where players buy
ranks and coin packs, and a games page with five browser mini-games that pay out
Angkor Coins. Today the website can only reach the server by firing blind RCON
commands, so it cannot *ask* the server anything. Your plugin fixes that: it
gives the website a small, authenticated HTTP API it can query and act through.

**Do not rename the endpoints, fields, or headers below.** The website side is
being written against this exact contract; anything you invent instead will not
line up.

### Target platform

- **Paper 1.21.x** (must also run on Spigot 1.20.6+; note anywhere you rely on
  Paper-only API).
- **Java 21**, Gradle or Maven — your choice, but include the full build file.
- Soft-depend on **Vault** (economy + permissions), **LuckPerms** (preferred for
  rank reads/writes), and **floodgate** (Bedrock players). The plugin must start
  and degrade gracefully — with clear console warnings — if any are missing.

---

## The three jobs the server owner asked for

1. **Verify that a player name is real, and hand back who they are.** On both
   the store's "Buy Now" form and the games page, the player types their name and
   presses **Verify**. One call to the plugin answers *does this player exist,
   have they ever joined this server, what is their exact in-server name* — and
   returns their **UUID, coin balance and current rank** in the same reply. This
   is `POST /player/verify`, the endpoint the whole website hangs off.
2. **Keep that info live for the store** — so the store can offer a **rank
   upgrade** priced at the difference rather than the full price, and show a real
   balance.
3. **Grant coins.** When someone finishes a mini-game on the website, the website
   tells the plugin to credit that player's in-game balance. This must work
   whether the player is online or offline, and it must never double-credit.

---

## Architecture

**The plugin hosts the HTTP API. The website is the only client.**

Do not have the plugin poll the website. Do not use RCON. Run a small embedded
HTTP server inside the plugin (Java's built-in `com.sun.net.httpserver`, or
Javalin/NanoHTTPD shaded in — your call, but keep the dependency footprint
small) on a configurable port, default **8123**.

All routes are under `/api/v1`. All request and response bodies are JSON
(`Content-Type: application/json`). All responses use conventional HTTP status
codes, and every error body is:

```json
{ "ok": false, "error": "human readable reason", "code": "MACHINE_CODE" }
```

Every success body starts with `"ok": true`.

### Threading — read this twice

HTTP requests arrive on their own threads. **Never touch the Bukkit API from
them.** Hop to the main thread (`Bukkit.getScheduler().callSyncMethod(...)`,
`.get()` with a timeout on the HTTP thread), do the work, then write the
response from the HTTP thread. Anything that can be done off-thread (reading
your own persisted transaction log, hashing, JSON) should stay off-thread so a
slow website request can never lag the server. Keep every sync task tiny.

If it is not much extra work, use a scheduler abstraction so a Folia port is
possible later — but plain Bukkit scheduling is acceptable.

---

## Authentication

Two layers, both required for mutating calls.

**1. Bearer key** on every request:

```
X-AngkorSMP-Key: <api-key from config.yml>
```

Reject with `401` and `code: "BAD_KEY"` if it is missing or wrong. Compare in
constant time.

**2. HMAC signature** on every `POST` (the mutating routes mint or spend
currency, so a leaked key alone must not be enough):

```
X-AngkorSMP-Timestamp: <unix millis>
X-AngkorSMP-Signature: <hex HMAC-SHA256>
```

The signed string is exactly:

```
<timestamp> + "\n" + <METHOD> + "\n" + <path> + "\n" + <raw request body>
```

signed with the same shared secret. Reject if the timestamp is more than
**120 seconds** from server time (`code: "STALE"`), or the signature does not
match (`code: "BAD_SIGNATURE"`). Keep a short-lived set of seen signatures to
reject exact replays.

Also support an optional `allowed-ips` list in config; when non-empty, refuse
anything from another address.

---

## Player identity — get this exactly right

Bedrock players reach this Java server through Geyser/Floodgate, which prefixes
their gamertag with `.` and replaces spaces with `_`. The website already
normalises names with this rule, and your plugin must agree with it *character
for character* or coins will land on the wrong account.

This is the website's function (JavaScript). Port it faithfully:

```js
function normalizeServerName(rawName, edition) {
  const trimmed = String(rawName ?? "").trim();
  if (edition === "bedrock") {
    const withoutDots = trimmed.replace(/^\.+/, "");   // don't double a dot the user typed
    const underscored = withoutDots.replace(/\s+/g, "_");
    return underscored ? `.${underscored}` : "";
  }
  return trimmed;                                       // Java names pass through
}
```

So `Play er`, `.Play er`, `Play_er` and `..Play  er` all normalise to `.Play_er`.

Validation rules the website applies before sending anything:
- Java: `^[A-Za-z0-9_]{2,16}$`
- Bedrock (after stripping the dot and underscoring spaces): `^[A-Za-z0-9_]{2,20}$`

**Important:** the `.` prefix is Floodgate's `username-prefix` setting and the
server owner can change it. Read it from Floodgate's config when Floodgate is
present, expose it at `GET /api/v1/server` as `bedrockPrefix`, and log a warning
if it is not `"."` — the website has that character hard-coded and will need
updating to match.

**Always key on UUID internally.** Names change. Resolve a name to a UUID once,
then store and act on the UUID. Return both in every response.

---

## Endpoints

### `GET /api/v1/health`

No auth required (used for an "is the bridge up?" indicator).

```json
{ "ok": true, "plugin": "AngkorLink", "version": "1.0.0", "serverVersion": "Paper 1.21.4" }
```

### `GET /api/v1/server`

```json
{
  "ok": true,
  "serverName": "AngkorSMP",
  "online": 12,
  "max": 100,
  "bedrockPrefix": ".",
  "economy": "EssentialsX Economy",
  "permissions": "LuckPerms",
  "features": { "coins": true, "ranks": true }
}
```

`features` reports what actually loaded, so the website can hide UI it cannot use.

### `POST /api/v1/player/verify` — *jobs 1 and 2, in one call*

This is the endpoint behind the **Verify** button on the website. The player
types their name, hits Verify, and this single call both confirms the name is
real and returns everything the store and games pages need to render.

Request:

```json
{ "name": "Play er", "edition": "bedrock" }
```

Normalise the name yourself using the rule above (do not trust the caller to
have done it), then look the player up.

Response when found:

```json
{
  "ok": true,
  "found": true,
  "uuid": "8f4e...",
  "name": ".Play_er",
  "edition": "bedrock",
  "hasPlayedBefore": true,
  "online": false,
  "coins": 12500,
  "rank":     { "id": "warden", "displayName": "Warden", "weight": 30 },
  "nextRank": { "id": "wither", "displayName": "Wither", "weight": 40 },
  "playtimeMinutes": 4210,
  "firstSeen": 1748563200000,
  "lastSeen": 1756310400000
}
```

Response when the name has never joined:

```json
{ "ok": true, "found": false, "name": ".Play_er", "reason": "NEVER_JOINED" }
```

Rules:
- Resolve from the server's own player data first (`Bukkit.getOfflinePlayer(name)`
  / the usercache), so it works offline and costs nothing.
- **Never call Mojang's API on the request thread.** If you support looking up
  Java players who have never joined, do it through an async cache with a
  timeout, and return `found: false, reason: "NEVER_JOINED"` rather than hanging.
- For Bedrock names, resolve through the Floodgate API when it is present.
- `coins` is the Vault economy balance, **rounded down to a whole number**. Vault
  works in doubles; the website treats coins as integers everywhere, so floor it
  and say so in your docs.
- `rank` is the highest-weight group from the ladder in `config.yml` that the
  player actually has. If they have none, return `null` — do **not** invent a
  "default" rank.
- `nextRank` is the next rung up the ladder, or `null` at the top.
- Cache the *resolve* half for ~60s, but always read `coins` and `rank` fresh —
  a stale balance on the store page leads to a purchase that fails at the till.

### `GET /api/v1/player/{uuid}/profile`

The same body as above, minus the resolve fields, for refreshing a player the
website has already verified — after a mini-game payout or a rank purchase,
where re-typing the name would be silly.

```json
{
  "ok": true,
  "uuid": "8f4e...",
  "name": ".Play_er",
  "online": false,
  "coins": 12500,
  "rank": { "id": "warden", "displayName": "Warden", "weight": 30 },
  "nextRank": { "id": "wither", "displayName": "Wither", "weight": 40 },
  "playtimeMinutes": 4210
}
```

### `GET /api/v1/ranks` — *job 2*

The rank ladder as the server actually defines it, in ascending order:

```json
{
  "ok": true,
  "ranks": [
    { "id": "bee",    "displayName": "Bee",    "weight": 10, "group": "bee",    "priceUsd": 3 },
    { "id": "zombie", "displayName": "Zombie", "weight": 20, "group": "zombie", "priceUsd": 6 },
    { "id": "warden", "displayName": "Warden", "weight": 30, "group": "warden", "priceUsd": 10 },
    { "id": "wither", "displayName": "Wither", "weight": 40, "group": "wither", "priceUsd": 15 },
    { "id": "dragon", "displayName": "Dragon", "weight": 50, "group": "dragon", "priceUsd": 20 }
  ]
}
```

These ids match the website's store items (`rank-bee`, `rank-zombie`,
`rank-warden`, `rank-wither`, `rank-dragon`). **The website computes upgrade
pricing** — target price minus the price of the rank they already hold — so all
you have to do is report the ladder and the player's place on it honestly.

### `POST /api/v1/coins/grant` — *job 3*

Request:

```json
{
  "transactionId": "round_9f2a1c77",
  "uuid": "8f4e...",
  "amount": 150,
  "reason": "Diamond Rush",
  "source": "minigame",
  "meta": { "gameId": "diamond-rush", "roundId": "9f2a1c77" }
}
```

Response:

```json
{
  "ok": true,
  "transactionId": "round_9f2a1c77",
  "applied": true,
  "duplicate": false,
  "balanceBefore": 12350,
  "balanceAfter": 12500
}
```

**Idempotency is mandatory.** Persist every `transactionId` you have processed,
along with the result. If the same id arrives again — the website retried, the
network hiccuped, someone replayed the request — return the **original stored
result** with `"duplicate": true` and `"applied": false`, and credit nothing.
This is the single most important correctness requirement in the whole plugin: a
retry that double-pays is a money bug.

Rules:
- `amount` must be a positive integer; reject anything else with `400` /
  `code: "BAD_AMOUNT"`.
- Enforce a configurable `max-grant-per-transaction` (default 5000) and reject
  above it with `code: "AMOUNT_TOO_LARGE"`. The website already caps mini-game
  payouts at 500/game/day and 2,500/day total, but the plugin should not simply
  trust that.
- Works for offline players (Vault economy deposits work offline).
- If the player is online, send them a short message — configurable, default
  `&e+{amount} Coins &7from &a{reason}&7 on the website`.
- Log every grant to `plugins/AngkorLink/transactions.log` with a timestamp.

### `POST /api/v1/coins/take`

Same shape, for spending coins on the website (a rank upgrade paid in coins).
Must be **atomic**: read balance, check sufficiency, withdraw — all inside one
sync task, so two simultaneous requests cannot both pass the check.

If the balance is short, return `200` with:

```json
{ "ok": true, "applied": false, "insufficient": true, "balance": 800, "required": 1500 }
```

Insufficient funds is a normal outcome, not an error — the website needs to show
a friendly message, not a stack trace.

#### Spending needs the player's say-so

A website account is only a typed name — anyone can type anyone's. That is fine
for *reading* a balance and fine for *granting* coins (the worst case is giving
somebody a present), but it is not fine for **spending** someone else's coins:
without a check, a stranger could drain a player's balance by buying them ranks
they never asked for.

So `coins/take` does not spend on its own. It asks the player in game:

1. The request arrives with a `confirmationId` and a description of what is being
   bought.
2. If the player is **offline**, respond `200` with
   `{ "ok": true, "applied": false, "pending": false, "reason": "PLAYER_OFFLINE" }`.
   The website will tell them to log in first.
3. If they are **online**, send them a chat prompt — a clickable
   `[Confirm] [Cancel]`, plus `/angkorlink confirm <id>` as a fallback — and
   respond immediately with
   `{ "ok": true, "applied": false, "pending": true, "confirmationId": "...", "expiresAt": ... }`.
4. The website then polls `GET /api/v1/confirm/{confirmationId}` (or you may add
   an optional outbound webhook) until it reads `approved`, `denied` or `expired`.
   Only on `approved` do you actually withdraw — atomically, as above.
5. Confirmations expire after a configurable `confirm-ttl-seconds` (default 120)
   and are single use.

`GET /api/v1/confirm/{confirmationId}` returns:

```json
{ "ok": true, "status": "approved", "uuid": "8f4e...", "amount": 4000, "balanceAfter": 8500 }
```

with `status` one of `pending` / `approved` / `denied` / `expired`.

This keeps the simple type-your-name flow the owner asked for, and puts the one
irreversible action behind proof that the person is actually holding the account.

### `POST /api/v1/rank/upgrade` — *job 2*

```json
{
  "transactionId": "order_Kd82nfQ1",
  "uuid": "8f4e...",
  "toRankId": "wither",
  "payWithCoins": 4000,
  "expectedFromRankId": "warden"
}
```

Do all of this as one idempotent unit:

1. If `expectedFromRankId` is present and does not match the player's current
   rank, refuse with `409` / `code: "RANK_CHANGED"` and return their real rank.
   (This stops a stale store page from selling an upgrade they already bought.)
2. If `payWithCoins` is set, it goes through the same in-game confirmation as
   `coins/take` above — prompt, return `pending: true`, and only withdraw once the
   player has approved. On insufficient funds change nothing and return
   `insufficient: true`. When `payWithCoins` is `null` (paid in real money through
   KHQR, which the owner has already approved in Telegram) no confirmation is
   needed — apply the rank straight away.
3. Remove the old ladder group and add the new one — via the LuckPerms API where
   available, falling back to Vault permissions, falling back to running the
   configured command. Never leave the player holding two ladder groups.
4. Return the new profile.

`payWithCoins: null` means the upgrade was paid for in real money through the
website's KHQR flow, so just apply the rank.

### `POST /api/v1/purchase/deliver`

The general path for store orders the owner has approved in Telegram. This
replaces the current raw-RCON delivery.

```json
{
  "transactionId": "order_Kd82nfQ1",
  "uuid": "8f4e...",
  "name": ".Play_er",
  "itemId": "coins-10000",
  "itemName": "10,000 Coins",
  "commands": ["eco give {player} 10000"],
  "requiresOnline": false
}
```

- `{player}`, `{uuid}`, `{item}` and `{order}` are substituted before running.
- Commands run as console, on the main thread, in order.
- Idempotent on `transactionId`, exactly as above.
- If `requiresOnline` is true and the player is offline, **queue it**: persist to
  `plugins/AngkorLink/pending.yml`, deliver on their next join, and respond with
  `"queued": true`. Never silently drop a paid delivery.
- Return per-command success so the website can show the owner what happened:

```json
{
  "ok": true, "transactionId": "order_Kd82nfQ1", "applied": true, "queued": false,
  "results": [{ "command": "eco give .Play_er 10000", "ok": true }]
}
```

## In-game commands

| Command | Permission | Does |
|---|---|---|
| `/angkorlink confirm <id>` | `angkorlink.confirm` (default: true) | Approves a pending website coin spend (fallback for the clickable prompt) |
| `/angkorlink deny <id>` | `angkorlink.confirm` (default: true) | Rejects one |
| `/angkorlink reload` | `angkorlink.admin` (default: op) | Reloads `config.yml` |
| `/angkorlink status` | `angkorlink.admin` | API port, hooks detected, last website call, pending deliveries |
| `/angkorlink test` | `angkorlink.admin` | Self-check: economy read/write, rank read, HTTP server bound |

---

## `config.yml`

Ship this fully commented — the server owner is not a developer.

```yaml
api:
  enabled: true
  port: 8123
  bind: "0.0.0.0"        # use 127.0.0.1 if the website runs on the same machine
  key: "CHANGE-ME"       # must match ANGKORLINK_KEY in the website's .env
  secret: "CHANGE-ME"    # must match ANGKORLINK_SECRET in the website's .env
  allowed-ips: []        # e.g. ["203.0.113.10"] — empty means any

coins:
  max-grant-per-transaction: 5000
  notify-online-players: true
  message: "&e+{amount} Coins &7from &a{reason}&7 on the website"
  # Spending coins from the website asks the player in game first.
  confirm-ttl-seconds: 120
  confirm-message: "&6The website wants to spend &e{amount} Coins&6 on &a{reason}&6."

ranks:
  # Ascending order. `id` must match the website's store item ids.
  ladder:
    - { id: bee,    group: bee,    displayName: "Bee",    weight: 10, priceUsd: 3 }
    - { id: zombie, group: zombie, displayName: "Zombie", weight: 20, priceUsd: 6 }
    - { id: warden, group: warden, displayName: "Warden", weight: 30, priceUsd: 10 }
    - { id: wither, group: wither, displayName: "Wither", weight: 40, priceUsd: 15 }
    - { id: dragon, group: dragon, displayName: "Dragon", weight: 50, priceUsd: 20 }
  # Used only if neither the LuckPerms API nor Vault is available.
  fallback-set-command: "lp user {player} parent set {group}"

logging:
  transactions: true     # plugins/AngkorLink/transactions.log
  debug: false
```

---

## Build it in this order

1. **Phase 1** — plugin skeleton, embedded HTTP server, auth (key + HMAC),
   `/health`, `/server`, and the resolve half of `/player/verify`. This alone
   unblocks the Verify button on both website pages.
2. **Phase 2** — Vault/LuckPerms hooks: the `coins` / `rank` / `nextRank` half of
   `/player/verify`, plus `/player/{uuid}/profile` and `/ranks`.
3. **Phase 3** — `/coins/grant` with the persisted transaction log and
   idempotency.
4. **Phase 4** — `/coins/take` and `/rank/upgrade` with the in-game spend
   confirmation, then `/purchase/deliver` and the offline queue.

---

## Acceptance tests — state the result of each in your final message

1. `POST /player/verify` with `{"name":"Play er","edition":"bedrock"}` returns
   `.Play_er` **and** that player's real coin balance and rank. Same normalised
   name for `.Play er`, `Play_er` and `..Play  er`.
2. A name that has never joined returns `found: false`, not an error, and does
   not block for a network round-trip.
3. `POST /coins/grant` sent **twice with the same `transactionId`** credits the
   player exactly once, and the second call returns `duplicate: true` with the
   first call's balances.
4. `/coins/grant` for an **offline** player changes their balance, and they see
   the message when they next log in.
5. `/coins/take` for an **offline** player spends nothing and returns
   `reason: "PLAYER_OFFLINE"`.
6. `/coins/take` for an online player spends nothing until they click Confirm,
   spends nothing at all if they click Cancel, and expires on its own after the
   TTL.
7. Two simultaneous approved spends for more than half the balance each: exactly
   one succeeds, the other returns `insufficient: true`. The balance never goes
   negative.
8. `/rank/upgrade` leaves the player in exactly one ladder group.
9. `/purchase/deliver` with `requiresOnline: true` for an offline player queues
   it, survives a **server restart**, and delivers on their next join.
10. A request with a wrong key, a tampered body, or a 5-minute-old timestamp is
   rejected.
11. Hammer `/player/verify` 200×/second and confirm the server TPS does not move
   — no Bukkit API is being touched off the main thread, and nothing blocks it.
12. The plugin starts cleanly with Vault, LuckPerms and Floodgate all **absent**,
    logging what is disabled rather than throwing.

---

## Deliverables

- Full source, buildable with one command, plus the built `.jar`.
- `config.yml` commented as above.
- A `README.md` covering: installation, how to generate the key and secret, which
  port to open (and the warning to keep it firewalled to the website's IP or on
  localhost), and every endpoint with a `curl` example.
- **An `openapi.yaml`** describing the API, so the website side can be generated
  against it.

## Please do not

- Do not add a database. Flat files (`transactions.log`, `pending.yml`) are
  right for this server's size.
- Do not add a web dashboard, placeholders, or scoreboard features. Only what is
  specified.
- Do not touch the Bukkit API from an HTTP thread.
- Do not swallow exceptions — log them with the transaction id.
- Do not rename anything in this contract.

---

# What changes on the website side (for reference — you are not building this)

Once the plugin is running, the website will:

- Put a **Verify** button next to the name field on the store's Buy Now form and
  the games page, calling `/player/verify` and refusing names that have never
  joined. The reply fills in the player's UUID, coins and rank in one go.
- Store the verified UUID against the browser, and re-read the balance with
  `/player/{uuid}/profile` rather than making people verify again.
- Call `/coins/grant` at the end of every mini-game round, using the round id as
  the `transactionId`, replacing the local `data/gamestats.json` ledger with the
  real in-game balance.
- Show live coins and current rank on the store page, and offer rank upgrades
  priced at the difference, paid in KHQR or in coins via `/coins/take` — the
  latter showing a "confirm it in game" step while the plugin waits on the
  player.
- Replace the current RCON delivery on Telegram "Accept" with
  `/purchase/deliver`.

The website will read `ANGKORLINK_URL`, `ANGKORLINK_KEY` and `ANGKORLINK_SECRET`
from its `.env`.
