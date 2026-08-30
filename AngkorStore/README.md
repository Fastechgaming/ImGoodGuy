# AngkorStore

Bridges the AngkorSMP website to this server: a live coin balance, the real
rank ladder, and store/game delivery, over a small authenticated HTTP API
the plugin hosts. Replaces the earlier AngkorLink plugin (same idea, this
one is data-driven off LuckPerms group membership and uses a simpler
single-secret auth instead of key+HMAC signing).

## Requirements

- Paper 1.21.x (Spigot 1.20.6+ should work; nothing here is Paper-only aside
  from `Server#getOfflinePlayerIfCached`, called out below if you're on
  Spigot).
- Java 21.
- **Vault**, with a real economy plugin registered behind it (EssentialsX,
  CMI, a coins plugin, etc.) — needed for coin balance/grant.
- **LuckPerms** — needed for rank detection/upgrade. Everything still starts
  and runs without either; the features they provide are just off, logged
  clearly at startup (`/angkorstore status` shows what's hooked).
- **LiteBans** (SQLite storage), for the website's Banned Players list — same
  deal, off without it. This one is read directly from LiteBans' own
  database file (see `litebans.database-path` in config.yml), not through a
  plugin API, since LiteBans doesn't have one for listing punishments.

## Building

From inside this folder (`AngkorStore/`, the one with `build.gradle` in it):

```
./gradlew build
```

On Windows use `gradlew.bat build` instead. The wrapper downloads its own
matching Gradle the first time you run it — you do **not** need Gradle
installed separately, only a JDK (21). On Termux: `pkg install openjdk-21`
first, then the same `./gradlew build` command works.

The jar comes out at `build/libs/AngkorStore-1.0.0.jar` — that's the one to
deploy; `./gradlew build` runs the Shadow plugin automatically, which bundles
the SQLite JDBC driver `hooks.LiteBansHook` needs (the server doesn't provide
one, unlike Vault/LuckPerms whose own plugins do) directly into that same
jar, under a relocated package so it can't clash with any other plugin
shading its own copy. There's no separate jar to remember to grab.

Building needs real internet access to `repo.papermc.io`, `jitpack.io`, and
`repo.lucko.me` to resolve `paper-api`/`VaultAPI`/`luckperms-api` — this
repo's own sandbox blocks those hosts, so the source was instead compiled
clean against hand-written stubs of the exact Bukkit/Vault/LuckPerms/Gson
methods it calls, which catches typos and structural mistakes but is not a
substitute for a real build against the real jars. (`hooks.LiteBansHook`
itself was verified further than that: compiled and run against the real
`org.xerial:sqlite-jdbc` driver — which mavenCentral serves fine even in
this sandbox — reading a real SQLite file shaped like LiteBans' own schema,
which is how a JDBC URL bug in the read-only connection string was actually
caught rather than just guessed at.) Run `./gradlew build` yourself before
you trust the output, same as you would for any plugin you didn't build
yourself.

Common snags:
- `Permission denied` running `./gradlew` → `chmod +x gradlew` once.
- Build fails to resolve dependencies → check you actually have internet
  access to the three hosts above (a captive portal, VPN, or firewall can
  silently block just those).
- First run is slow (downloading Gradle itself, then the dependencies) —
  normal, later builds are much faster.

## Installing

1. Drop the jar in `plugins/`, start the server once so it writes
   `plugins/AngkorStore/config.yml`, stop it again (or use `/angkorstore
   reload` instead of a restart once it's already running).
2. Edit `config.yml`:
   - `api.secret` — set this to a long random string. Put the **same**
     string in the website's `.env` as `ANGKORSTORE_SECRET`.
   - `api.port` / `api.bind` — default `8123` / `0.0.0.0`. Use `127.0.0.1`
     for `bind` if the website runs on this same machine; otherwise **put
     this port behind a firewall rule or a tunnel/VPN restricted to the
     website's IP** — the secret travels in a plain header on every
     request, so an open, unencrypted `0.0.0.0:8123` is genuinely exposed.
   - `ranks.ladder` — your actual rank groups and prices, ascending. Only
     these exact groups are ever read from or written to a player's
     LuckPerms data; every other group they hold is invisible to this
     plugin and to the website.
   - `coins.give-command` — the console command that actually credits a
     player, e.g. `eco give coin {player} {amount}` for a multi-currency
     Vault economy, or `eco give {player} {amount}` for a plain one. Match
     whatever your economy plugin expects.
3. `/angkorstore reload`, then `/angkorstore status` to confirm the API is
   listening and Vault/LuckPerms are hooked, `/angkorstore test` for a
   quick self-check.
4. In the website's `.env`:
   ```
   ANGKORSTORE_URL=http://this-box-ip:8123
   ANGKORSTORE_SECRET=<the same string as api.secret>
   ```

## Why no request-signing

The previous plugin (AngkorLink) used a key plus an HMAC signature per
request. It worked, but every mismatch was hard to diagnose remotely — a
stale process, a trailing space, or a clock skew all produced the identical
"Invalid request signature" with no way to tell which. This plugin uses one
shared secret in a header instead: a wrong or mismatched secret is a
literal string comparison you can check with one `curl` call. The tradeoff
is that the secret itself travels on the wire, so **the port needs to be
firewalled or tunneled** if this server is reachable from the open
internet — see the install step above.

## Performance

- The HTTP server runs on its own thread pool, never the main thread.
- Every Bukkit/Vault touch (economy reads, command dispatch, player lookup)
  hops onto the main thread for the smallest possible unit of work via
  `util.MainThread`, and the HTTP worker thread waits on that with a 5s
  timeout rather than blocking the server.
- LuckPerms reads/writes run on LuckPerms' own async executor and never
  touch the main thread at all — group membership lookups can hit its
  storage backend, which is exactly the kind of call that must never block
  the server.
- Player name resolution never calls Mojang; it only reads this server's
  own local player cache (`getOfflinePlayerIfCached`), so a name that has
  never joined returns instantly instead of hanging on a network call.

## Endpoints

All under `/api/v1`. Every request except `GET /health` needs:

```
X-AngkorStore-Secret: <api.secret from config.yml>
```

Every response starts with `"ok": true` or `"ok": false, "error": "...", "code": "..."`.

### `GET /api/v1/health` — no auth

```
curl http://localhost:8123/api/v1/health
```
```json
{ "ok": true, "plugin": "AngkorStore", "version": "1.0.0", "serverVersion": "..." }
```

### `GET /api/v1/server`

```
curl -H "X-AngkorStore-Secret: $SECRET" http://localhost:8123/api/v1/server
```
```json
{ "ok": true, "serverName": "...", "online": 4, "max": 100, "bedrockPrefix": ".",
  "economy": "EssentialsX Economy", "permissions": "LuckPerms",
  "features": { "coins": true, "ranks": true } }
```

### `POST /api/v1/player/verify`

```
curl -X POST -H "X-AngkorStore-Secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"name":"Notch","edition":"java"}' http://localhost:8123/api/v1/player/verify
```
```json
{ "ok": true, "found": true, "uuid": "...", "name": "Notch", "edition": "java",
  "hasPlayedBefore": true, "online": false, "coins": 12500,
  "rank": { "id": "warden", "displayName": "Warden", "weight": 30 },
  "nextRank": { "id": "wither", "displayName": "Wither", "weight": 40 },
  "ranks": [
    { "id": "zombie", "displayName": "Zombie", "weight": 20 },
    { "id": "warden", "displayName": "Warden", "weight": 30 }
  ] }
```

`rank` is the highest-weight configured group the player holds (`null` if
none — never a guessed default). `ranks` is **every** configured ladder
group they hold, ascending — a player can legitimately hold more than one
(e.g. bought Zombie, then separately bought Wither without giving up
Zombie); the website uses this list to offer an upgrade from whichever one
they pick. A name that's never joined:

```json
{ "ok": true, "found": false, "name": "Notch", "reason": "NEVER_JOINED" }
```

### `GET /api/v1/player/{uuid}/profile`

Same shape as verify, minus the resolve fields — for refreshing a player
the website already has a UUID for.

### `GET /api/v1/ranks`

The configured ladder, ascending, each with its LuckPerms `group` and
`priceUsd` alongside `id`/`displayName`/`weight`.

### `GET /api/v1/bans`

Currently-active LiteBans bans, most recent first (capped at
`litebans.max-results`, default 200):

```json
{
  "ok": true,
  "available": true,
  "bans": [
    { "player": "Steve123", "uuid": "...", "reason": "Griefing",
      "bannedBy": "AdminOne", "bannedAt": 1735689600000, "expiresAt": null }
  ]
}
```

`expiresAt` is `null` for a permanent ban, otherwise an epoch-millis
timestamp. `available: false` (with an empty `bans` array, still `200 OK`)
means LiteBans isn't installed, `litebans.enabled` is off, or its database
file wasn't found at `litebans.database-path` — never an error response,
same as how the website already handles the plugin being unreachable at
all. `player` falls back to the raw UUID string if this server has never
seen that player join (so it has no cached name for them).

### `POST /api/v1/coins/grant`

```json
{ "transactionId": "round_9f2a1c77", "uuid": "...", "amount": 150, "reason": "Diamond Rush" }
```

Idempotent on `transactionId` — send it twice, the player is credited once,
and the second call returns `"duplicate": true` with the first call's
`balanceBefore`/`balanceAfter`. Works offline (Vault deposits work offline).
There is **no endpoint anywhere in this plugin that removes coins** — coins
only ever move from the website's ledger into the game, never back out.

### `POST /api/v1/purchase/deliver`

```json
{ "transactionId": "order_Kd82nfQ1", "uuid": "...", "name": "Notch",
  "itemId": "coins-10000", "itemName": "10,000 Coins",
  "commands": ["eco give coin Notch 10000"], "requiresOnline": false }
```

Idempotent, same as coins/grant. If `requiresOnline` is true and the player
is offline, it's queued (`plugins/AngkorStore/pending.json`, survives a
restart) and delivered on their next join.

### `POST /api/v1/rank/upgrade`

```json
{ "transactionId": "order_Kd82nfQ1", "uuid": "...", "toRankId": "warden", "expectedFromRankId": "bee" }
```

If `expectedFromRankId` no longer matches the player's actual current rank
(they ranked up or their rank changed since the store priced the offer),
this refuses with `409` / `code: "RANK_CHANGED"` and their real current
rank, rather than silently acting on stale pricing. Otherwise removes the
old ladder group and adds the new one, and returns the fresh profile.

## In-game commands

| Command | Permission | Does |
|---|---|---|
| `/angkorstore reload` | `angkorstore.admin` (op) | Reloads config.yml, rebuilds hooks and the HTTP server |
| `/angkorstore status` | `angkorstore.admin` | API port, Vault/LuckPerms hook state, pending-delivery count |
| `/angkorstore test` | `angkorstore.admin` | Self-check: HTTP bound, economy/rank read, secret still default? |

## What this plugin will never do

- Take coins away from a player, on any endpoint.
- Touch a group that isn't in `ranks.ladder` — a player's staff/donor/event
  groups are never read, reported, or modified.
- Call Mojang's API, or block the main thread waiting on anything.
