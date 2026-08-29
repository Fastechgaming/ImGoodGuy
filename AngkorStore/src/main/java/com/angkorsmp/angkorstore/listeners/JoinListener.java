package com.angkorsmp.angkorstore.listeners;

import com.angkorsmp.angkorstore.api.AngkorStoreApi;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Runs any purchase that was queued because the player was offline when it was approved. */
public final class JoinListener implements Listener {

    private final JavaPlugin plugin;
    private final AngkorStoreApi api;

    public JoinListener(JavaPlugin plugin, AngkorStoreApi api) {
        this.plugin = plugin;
        this.api = api;
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        // Already on the main thread here; give the world a tick to settle before running commands.
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> api.runPendingFor(event.getPlayer()), 20L);
    }
}
