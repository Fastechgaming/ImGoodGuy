package com.angkorsmp.angkorstore.api;

import com.angkorsmp.angkorstore.config.PluginConfig;
import com.angkorsmp.angkorstore.config.RankInfo;
import com.angkorsmp.angkorstore.hooks.LiteBansHook;
import com.angkorsmp.angkorstore.hooks.LuckPermsHook;
import com.angkorsmp.angkorstore.hooks.VaultHook;
import com.angkorsmp.angkorstore.http.ApiException;
import com.angkorsmp.angkorstore.player.PlayerLookup;
import com.angkorsmp.angkorstore.store.PendingDeliveries;
import com.angkorsmp.angkorstore.store.PendingDelivery;
import com.angkorsmp.angkorstore.store.TransactionStore;
import com.angkorsmp.angkorstore.util.MainThread;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import org.bukkit.ChatColor;
import org.bukkit.OfflinePlayer;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.logging.Logger;

/**
 * Everything the HTTP layer needs, one call per endpoint. Every method here
 * is safe to call from an HTTP worker thread: any Bukkit/Vault touch hops to
 * the main thread via MainThread, any LuckPerms touch runs on LuckPerms' own
 * executor - nothing here ever blocks the server's main thread.
 */
public final class AngkorStoreApi {

    private final JavaPlugin plugin;
    private final Logger log;
    private final PluginConfig config;
    private final VaultHook vault;
    private final LuckPermsHook luckPerms;
    private final LiteBansHook litebans;
    private final PlayerLookup names;
    private final TransactionStore transactions;
    private final PendingDeliveries pending;

    public AngkorStoreApi(JavaPlugin plugin, PluginConfig config, VaultHook vault, LuckPermsHook luckPerms,
                           LiteBansHook litebans, PlayerLookup names, TransactionStore transactions,
                           PendingDeliveries pending) {
        this.plugin = plugin;
        this.log = plugin.getLogger();
        this.config = config;
        this.vault = vault;
        this.luckPerms = luckPerms;
        this.litebans = litebans;
        this.names = names;
        this.transactions = transactions;
        this.pending = pending;
    }

    /* ------------------------------- health / server ------------------------------- */

    public JsonObject health() {
        JsonObject json = new JsonObject();
        json.addProperty("ok", true);
        json.addProperty("plugin", "AngkorStore");
        json.addProperty("version", plugin.getPluginMeta().getVersion());
        json.addProperty("serverVersion", plugin.getServer().getVersion());
        return json;
    }

    public CompletableFuture<JsonObject> server() {
        return MainThread.supply(plugin, () -> {
            JsonObject json = new JsonObject();
            json.addProperty("ok", true);
            json.addProperty("serverName", plugin.getServer().getName());
            json.addProperty("online", plugin.getServer().getOnlinePlayers().size());
            json.addProperty("max", plugin.getServer().getMaxPlayers());
            json.addProperty("bedrockPrefix", config.bedrockPrefix);
            json.addProperty("economy", vault.available() ? vault.providerName() : null);
            json.addProperty("permissions", luckPerms.available() ? "LuckPerms" : null);
            JsonObject features = new JsonObject();
            features.addProperty("coins", vault.available());
            features.addProperty("ranks", luckPerms.available());
            json.add("features", features);
            return json;
        });
    }

    /* ------------------------------- player identity ------------------------------- */

    public CompletableFuture<JsonObject> verifyPlayer(JsonObject body) {
        String rawName = str(body, "name", "");
        String edition = "bedrock".equals(str(body, "edition", "java")) ? "bedrock" : "java";
        String normalized = names.normalize(rawName, edition);
        if (normalized.isEmpty() || !names.isValid(normalized, edition)) {
            throw new ApiException(400, "BAD_NAME", "That name doesn't look valid.");
        }

        return names.resolve(normalized).thenCompose(found -> {
            if (found.isEmpty()) {
                JsonObject json = new JsonObject();
                json.addProperty("ok", true);
                json.addProperty("found", false);
                json.addProperty("name", normalized);
                json.addProperty("reason", "NEVER_JOINED");
                return CompletableFuture.completedFuture(json);
            }
            OfflinePlayer player = found.get();
            return profileFields(player).thenApply(fields -> {
                JsonObject json = new JsonObject();
                json.addProperty("ok", true);
                json.addProperty("found", true);
                json.addProperty("hasPlayedBefore", true);
                json.addProperty("edition", edition);
                for (var entry : fields.entrySet()) json.add(entry.getKey(), entry.getValue());
                return json;
            });
        });
    }

    public CompletableFuture<JsonObject> profile(String uuidStr) {
        UUID uuid = parseUuid(uuidStr);
        return names.resolveByUuid(uuid).thenCompose(found -> {
            if (found.isEmpty()) throw new ApiException(404, "NOT_FOUND", "No player with that UUID has joined.");
            return profileFields(found.get()).thenApply(fields -> {
                JsonObject json = new JsonObject();
                json.addProperty("ok", true);
                for (var entry : fields.entrySet()) json.add(entry.getKey(), entry.getValue());
                return json;
            });
        });
    }

    /** uuid, name, online, coins, rank, nextRank, ranks - shared by /player/verify and /player/{uuid}/profile. */
    private CompletableFuture<JsonObject> profileFields(OfflinePlayer player) {
        CompletableFuture<Long> coinsFuture = MainThread.supply(plugin, () -> vault.available() ? vault.getBalance(player) : null);
        CompletableFuture<List<RankInfo>> ranksFuture = luckPerms.heldRanks(player.getUniqueId());
        CompletableFuture<Boolean> onlineFuture = MainThread.supply(plugin, player::isOnline);

        return CompletableFuture.allOf(coinsFuture, ranksFuture, onlineFuture).thenApply(v -> {
            JsonObject json = new JsonObject();
            json.addProperty("uuid", player.getUniqueId().toString());
            json.addProperty("name", player.getName());
            json.addProperty("online", onlineFuture.join());
            Long coins = coinsFuture.join();
            if (coins != null) json.addProperty("coins", coins);
            else json.add("coins", com.google.gson.JsonNull.INSTANCE);

            List<RankInfo> held = ranksFuture.join();
            RankInfo highest = held.isEmpty() ? null : held.get(held.size() - 1);
            json.add("rank", highest == null ? com.google.gson.JsonNull.INSTANCE : rankJson(highest));
            RankInfo next = config.nextAbove(highest);
            json.add("nextRank", next == null ? com.google.gson.JsonNull.INSTANCE : rankJson(next));
            JsonArray ranksArray = new JsonArray();
            for (RankInfo r : held) ranksArray.add(rankJson(r));
            json.add("ranks", ranksArray);
            return json;
        });
    }

    public JsonObject ranks() {
        JsonArray array = new JsonArray();
        for (RankInfo r : config.ladder) {
            JsonObject json = rankJson(r);
            json.addProperty("group", r.group());
            json.addProperty("priceUsd", r.priceUsd());
            array.add(json);
        }
        JsonObject json = new JsonObject();
        json.addProperty("ok", true);
        json.add("ranks", array);
        return json;
    }

    private static JsonObject rankJson(RankInfo r) {
        JsonObject json = new JsonObject();
        json.addProperty("id", r.id());
        json.addProperty("displayName", r.displayName());
        json.addProperty("weight", r.weight());
        return json;
    }

    /* ------------------------------- coins/grant ------------------------------- */

    public CompletableFuture<JsonObject> grantCoins(JsonObject body) {
        String transactionId = requireStr(body, "transactionId");
        JsonObject stored = transactions.get(transactionId);
        if (stored != null) return CompletableFuture.completedFuture(duplicateOf(stored));

        if (!vault.available()) throw new ApiException(503, "NO_ECONOMY", "No economy plugin is hooked to Vault.");
        long amount = requireAmount(body);
        if (amount > config.maxGrantPerTransaction) {
            throw new ApiException(400, "AMOUNT_TOO_LARGE", "Amount exceeds max-grant-per-transaction (" + config.maxGrantPerTransaction + ").");
        }
        String reason = str(body, "reason", "the website");

        return resolvePlayerFromBody(body).thenCompose(player -> MainThread.supply(plugin, () -> {
            long before = vault.getBalance(player);
            String command = fill(config.giveCommand, player.getName(), player.getUniqueId(), amount);
            plugin.getServer().dispatchCommand(plugin.getServer().getConsoleSender(), command);
            long after = vault.getBalance(player);

            if (config.notifyOnlinePlayers && player.isOnline()) {
                Player online = player.getPlayer();
                if (online != null) {
                    String msg = config.coinMessage.replace("{amount}", String.valueOf(amount)).replace("{reason}", reason);
                    online.sendMessage(ChatColor.translateAlternateColorCodes('&', msg));
                }
            }

            JsonObject result = new JsonObject();
            result.addProperty("ok", true);
            result.addProperty("transactionId", transactionId);
            result.addProperty("applied", true);
            result.addProperty("duplicate", false);
            result.addProperty("balanceBefore", before);
            result.addProperty("balanceAfter", after);
            transactions.put(transactionId, result);
            logTransaction("GRANT " + amount + " -> " + player.getName() + " (" + reason + ") tx=" + transactionId);
            return result;
        }));
    }

    /* ------------------------------- purchase/deliver ------------------------------- */

    public CompletableFuture<JsonObject> deliverPurchase(JsonObject body) {
        String transactionId = requireStr(body, "transactionId");
        JsonObject stored = transactions.get(transactionId);
        if (stored != null) return CompletableFuture.completedFuture(duplicateOf(stored));

        String itemId = str(body, "itemId", "");
        String itemName = str(body, "itemName", "");
        boolean requiresOnline = body.has("requiresOnline") && body.get("requiresOnline").getAsBoolean();
        List<String> commands = new java.util.ArrayList<>();
        if (body.has("commands")) for (JsonElement e : body.getAsJsonArray("commands")) commands.add(e.getAsString());

        return resolvePlayerFromBody(body).thenCompose(player -> MainThread.supply(plugin, () -> {
            if (requiresOnline && !player.isOnline()) {
                pending.add(new PendingDelivery(transactionId, player.getUniqueId().toString(), player.getName(), itemId, itemName, commands));
                JsonObject result = new JsonObject();
                result.addProperty("ok", true);
                result.addProperty("transactionId", transactionId);
                result.addProperty("applied", false);
                result.addProperty("queued", true);
                result.add("results", new JsonArray());
                transactions.put(transactionId, result);
                logTransaction("DELIVER queued (" + itemName + ") -> " + player.getName() + " tx=" + transactionId);
                return result;
            }

            JsonArray results = runCommands(commands, player);
            JsonObject result = new JsonObject();
            result.addProperty("ok", true);
            result.addProperty("transactionId", transactionId);
            result.addProperty("applied", true);
            result.addProperty("queued", false);
            result.add("results", results);
            transactions.put(transactionId, result);
            logTransaction("DELIVER (" + itemName + ") -> " + player.getName() + " tx=" + transactionId);
            return result;
        }));
    }

    /** Runs queued deliveries for a player who just joined. Called from the join listener, already on the main thread. */
    public void runPendingFor(Player player) {
        for (PendingDelivery d : pending.forPlayer(player.getUniqueId())) {
            JsonArray results = runCommands(d.commands(), player);
            JsonObject result = new JsonObject();
            result.addProperty("ok", true);
            result.addProperty("transactionId", d.transactionId());
            result.addProperty("applied", true);
            result.addProperty("queued", false);
            result.add("results", results);
            transactions.put(d.transactionId(), result);
            pending.remove(d.transactionId());
            logTransaction("DELIVER (queued, now online: " + d.itemName() + ") -> " + player.getName() + " tx=" + d.transactionId());
        }
    }

    /** Must be called on the main thread. */
    private JsonArray runCommands(List<String> templates, OfflinePlayer player) {
        JsonArray results = new JsonArray();
        for (String template : templates) {
            String command = template.replace("{player}", player.getName())
                    .replace("{uuid}", player.getUniqueId().toString());
            boolean ok;
            try {
                ok = plugin.getServer().dispatchCommand(plugin.getServer().getConsoleSender(), command);
            } catch (Throwable t) {
                log.warning("[AngkorStore] Command failed: " + command + " (" + t.getMessage() + ")");
                ok = false;
            }
            JsonObject entry = new JsonObject();
            entry.addProperty("command", command);
            entry.addProperty("ok", ok);
            results.add(entry);
        }
        return results;
    }

    /* ------------------------------- rank/upgrade ------------------------------- */

    public CompletableFuture<JsonObject> upgradeRank(JsonObject body) {
        String transactionId = requireStr(body, "transactionId");
        JsonObject stored = transactions.get(transactionId);
        if (stored != null) return CompletableFuture.completedFuture(duplicateOf(stored));

        if (!luckPerms.available()) throw new ApiException(503, "NO_RANKS", "LuckPerms is not hooked.");
        String toRankId = requireStr(body, "toRankId");
        RankInfo toRank = config.rankById(toRankId);
        if (toRank == null) throw new ApiException(400, "BAD_RANK", "Unknown rank id: " + toRankId);
        String expectedFromRankId = body.has("expectedFromRankId") && !body.get("expectedFromRankId").isJsonNull()
                ? body.get("expectedFromRankId").getAsString() : null;

        return resolvePlayerFromBody(body).thenCompose(player ->
                luckPerms.heldRanks(player.getUniqueId()).thenCompose(held -> {
                    RankInfo highest = held.isEmpty() ? null : held.get(held.size() - 1);
                    String currentId = highest == null ? null : highest.id();
                    if (expectedFromRankId != null && !expectedFromRankId.equals(currentId)) {
                        JsonObject extra = new JsonObject();
                        extra.add("currentRank", highest == null ? com.google.gson.JsonNull.INSTANCE : rankJson(highest));
                        throw new ApiException(409, "RANK_CHANGED", "Player's current rank no longer matches expectedFromRankId.", extra);
                    }

                    CompletableFuture<Void> removeOld = highest != null
                            ? luckPerms.removeGroup(player.getUniqueId(), highest.group())
                            : CompletableFuture.completedFuture(null);
                    return removeOld
                            .thenCompose(v -> luckPerms.addGroup(player.getUniqueId(), toRank.group()))
                            .thenCompose(v -> profileFields(player))
                            .thenApply(profile -> {
                                JsonObject result = new JsonObject();
                                result.addProperty("ok", true);
                                result.addProperty("transactionId", transactionId);
                                result.addProperty("applied", true);
                                result.addProperty("duplicate", false);
                                result.add("profile", profile);
                                transactions.put(transactionId, result);
                                logTransaction("UPGRADE " + (currentId == null ? "none" : currentId) + " -> " + toRankId
                                        + " for " + player.getName() + " tx=" + transactionId);
                                return result;
                            });
                }));
    }

    /* ------------------------------- bans ------------------------------- */

    /**
     * Currently-active LiteBans bans for the website's "Banned Players"
     * page. litebans.activeBans() is blocking file I/O, safe to run
     * directly here since this whole class only ever runs on the HTTP
     * worker pool (see http.ApiServer) - never the server's main thread.
     * Only the player-name lookup afterwards needs a MainThread hop.
     */
    public CompletableFuture<JsonObject> bans() {
        if (!litebans.available()) {
            JsonObject json = new JsonObject();
            json.addProperty("ok", true);
            json.addProperty("available", false);
            json.add("bans", new JsonArray());
            return CompletableFuture.completedFuture(json);
        }
        List<LiteBansHook.BanEntry> entries = litebans.activeBans(config.litebansMaxResults);
        return MainThread.supply(plugin, () -> {
            JsonArray array = new JsonArray();
            for (LiteBansHook.BanEntry entry : entries) {
                OfflinePlayer player = plugin.getServer().getOfflinePlayer(entry.uuid());
                String playerName = player.getName();
                JsonObject ban = new JsonObject();
                ban.addProperty("player", playerName != null ? playerName : entry.uuid().toString());
                ban.addProperty("uuid", entry.uuid().toString());
                ban.addProperty("reason", entry.reason());
                ban.addProperty("bannedBy", entry.bannedByName());
                ban.addProperty("bannedAt", entry.time());
                if (entry.permanent()) ban.add("expiresAt", com.google.gson.JsonNull.INSTANCE);
                else ban.addProperty("expiresAt", entry.until());
                array.add(ban);
            }
            JsonObject json = new JsonObject();
            json.addProperty("ok", true);
            json.addProperty("available", true);
            json.add("bans", array);
            return json;
        });
    }

    /* ------------------------------- shared helpers ------------------------------- */

    private CompletableFuture<OfflinePlayer> resolvePlayerFromBody(JsonObject body) {
        if (body.has("uuid") && !body.get("uuid").isJsonNull() && !body.get("uuid").getAsString().isBlank()) {
            UUID uuid = parseUuid(body.get("uuid").getAsString());
            return names.resolveByUuid(uuid).thenApply(found ->
                    found.orElseThrow(() -> new ApiException(404, "NOT_FOUND", "No player with that UUID has joined.")));
        }
        String name = str(body, "name", "");
        String edition = "bedrock".equals(str(body, "edition", "java")) ? "bedrock" : "java";
        String normalized = names.normalize(name, edition);
        return names.resolve(normalized).thenApply(found ->
                found.orElseThrow(() -> new ApiException(404, "NOT_FOUND", "That name has never joined.")));
    }

    private static JsonObject duplicateOf(JsonObject original) {
        JsonObject copy = original.deepCopy();
        copy.addProperty("duplicate", true);
        copy.addProperty("applied", false);
        return copy;
    }

    private static String fill(String template, String player, UUID uuid, long amount) {
        return template.replace("{player}", player).replace("{uuid}", uuid.toString()).replace("{amount}", String.valueOf(amount));
    }

    private static UUID parseUuid(String raw) {
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            throw new ApiException(400, "BAD_UUID", "Not a valid UUID: " + raw);
        }
    }

    private static long requireAmount(JsonObject body) {
        if (!body.has("amount") || !body.get("amount").isJsonPrimitive()) {
            throw new ApiException(400, "BAD_AMOUNT", "amount must be a positive integer.");
        }
        double raw = body.get("amount").getAsDouble();
        if (raw <= 0 || raw != Math.floor(raw)) throw new ApiException(400, "BAD_AMOUNT", "amount must be a positive integer.");
        return (long) raw;
    }

    private static String requireStr(JsonObject body, String field) {
        if (!body.has(field) || body.get(field).isJsonNull() || body.get(field).getAsString().isBlank()) {
            throw new ApiException(400, "MISSING_FIELD", field + " is required.");
        }
        return body.get(field).getAsString();
    }

    private static String str(JsonObject body, String field, String fallback) {
        return body.has(field) && !body.get(field).isJsonNull() ? body.get(field).getAsString() : fallback;
    }

    private void logTransaction(String line) {
        if (!config.logTransactions) return;
        try {
            var dir = plugin.getDataFolder().toPath();
            Files.createDirectories(dir);
            try (FileWriter writer = new FileWriter(dir.resolve("transactions.log").toFile(), true)) {
                writer.write(Instant.now() + " " + line + System.lineSeparator());
            }
        } catch (IOException e) {
            log.warning("[AngkorStore] Could not write transactions.log: " + e.getMessage());
        }
    }
}
