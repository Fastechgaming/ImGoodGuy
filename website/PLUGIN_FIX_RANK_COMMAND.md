# Prompt: fix the console-command rank fallback in AngkorLink

> Copy everything below the line into the AI working on the AngkorLink plugin
> source (`AngkorLink-final/`). It already has full context of this codebase —
> this is a precise, scoped bug report and fix, not a new feature.

---

## Everything else checked out — this is the one real bug

I reviewed the plugin against the website's contract (`PLUGIN_PROMPT.md`):
auth (key + HMAC, matches byte-for-byte), `/player/verify`, `/coins/grant`
idempotency, `/purchase/deliver`, the offline queue — all correct and
consistent with what the website actually sends. **Only the third-tier rank
fallback needs a fix.**

## The bug

`setRankSync` in `AngkorLinkPlugin.java` has three fallback tiers for
changing a player's rank group: LuckPerms API, then Vault permissions, then a
console command. The first two tiers are careful — they remove **only the
ladder groups** the player currently holds, one at a time, then add the new
one:

```java
// LuckPerms tier - removes only nodes matching a ladder group, adds one
for(RankInfo r:ladder) node.stream().filter(n->n.getKey().equalsIgnoreCase("group."+r.group())).forEach(n->u.data().remove(n));
u.data().add(net.luckperms.api.node.types.InheritanceNode.builder(target.group()).build());

// Vault tier - same idea, per-group remove then add
for(RankInfo r:ladder) try{vaultPerms.playerRemove(null,p,r.group());}catch(Exception ignored){}
vaultPerms.playerAdd(null,p,target.group());
```

The **third tier — the console-command fallback, used only when neither
LuckPerms nor Vault permissions are available — does something different and
blunter**:

```java
// current code, AngkorLinkPlugin.java, setRankSync
String cmd=getConfig().getString("ranks.fallback-set-command","")
  .replace("{player}",Objects.toString(p.getName(),uuid.toString()))
  .replace("{uuid}",uuid.toString())
  .replace("{group}",target.group());
return !cmd.isBlank()&&Bukkit.dispatchCommand(Bukkit.getConsoleSender(),cmd);
```

with `config.yml`:

```yaml
fallback-set-command: "lp user {player} parent set {group}"
```

`lp parent set` replaces **all** of a player's parent groups with the one
given — not just the ladder ones the other two tiers are careful to leave
alone. On a server where players hold any other parent group (a donor perk
group, a verified-player group, anything outside the rank ladder), this
fallback silently strips it. It's also just a different, less explicit
operation than what was asked for: an upgrade should read as "remove the old
rank, add the new one," the same shape as the other two tiers.

## The fix

**1. `config.yml`** — replace the single command with two:

```yaml
ranks:
  ladder:
    - { id: bee,    group: bee,    displayName: "Bee",    weight: 10, priceUsd: 3 }
    - { id: zombie, group: zombie, displayName: "Zombie", weight: 20, priceUsd: 6 }
    - { id: warden, group: warden, displayName: "Warden", weight: 30, priceUsd: 10 }
    - { id: wither, group: wither, displayName: "Wither", weight: 40, priceUsd: 15 }
    - { id: dragon, group: dragon, displayName: "Dragon", weight: 50, priceUsd: 20 }
  # Used only if neither the LuckPerms API nor Vault permissions are available.
  fallback-remove-command: "lp user {player} parent remove {group}"
  fallback-add-command: "lp user {player} parent add {group}"
```

**2. `AngkorLinkPlugin.java`** — `setRank`/`setRankSync` currently only
receive the **target** rank, not the player's current one, so the
command-fallback tier has nothing to remove by name. The caller
(`ApiServer.upgrade()`) already has the current rank in hand — it fetched
`pr` (the player's profile, including `pr.rank()`) right before calling
`setRank`, to check `expectedFromRankId`. Thread it through:

```java
// AngkorLinkPlugin.java - change the signature to take both ranks
public CompletableFuture<Boolean> setRank(UUID uuid, RankInfo current, RankInfo target){
  return CompletableFuture.supplyAsync(()->{try{return Bukkit.getScheduler().callSyncMethod(this,()->setRankSync(uuid,current,target)).get(5,TimeUnit.SECONDS);}catch(Exception e){throw new CompletionException(e);}});
}
private boolean setRankSync(UUID uuid, RankInfo current, RankInfo target){
  OfflinePlayer p=Bukkit.getOfflinePlayer(uuid);
  if(luckPerms!=null){ /* unchanged - already correct */ }
  if(vaultPerms!=null){ /* unchanged - already correct */ }

  // Console-command fallback: explicit remove-then-add, same shape as the
  // two tiers above, instead of one blunt "parent set".
  String playerName = Objects.toString(p.getName(), uuid.toString());
  boolean removeOk = true;
  if (current != null && !current.group().equalsIgnoreCase(target.group())) {
    String removeCmd = getConfig().getString("ranks.fallback-remove-command","")
      .replace("{player}",playerName).replace("{uuid}",uuid.toString()).replace("{group}",current.group());
    removeOk = removeCmd.isBlank() || Bukkit.dispatchCommand(Bukkit.getConsoleSender(),removeCmd);
  }
  String addCmd = getConfig().getString("ranks.fallback-add-command","")
    .replace("{player}",playerName).replace("{uuid}",uuid.toString()).replace("{group}",target.group());
  boolean addOk = !addCmd.isBlank() && Bukkit.dispatchCommand(Bukkit.getConsoleSender(),addCmd);
  return removeOk && addOk;
}
```

`current` is `null` for a player's very first rank purchase (they hold no
ladder group yet) — skip the remove step in that case, which the snippet
above already does.

**3. `ApiServer.java`** — the one call site, in `upgrade()`, already has the
current rank as `pr.rank()`:

```java
// before
p.setRank(u,target).thenCompose(ok->p.profile(u))...

// after
p.setRank(u,pr.rank(),target).thenCompose(ok->p.profile(u))...
```

**4. `AngkorLinkPlugin.java` `server()` handler in `ApiServer.java`** — the
`features.ranks` flag checks whether a fallback command is configured:

```java
// before
f.addProperty("ranks",!p.ladder().isEmpty()&&(p.luckPerms()!=null||p.vaultPerms()!=null||!p.getConfig().getString("ranks.fallback-set-command","").isBlank()));

// after - check the add-command, which is the minimum required one
f.addProperty("ranks",!p.ladder().isEmpty()&&(p.luckPerms()!=null||p.vaultPerms()!=null||!p.getConfig().getString("ranks.fallback-add-command","").isBlank()));
```

## Please do not

- Do not touch the LuckPerms or Vault tiers — they're already correct.
- Do not rename anything else in the API contract (endpoints, JSON fields,
  headers) — the website is built against the current one exactly.
- Do not add a migration for old `config.yml` files; a fresh default with the
  two new keys is fine, this plugin has not shipped to the live server yet.

## When you're done, state in your final message

1. Confirmation the LuckPerms and Vault tiers were left untouched.
2. That `setRank`/`setRankSync` now take `current` and `target`, and the one
   call site in `ApiServer.upgrade()` was updated to pass `pr.rank()`.
3. That a first-ever rank purchase (`current == null`) skips the remove
   command and only runs add.
4. That `config.yml` and its comments were updated to the two new keys.
