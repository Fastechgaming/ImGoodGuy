package com.angkorsmp.angkorstore;

import com.angkorsmp.angkorstore.api.AngkorStoreApi;
import com.angkorsmp.angkorstore.commands.AngkorStoreCommand;
import com.angkorsmp.angkorstore.config.PluginConfig;
import com.angkorsmp.angkorstore.hooks.LiteBansHook;
import com.angkorsmp.angkorstore.hooks.LuckPermsHook;
import com.angkorsmp.angkorstore.hooks.VaultHook;
import com.angkorsmp.angkorstore.http.ApiServer;
import com.angkorsmp.angkorstore.listeners.JoinListener;
import com.angkorsmp.angkorstore.player.PlayerLookup;
import com.angkorsmp.angkorstore.store.PendingDeliveries;
import com.angkorsmp.angkorstore.store.TransactionStore;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.IOException;

public final class AngkorStorePlugin extends JavaPlugin {

    private PluginConfig config;
    private VaultHook vaultHook;
    private LuckPermsHook luckPermsHook;
    private LiteBansHook liteBansHook;
    private TransactionStore transactionStore;
    private PendingDeliveries pendingDeliveries;
    private AngkorStoreApi api;
    private ApiServer apiServer;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        boot();
        getServer().getPluginManager().registerEvents(new JoinListener(this, api), this);
        var executor = new AngkorStoreCommand(this);
        getCommand("angkorstore").setExecutor(executor);
        getCommand("angkorstore").setTabCompleter(executor);
    }

    /** Builds (or rebuilds, on reload) everything from the current config.yml. */
    public void boot() {
        reloadConfig();
        this.config = new PluginConfig(getConfig());

        if (apiServer != null) apiServer.stop();

        this.vaultHook = new VaultHook(this);
        this.luckPermsHook = new LuckPermsHook(this, config);
        this.liteBansHook = new LiteBansHook(this, config);
        vaultHook.hook();
        luckPermsHook.hook();

        PlayerLookup lookup = new PlayerLookup(this, config);
        this.transactionStore = new TransactionStore(getDataFolder(), getLogger());
        this.pendingDeliveries = new PendingDeliveries(getDataFolder(), getLogger());
        this.api = new AngkorStoreApi(this, config, vaultHook, luckPermsHook, liteBansHook, lookup, transactionStore, pendingDeliveries);

        if (config.secret.isBlank() || "CHANGE-ME".equals(config.secret)) {
            getLogger().severe("[AngkorStore] api.secret is not set in config.yml - the website cannot be trusted to talk to this "
                    + "plugin until you set a real secret and restart.");
        }

        if (!config.apiEnabled) {
            getLogger().warning("[AngkorStore] api.enabled is false - the website bridge is off.");
            return;
        }
        this.apiServer = new ApiServer(this, config, api);
        try {
            apiServer.start();
        } catch (IOException e) {
            getLogger().severe("[AngkorStore] Could not bind the API port (" + config.port + "): " + e.getMessage()
                    + " - the website bridge is down but the server itself is unaffected.");
            apiServer = null;
        }
    }

    @Override
    public void onDisable() {
        if (apiServer != null) apiServer.stop();
    }

    public PluginConfig config() {
        return config;
    }

    public VaultHook vaultHook() {
        return vaultHook;
    }

    public LuckPermsHook luckPermsHook() {
        return luckPermsHook;
    }

    public LiteBansHook liteBansHook() {
        return liteBansHook;
    }

    public AngkorStoreApi api() {
        return api;
    }

    public boolean apiRunning() {
        return apiServer != null;
    }

    public PendingDeliveries pendingDeliveries() {
        return pendingDeliveries;
    }
}
