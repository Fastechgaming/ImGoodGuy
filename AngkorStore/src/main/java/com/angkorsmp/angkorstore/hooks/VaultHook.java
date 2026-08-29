package com.angkorsmp.angkorstore.hooks;

import net.milkbowl.vault.economy.Economy;
import org.bukkit.OfflinePlayer;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.server.ServiceRegisterEvent;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;

import java.util.logging.Logger;

/**
 * Reads/writes the server's real economy balance through Vault.
 *
 * Two things bit the previous plugin here, both fixed by this class:
 * checking "is the Vault plugin installed" instead of "has an Economy
 * actually registered" (a present-but-unhooked Vault has no provider yet),
 * and checking exactly once at enable time, which loses the race if the
 * economy plugin behind Vault registers a tick or two later. This hook
 * retries on the next tick and keeps listening for a late registration for
 * as long as none is found.
 */
public final class VaultHook implements Listener {

    private final JavaPlugin plugin;
    private final Logger log;
    private volatile Economy economy;

    public VaultHook(JavaPlugin plugin) {
        this.plugin = plugin;
        this.log = plugin.getLogger();
    }

    public void hook() {
        if (plugin.getServer().getPluginManager().getPlugin("Vault") == null) {
            log.warning("[AngkorStore] Vault not installed; coin balance/grant features disabled.");
            return;
        }
        plugin.getServer().getPluginManager().registerEvents(this, plugin);
        tryResolve();
        if (economy == null) {
            // Give the economy plugin behind Vault a couple of ticks to finish its
            // own onEnable and register, rather than giving up immediately.
            new BukkitRunnable() {
                @Override
                public void run() {
                    if (economy == null) tryResolve();
                }
            }.runTaskLater(plugin, 20L);
        }
    }

    private void tryResolve() {
        RegisteredServiceProvider<Economy> rsp = plugin.getServer().getServicesManager().getRegistration(Economy.class);
        if (rsp != null) {
            economy = rsp.getProvider();
            log.info("[AngkorStore] Hooked Vault economy: " + economy.getName());
        } else {
            log.warning("[AngkorStore] Vault is installed but no economy plugin has registered behind it yet.");
        }
    }

    @EventHandler
    public void onServiceRegister(ServiceRegisterEvent event) {
        if (economy != null) return;
        if (!Economy.class.isAssignableFrom(event.getProvider().getService())) return;
        tryResolve();
    }

    public boolean available() {
        return economy != null;
    }

    /** Vault balances are doubles; the website treats coins as whole integers everywhere, so floor it. */
    public long getBalance(OfflinePlayer player) {
        if (economy == null) return 0;
        return (long) Math.floor(economy.getBalance(player));
    }

    public String providerName() {
        return economy != null ? economy.getName() : null;
    }
}
