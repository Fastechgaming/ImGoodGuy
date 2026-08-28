# Prompt: detect rank from the player's chat prefix, not group membership

> Copy everything below the line into the AI working on the AngkorLink plugin
> source (`AngkorLink-final/`). It already has full context of this codebase.

---

## What changes and why

Right now `rankSync` in `AngkorLinkPlugin.java` decides a player's rank by
checking **group membership** — does the player have permission
`group.<name>`, or is it their primary group. The server owner wants rank
**detection** to instead read the player's actual **highest-priority chat
prefix** from LuckPerms and match it against the exact formatted string each
rank uses, since that's the thing that's actually guaranteed to reflect what
the player sees of themselves in-game:

| Prefix (exact string) | Rank |
|---|---|
| `&7&lplayer&r` | *(no rank — default)* |
| `&e&lBEE&r` | Bee |
| `&a&lZOMBIE&r&f` | Zombie |
| `&b&lWARDEN&r&f` | Warden |
| `&c&lWITHER&r` | Wither |
| `&d&lDRAGON&r` | Dragon |

**This only changes how the plugin *reads* a player's current rank.** It does
**not** change how a rank is *granted* — `setRankSync` (the LuckPerms/Vault/
console-command tiers that add and remove the `bee`/`zombie`/etc. **groups**
on `/rank/upgrade`) stays exactly as it is, including the remove-then-add fix
from the earlier prompt if you've already applied it. Groups are still the
real permission mechanism; the prefix is only how the plugin now reads which
one currently applies. Do not try to "set" a rank by setting a prefix.

## The fix

### 1. `config.yml` — add a `prefix` to each ladder entry

```yaml
ranks:
  ladder:
    - { id: bee,    group: bee,    displayName: "Bee",    weight: 10, priceUsd: 3,  prefix: "&e&lBEE&r" }
    - { id: zombie, group: zombie, displayName: "Zombie", weight: 20, priceUsd: 6,  prefix: "&a&lZOMBIE&r&f" }
    - { id: warden, group: warden, displayName: "Warden", weight: 30, priceUsd: 10, prefix: "&b&lWARDEN&r&f" }
    - { id: wither, group: wither, displayName: "Wither", weight: 40, priceUsd: 15, prefix: "&c&lWITHER&r" }
    - { id: dragon, group: dragon, displayName: "Dragon", weight: 50, priceUsd: 20, prefix: "&d&lDRAGON&r" }
```

`group` stays — it's still what `setRankSync` adds/removes on upgrade.
`prefix` is new and is only used for reading the current rank.

### 2. `RankInfo.java` — add the field

```java
// before
public record RankInfo(String id, String displayName, int weight, String group, double priceUsd) {}

// after
public record RankInfo(String id, String displayName, int weight, String group, double priceUsd, String prefix) {}
```

Update every place that constructs a `RankInfo` accordingly — that's
`loadSettings()` in `AngkorLinkPlugin.java`, reading the new `prefix` key the
same way it already reads `id`/`group`/`displayName`/`weight`/`priceUsd` from
each map in `ranks.ladder`.

### 3. `AngkorLinkPlugin.java` — rewrite `rankSync`

```java
// before
private RankInfo rankSync(UUID uuid){
  if(luckPerms!=null){
    try{
      var lp=(net.luckperms.api.LuckPerms)luckPerms;
      var u=lp.getUserManager().getUser(uuid);
      if(u!=null){
        RankInfo best=null;
        for(RankInfo r:ladder)
          if(u.getCachedData().getPermissionData().checkPermission(r.group()).asBoolean()||u.getPrimaryGroup().equalsIgnoreCase(r.group()))
            best=r;
        return best;
      }
    }catch(Throwable ignored){}
  }
  if(vaultPerms!=null){
    OfflinePlayer p=Bukkit.getOfflinePlayer(uuid);
    RankInfo best=null;
    for(RankInfo r:ladder) if(vaultPerms.playerHas(null,p,r.group())) best=r;
    return best;
  }
  return null;
}

// after
private RankInfo rankSync(UUID uuid){
  if(luckPerms!=null){
    try{
      var lp=(net.luckperms.api.LuckPerms)luckPerms;
      var u=lp.getUserManager().getUser(uuid);
      if(u!=null){
        String prefix=u.getCachedData().getMetaData().getPrefix();
        return matchPrefix(prefix);
      }
    }catch(Throwable ignored){}
  }
  if(vaultPerms!=null){
    OfflinePlayer p=Bukkit.getOfflinePlayer(uuid);
    // use whichever prefix-lookup signature matches the Vault version already
    // in use elsewhere in this file (playerHas already takes a (World, OfflinePlayer, ...) form)
    String prefix=vaultPerms.getPrefix(null,p);
    return matchPrefix(prefix);
  }
  return null;
}
private RankInfo matchPrefix(String prefix){
  if(prefix==null||prefix.isBlank())return null;
  for(RankInfo r:ladder) if(prefix.equalsIgnoreCase(r.prefix())) return r;
  return null; // includes the default "&7&lplayer&r" - not an error, just unranked
}
```

`getPrefix()` returns LuckPerms' already-resolved, highest-priority prefix
across everything the player inherits — that's the "highest prefix" the
server owner asked for, no extra ranking logic needed on top.

### A real risk, worth saying out loud

Exact-string matching against a formatted prefix is more fragile than a
permission check: if anyone edits a rank's prefix in LuckPerms later (even
adding a trailing space, or switching `&` codes for `§` or MiniMessage), that
rank silently stops being detected — `matchPrefix` returns `null` (reads as
"no rank") rather than an error anyone would notice. `equalsIgnoreCase` above
at least tolerates case differences, but not formatting drift. Flag this to
the server owner in your final message; it's their explicit tradeoff to
make, not yours to silently work around.

## Please do not

- Do not change `setRankSync` / the rank-upgrade flow — it still adds/removes
  **groups**, unchanged.
- Do not add a ladder entry for the default `&7&lplayer&r` prefix — an
  unmatched prefix already correctly returns `null` ("no rank"), matching the
  existing rule of never inventing a default rank.
- Do not rename anything in the HTTP API contract — `/player/verify`,
  `/player/{uuid}/profile` and `/ranks` all keep returning the same
  `{id, displayName, weight}` shape for `rank`/`nextRank`; only how the
  plugin decides *which* `RankInfo` that is changes.

## When you're done, state in your final message

1. Confirmation `setRankSync` was not touched.
2. Confirmation an unmatched prefix (including the default player one)
   returns `null`, not an error and not a guessed rank.
3. Which Vault method you used for the prefix lookup and why it matches this
   codebase's existing Vault API version.
