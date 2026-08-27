# Prompt: fix AngkorLink v4 before it goes live

> Copy everything below the line into the AI that wrote the plugin.

---

## Context

You wrote the AngkorLink plugin (the zip `AngkorLinkFIXEDv4`). It has been
checked against the real AngkorSMP website by mirroring your `ApiServer` and
`AuthService` logic exactly and running the live website's client against it.

**The good news: the wire protocol is correct.** Do not change any of this:

* header names `X-AngkorSMP-Key` / `X-AngkorSMP-Timestamp` / `X-AngkorSMP-Signature`
* the signed string `timestamp\nMETHOD\npath\nbody`, HMAC-SHA256, lowercase hex,
  120-second window, replay rejection
* the endpoint paths and every request/response field name
* Bedrock normalisation (`Play er` → `.Play_er`) — byte-for-byte identical to the website
* idempotency on `transactionId` for `coins/grant` — verified working
* the absence of any endpoint that removes coins — correct, keep it that way

Seven defects need fixing. They are listed worst-first. Do not restructure the
plugin; make these changes and nothing else.

---

## 1. A queued delivery can be queued twice — a player gets paid items twice

**Where:** `ApiServer.deliver()`, the `onlineReq && Bukkit.getPlayer(u)==null` branch.

That branch calls `p.pending().put(d)` and returns, but never calls
`p.transactions().put(...)`. So the duplicate check at the top of `deliver()`
never sees it, and a retried request queues a **second** copy of the same
delivery. On the player's next join both run.

Reproduced: posting the same `transactionId` twice with `requiresOnline: true`
returned `queued: true` both times, and the pending store held two entries.

**Fix**
* Record the transaction id when a delivery is queued, not only when it runs.
* Make `PendingStore.put` ignore an id it already holds.
* Keep returning `queued: true` on the duplicate so the website's message stays
  accurate — but add `"duplicate": true`.

---

## 2. `uuid` is mandatory, but the website cannot always supply one

**Where:** `ApiServer.grant()` and `ApiServer.deliver()` — both call
`req(b,"uuid")`, which throws on a missing, null or blank value and turns into a
generic `400 BAD_REQUEST`.

The website sends `uuid: null` whenever it does not have one: any store order
placed before this plugin was installed, and any player whose website session
predates it. Those deliveries fail outright.

Reproduced: `POST /purchase/deliver` with `uuid: null` and a valid `name`
returned `400 Invalid request (uuid required)`.

**Fix**
* In both endpoints, accept **either** `uuid` **or** `name` (+ optional
  `edition`, defaulting to `java`).
* When `uuid` is absent, resolve `name` the same way `/player/verify` does.
* Only return `400` when both are missing, and use a specific code —
  `MISSING_PLAYER` — rather than the catch-all.
* If the name cannot be resolved, return `404` with `code: "PLAYER_NOT_FOUND"`.

---

## 3. Rank comes back `null` for offline players, so the store shows no rank

**Where:** `AngkorLinkPlugin.rankSync(UUID)`.

Two separate faults:

1. `lp.getUserManager().getUser(uuid)` returns the **loaded** user, which is
   `null` for anyone not currently online. Offline players therefore fall
   through to Vault, and if Vault permissions are absent, to `null`.
2. `u.getCachedData().getPermissionData().checkPermission(r.group())` checks a
   permission literally named `"warden"`. LuckPerms inheritance is the node
   `"group.warden"`. As written this is almost always false, so even online
   players only resolve through the `getPrimaryGroup()` fallback — which misses
   anyone whose primary group is `default` while holding a rank group.

This matters because the store is mostly browsed by players who are **not** in
game at that moment. They see "No rank yet" and a plain "Buy Now" on every rank,
instead of "Upgrade Now" and the rank they already own.

**Fix**
* Use `userManager.loadUser(uuid)` (returns a `CompletableFuture<User>`) when
  `getUser` returns null, so offline players resolve. Keep it off the main thread.
* Test inheritance properly: check `InheritanceNode`s (`user.getNodes(NodeType.INHERITANCE)`)
  for the ladder's group names, or `checkPermission("group." + r.group())`.
* Keep returning the **highest-weight** group the player actually holds, and
  `null` when they hold none — do not invent a default rank.

---

## 4. `Bukkit.getOfflinePlayer(String)` runs on the main thread and can block

**Where:** `AngkorLinkPlugin.resolveAsync` — inside `callSyncMethod`.

`Bukkit.getOfflinePlayer(String)` is deprecated precisely because it may make a
blocking web request to Mojang for a name that is not in the usercache. You are
calling it on the main thread. `/player/verify` is hit from the store form and
the games name gate, so a few unknown names can stall the server.

**Fix**
* Use Paper's `Bukkit.getOfflinePlayerIfCached(name)`, which never blocks.
* If it returns null (or `hasPlayedBefore()` is false), answer
  `{ ok: true, found: false, reason: "NEVER_JOINED" }` — which is exactly what
  the website wants. Never go to the network to answer this endpoint.
* Keep the Floodgate path for Bedrock names as it is.

---

## 5. HTTP responses are written from the main server thread

**Where:** `ApiServer.grant()` and `ApiServer.deliver()` both call `send(...)`
from inside `Bukkit.getScheduler().runTask(...)`.

`send()` does socket I/O. Doing it on the main thread is the exact thing to
avoid, and it is unnecessary.

**Fix:** inside the sync task do only the Bukkit work (balance read, deposit,
`dispatchCommand`) and stash the outcome; complete a `CompletableFuture` with
it; write the response from the HTTP thread.

---

## 6. The plugin will not start if Vault is missing

`net.milkbowl.vault.economy.Economy` appears as a field type and `Economy.class`
is dereferenced in `setupHooks()`. With Vault absent that is a
`NoClassDefFoundError` on enable, rather than the graceful degradation the brief
asked for.

**Fix:** isolate every Vault reference behind a small wrapper class that is only
loaded when `Bukkit.getPluginManager().getPlugin("Vault") != null`, so the main
class never resolves Vault types. Same treatment for LuckPerms and Floodgate.
Log clearly what is disabled and carry on.

---

## 7. A partly-failed delivery re-runs its successful commands

**Where:** `ApiServer.deliver()` — `if(all) p.transactions().put(...)`.

If command 1 succeeds and command 2 fails, nothing is recorded, so a retry runs
command 1 again.

**Fix:** record the transaction regardless, storing the per-command results. On a
replay, return the stored results with `duplicate: true` and run nothing. If you
would rather allow a retry of the failed part, record which commands succeeded
and re-run only the rest — but never re-run a command that already succeeded.

---

## Also worth knowing (no action needed)

* `/rank/upgrade` is implemented but the website never calls it. Store rank
  purchases go through `/purchase/deliver` running the item's configured
  command (`lp user {player} parent add wither`). Leave the endpoint in place.
* `config.yml` defaults `api.bind` to `0.0.0.0`. The website will run on the
  same machine, so `127.0.0.1` is the safer default — change the shipped value.

---

## When you are done

State the result of each of these, having actually run them:

1. Same `transactionId` posted twice to `/purchase/deliver` with
   `requiresOnline: true` for an offline player → queued **once**, second
   response says `duplicate: true`, and the player receives the item once.
2. `/purchase/deliver` and `/coins/grant` with **no** `uuid` but a valid `name`
   → resolves and succeeds.
3. `/player/verify` for a player who has a rank but is **offline** → returns
   that rank, not `null`.
4. `/player/verify` hammered 200×/second with names that have never joined →
   server TPS does not move and no network call is made.
5. Plugin starts cleanly with Vault, LuckPerms and Floodgate **all absent**,
   logging what is disabled instead of throwing.
6. Existing behaviour still intact: `coins/grant` twice with one id credits once;
   `Play er`, `.Play er` and `Play_er` (bedrock) all normalise to `.Play_er`;
   a wrong key, a tampered body and a 5-minute-old timestamp are all rejected.

Ship the updated source plus a built `.jar`.
