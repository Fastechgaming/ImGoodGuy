package com.angkorsmp.angkorstore.config;

import org.bukkit.configuration.file.FileConfiguration;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Everything read out of config.yml, snapshotted once per (re)load so a live reload never hands out half-updated state. */
public class PluginConfig {

    public final String bedrockPrefix;

    public final boolean apiEnabled;
    public final int port;
    public final String bind;
    public final String secret;
    public final List<String> allowedIps;

    public final String giveCommand;
    public final int maxGrantPerTransaction;
    public final boolean notifyOnlinePlayers;
    public final String coinMessage;

    public final List<RankInfo> ladder;         // ascending order
    public final String fallbackSetCommand;
    public final String fallbackRemoveCommand;

    public final boolean litebansEnabled;
    public final String litebansStorageType;     // "file" (H2/SQLite, auto-detected) or "mysql"
    public final String litebansDatabasePath;
    public final String litebansTablePrefix;
    public final int litebansMaxResults;
    public final String litebansMysqlHost;
    public final int litebansMysqlPort;
    public final String litebansMysqlDatabase;
    public final String litebansMysqlUsername;
    public final String litebansMysqlPassword;
    public final boolean litebansMysqlUseSsl;

    public final boolean logTransactions;
    public final boolean debug;

    public PluginConfig(FileConfiguration cfg) {
        this.bedrockPrefix = cfg.getString("player.bedrock-prefix", ".");

        this.apiEnabled = cfg.getBoolean("api.enabled", true);
        this.port = cfg.getInt("api.port", 8123);
        this.bind = cfg.getString("api.bind", "0.0.0.0");
        this.secret = cfg.getString("api.secret", "");
        this.allowedIps = List.copyOf(cfg.getStringList("api.allowed-ips"));

        this.giveCommand = cfg.getString("coins.give-command", "eco give coin {player} {amount}");
        this.maxGrantPerTransaction = cfg.getInt("coins.max-grant-per-transaction", 5000);
        this.notifyOnlinePlayers = cfg.getBoolean("coins.notify-online-players", true);
        this.coinMessage = cfg.getString("coins.message", "&e+{amount} Coins &7from &a{reason}&7 on the website");

        List<RankInfo> parsed = new ArrayList<>();
        for (var raw : cfg.getMapList("ranks.ladder")) {
            String id = String.valueOf(raw.get("id"));
            Object groupVal = raw.get("group");
            String group = groupVal != null ? String.valueOf(groupVal) : id;
            Object nameVal = raw.get("displayName");
            String displayName = nameVal != null ? String.valueOf(nameVal) : id;
            int weight = raw.get("weight") instanceof Number n ? n.intValue() : (parsed.size() + 1) * 10;
            double priceUsd = raw.get("priceUsd") instanceof Number n ? n.doubleValue() : 0;
            parsed.add(new RankInfo(id, group, displayName, weight, priceUsd));
        }
        parsed.sort((a, b) -> Integer.compare(a.weight(), b.weight()));
        this.ladder = Collections.unmodifiableList(parsed);
        this.fallbackSetCommand = cfg.getString("ranks.fallback-set-command", "lp user {player} parent add {group}");
        this.fallbackRemoveCommand = cfg.getString("ranks.fallback-remove-command", "lp user {player} parent remove {group}");

        this.litebansEnabled = cfg.getBoolean("litebans.enabled", true);
        this.litebansStorageType = cfg.getString("litebans.storage-type", "file");
        this.litebansDatabasePath = cfg.getString("litebans.database-path", "plugins/LiteBans/litebans.db");
        this.litebansTablePrefix = cfg.getString("litebans.table-prefix", "litebans_");
        this.litebansMaxResults = cfg.getInt("litebans.max-results", 200);
        this.litebansMysqlHost = cfg.getString("litebans.mysql.host", "localhost");
        this.litebansMysqlPort = cfg.getInt("litebans.mysql.port", 3306);
        this.litebansMysqlDatabase = cfg.getString("litebans.mysql.database", "litebans");
        this.litebansMysqlUsername = cfg.getString("litebans.mysql.username", "litebans");
        this.litebansMysqlPassword = cfg.getString("litebans.mysql.password", "");
        this.litebansMysqlUseSsl = cfg.getBoolean("litebans.mysql.use-ssl", false);

        this.logTransactions = cfg.getBoolean("logging.transactions", true);
        this.debug = cfg.getBoolean("logging.debug", false);
    }

    public RankInfo rankById(String id) {
        for (RankInfo r : ladder) if (r.id().equalsIgnoreCase(id)) return r;
        return null;
    }

    public RankInfo rankByGroup(String group) {
        for (RankInfo r : ladder) if (r.group().equalsIgnoreCase(group)) return r;
        return null;
    }

    public RankInfo nextAbove(RankInfo current) {
        if (current == null) return ladder.isEmpty() ? null : ladder.get(0);
        for (RankInfo r : ladder) if (r.weight() > current.weight()) return r;
        return null;
    }
}
