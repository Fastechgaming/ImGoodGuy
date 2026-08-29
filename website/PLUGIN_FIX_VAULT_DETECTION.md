# Prompt: fix "Vault absent or unavailable" firing with Vault actually installed and in use

> Copy everything below the line into the AI working on the AngkorLink plugin
> source (`AngkorLink-final/`). It already has full context of this codebase.

---

## The bug

On startup the console logs:

```
[AngkorLink] Vault absent or unavailable; economy and Vault permissions disabled.
```

The server owner confirms Vault is installed and is the plugin actively
providing the server's economy — so the underlying capability is there, but
AngkorLink's own detection is failing to see it. Since Vault fix #6 in
`PLUGIN_FIXES.md` already wrapped every Vault reference behind a check for
"is Vault present" so the plugin never hard-crashes when it's missing, this
is that same detection path returning false negative when Vault **is**
present. Find and fix the actual cause; do not just soften or remove the log
message.

## Most likely causes, check in this order

1. **Missing/misspelled `softdepend` in `plugin.yml`.** If AngkorLink doesn't
   declare `softdepend: [Vault, LuckPerms, floodgate]` (or has the plugin
   name spelled/cased wrong — Bukkit plugin names are case-sensitive), Bukkit
   has no load-order guarantee and may enable AngkorLink before Vault has
   registered anything, even though Vault is installed. Confirm the exact
   entry exists and matches Vault's real registered name.

2. **Checking `getPlugin("Vault") != null` instead of resolving the actual
   `Economy` service.** A present-but-not-yet-hooked Vault jar (before an
   economy plugin like EssentialsX registers behind it) will pass a plugin
   presence check but still have no `Economy` provider. The correct check is
   `Bukkit.getServicesManager().getRegistration(Economy.class)` returning
   non-null — that's what actually means "usable," not just "installed."

3. **Doing the check too early.** Even with `softdepend` set correctly,
   `onEnable()` order guarantees Vault's own `onEnable()` ran first — it does
   **not** guarantee the economy plugin behind Vault (e.g. EssentialsX) has
   registered its `Economy` service yet, if that plugin loads after
   AngkorLink alphabetically or is itself soft-depending on something slow.
   If the check happens once, synchronously, inside AngkorLink's own
   `onEnable()`, a slow economy plugin can lose the race even when everything
   is configured correctly.

   **Fix:** don't give up after one failed lookup at enable time. Either:
   - Retry the `Economy` service lookup on a short delayed task (e.g. 1-2
     ticks or a few seconds later via `Bukkit.getScheduler()`), logging the
     "absent" warning only if it's still unavailable after the retry, or
   - Listen for `ServiceRegisterEvent` and pick up the `Economy` provider
     whenever it actually registers, instead of only checking once at boot.

4. **Log message fires from a stale/cached flag.** If there's a boolean like
   `vaultEnabled` set once during `setupHooks()` and never re-evaluated, a
   `/reload` or plugin re-enable without a full server restart can leave it
   stuck at whatever it resolved to the very first time, even after Vault
   becomes available. Re-run `setupHooks()` (or at least the Vault portion)
   on every enable, not just once ever.

## What NOT to do

- Don't remove the graceful-degradation behavior from fix #6 (the plugin
  must still start cleanly with Vault genuinely absent, per acceptance test
  #10 in `PLUGIN_PROMPT.md`).
- Don't change the `/player/verify`, `/player/{uuid}/profile` or `/ranks`
  response shapes — this is purely about correctly *detecting* Vault, not
  about how rank/coins are reported once detected.
- Don't touch `rankSync`/prefix-matching from `PLUGIN_FIX_RANK_DETECTION.md`
  — that's a separate, already-correct code path.

## When you're done, state in your final message

1. Which of the causes above (or another one you found) was actually
   responsible — quote the exact line(s).
2. Confirmation that with Vault genuinely absent, the plugin still starts
   cleanly and logs the same "absent" message (acceptance test #10 still
   holds).
3. Confirmation that with Vault present and hooked to a real economy plugin,
   the "absent or unavailable" message no longer appears, and `coins` /
   Vault permission checks work — ideally set `logging.debug: true` for one
   restart and paste the exact point where Vault detection now succeeds.
