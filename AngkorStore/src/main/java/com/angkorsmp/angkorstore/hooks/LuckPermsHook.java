package com.angkorsmp.angkorstore.hooks;

import com.angkorsmp.angkorstore.config.PluginConfig;
import com.angkorsmp.angkorstore.config.RankInfo;
import net.luckperms.api.LuckPerms;
import net.luckperms.api.LuckPermsProvider;
import net.luckperms.api.model.user.User;
import net.luckperms.api.model.user.UserManager;
import net.luckperms.api.node.NodeType;
import net.luckperms.api.node.types.InheritanceNode;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;
import java.util.logging.Logger;

/**
 * Reads and writes rank *group membership* through the LuckPerms API.
 *
 * Every method here runs off LuckPerms' own async executor, never the
 * Bukkit main thread — the LuckPerms API is documented safe to call from
 * any thread, and a storage-backed lookup (offline player, remote DB) can
 * be slow enough that blocking the main thread on it would show up as a
 * server hang.
 *
 * Only the *configured ladder groups* are ever read or written here: every
 * other group a player holds (default, staff, merchant, monarch, ...) is
 * invisible to this class and to the website by construction.
 */
public final class LuckPermsHook {

    private final JavaPlugin plugin;
    private final PluginConfig config;
    private final Logger log;
    private LuckPerms api;

    public LuckPermsHook(JavaPlugin plugin, PluginConfig config) {
        this.plugin = plugin;
        this.config = config;
        this.log = plugin.getLogger();
    }

    public void hook() {
        if (plugin.getServer().getPluginManager().getPlugin("LuckPerms") == null) {
            log.warning("[AngkorStore] LuckPerms not installed; rank detection falls back to console commands only.");
            return;
        }
        try {
            api = LuckPermsProvider.get();
            log.info("[AngkorStore] Hooked LuckPerms.");
        } catch (Throwable t) {
            log.warning("[AngkorStore] LuckPerms plugin found but its API isn't available yet: " + t.getMessage());
        }
    }

    public boolean available() {
        return api != null;
    }

    /** Every configured ladder rank this player directly holds, ascending by weight. Never blocks the caller. */
    public CompletableFuture<List<RankInfo>> heldRanks(UUID uuid) {
        if (api == null) return CompletableFuture.completedFuture(List.of());
        return withUser(uuid, user -> {
            List<RankInfo> held = new ArrayList<>();
            for (var node : user.getNodes(NodeType.INHERITANCE)) {
                RankInfo rank = config.rankByGroup(node.getGroupName());
                if (rank != null) held.add(rank);
            }
            held.sort((a, b) -> Integer.compare(a.weight(), b.weight()));
            return held;
        });
    }

    /** Adds one ladder group. Idempotent — adding a group the player already has is a no-op. */
    public CompletableFuture<Void> addGroup(UUID uuid, String group) {
        if (api == null) return CompletableFuture.failedFuture(new IllegalStateException("LuckPerms not hooked"));
        return withUserVoid(uuid, user -> user.data().add(InheritanceNode.builder(group).build()));
    }

    /** Removes one ladder group. A no-op if the player doesn't hold it. */
    public CompletableFuture<Void> removeGroup(UUID uuid, String group) {
        if (api == null) return CompletableFuture.failedFuture(new IllegalStateException("LuckPerms not hooked"));
        return withUserVoid(uuid, user -> user.data().remove(InheritanceNode.builder(group).build()));
    }

    private <T> CompletableFuture<T> withUser(UUID uuid, java.util.function.Function<User, T> fn) {
        UserManager um = api.getUserManager();
        User cached = um.getUser(uuid);
        if (cached != null) return CompletableFuture.completedFuture(fn.apply(cached));
        return um.loadUser(uuid).thenApply(user -> {
            try {
                return fn.apply(user);
            } finally {
                um.cleanupUser(user); // we loaded it ourselves (cached was null) - don't leave it cached forever
            }
        });
    }

    private CompletableFuture<Void> withUserVoid(UUID uuid, java.util.function.Consumer<User> fn) {
        UserManager um = api.getUserManager();
        boolean wasLoaded = um.getUser(uuid) != null;
        return um.loadUser(uuid).thenCompose(user -> {
            fn.accept(user);
            return um.saveUser(user).thenRun(() -> {
                if (!wasLoaded) um.cleanupUser(user);
            });
        });
    }
}
