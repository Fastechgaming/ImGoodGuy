package com.angkorsmp.angkorstore.hooks;

import com.angkorsmp.angkorstore.config.PluginConfig;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.logging.Logger;

/**
 * Reads LiteBans' own SQLite database directly for the website's "Banned
 * Players" page. LiteBans has no runtime Java API for listing punishments
 * (its public API only fires events on new ones), so reading its own
 * database is the integration method LiteBans' own wiki recommends for
 * external tools like this.
 *
 * Read-only, one short-lived connection per query - never a long-held
 * handle, so a LiteBans compaction/rotation of the file can never leave
 * this holding a stale one. Runs on whatever thread calls it (the HTTP
 * worker pool - see http.ApiServer); it never touches Bukkit, so unlike
 * everything else that reaches into the server it does NOT need
 * util.MainThread.
 *
 * The SQLite JDBC driver isn't on the server's classpath by default
 * (unlike LuckPerms/Vault, whose APIs their own plugins provide) -
 * build.gradle shades org.xerial:sqlite-jdbc into this jar for exactly
 * this class.
 */
public final class LiteBansHook {

    public record BanEntry(UUID uuid, String reason, String bannedByName, long time, long until) {
        /** LiteBans' own convention: until <= 0 means no expiry. */
        public boolean permanent() {
            return until <= 0;
        }
    }

    private final Logger log;
    private final PluginConfig config;
    private final File databaseFile;
    private volatile boolean driverChecked;
    private volatile boolean driverAvailable;

    public LiteBansHook(JavaPlugin plugin, PluginConfig config) {
        this.log = plugin.getLogger();
        this.config = config;
        this.databaseFile = resolvePath(plugin, config.litebansDatabasePath);
    }

    private static File resolvePath(JavaPlugin plugin, String configured) {
        File f = new File(configured);
        if (f.isAbsolute()) return f;
        // A relative path in config.yml is relative to the server's root
        // folder (the one "plugins/" lives in), matching both LiteBans'
        // own default and how the setting is documented in config.yml -
        // not this plugin's own data folder.
        return new File(plugin.getServer().getWorldContainer(), configured);
    }

    public boolean available() {
        if (!config.litebansEnabled) return false;
        if (!databaseFile.exists()) return false;
        return ensureDriver();
    }

    private boolean ensureDriver() {
        if (driverChecked) return driverAvailable;
        synchronized (this) {
            if (driverChecked) return driverAvailable;
            try {
                Class.forName("org.sqlite.JDBC");
                driverAvailable = true;
            } catch (ClassNotFoundException e) {
                log.warning("[AngkorStore] SQLite JDBC driver not found - the banned-players list is disabled. "
                        + "This should be bundled in the plugin jar; if you built it yourself, make sure you ran "
                        + "'./gradlew shadowJar' (not just 'build').");
                driverAvailable = false;
            }
            driverChecked = true;
            return driverAvailable;
        }
    }

    /** Currently-active bans, most recent first. Blocking (file I/O). */
    public List<BanEntry> activeBans(int limit) {
        List<BanEntry> results = new ArrayList<>();
        if (!available()) return results;

        // The plain "jdbc:sqlite:<path>?mode=ro" form doesn't parse "?mode=ro"
        // as a query parameter at all - it's taken as part of the literal
        // filename, silently creating a stray "<name>?mode=ro" file next to
        // the real one and connecting to that empty database instead
        // (confirmed against a real sqlite-jdbc build while writing this).
        // The "file:" URI form is required for the mode parameter to work.
        String url = "jdbc:sqlite:file:" + databaseFile.getAbsolutePath().replace('\\', '/') + "?mode=ro";
        String sql = "SELECT uuid, reason, banned_by_name, time, until FROM " + config.litebansTablePrefix
                + "bans WHERE active = 1 AND (until = -1 OR until > ?) ORDER BY time DESC LIMIT ?";

        try (Connection conn = DriverManager.getConnection(url)) {
            // A LiteBans write mid-read shouldn't fail this query outright -
            // wait briefly for the lock instead of erroring immediately.
            try (Statement pragma = conn.createStatement()) {
                pragma.execute("PRAGMA busy_timeout = 3000");
            }
            try (PreparedStatement stmt = conn.prepareStatement(sql)) {
                stmt.setLong(1, System.currentTimeMillis());
                stmt.setInt(2, Math.max(1, limit));
                try (ResultSet rs = stmt.executeQuery()) {
                    while (rs.next()) {
                        UUID uuid = parseUuid(rs.getString("uuid"));
                        if (uuid == null) continue; // malformed/legacy row - skip rather than fail the whole list
                        results.add(new BanEntry(
                                uuid,
                                rs.getString("reason"),
                                rs.getString("banned_by_name"),
                                rs.getLong("time"),
                                rs.getLong("until")
                        ));
                    }
                }
            }
        } catch (Exception e) {
            log.warning("[AngkorStore] Could not read LiteBans database: " + e.getMessage());
        }
        return results;
    }

    private static UUID parseUuid(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            // Some imports store UUIDs without dashes (32 hex chars) - try that shape too.
            if (raw.length() == 32) {
                try {
                    return UUID.fromString(raw.replaceFirst(
                            "(\\w{8})(\\w{4})(\\w{4})(\\w{4})(\\w{12})", "$1-$2-$3-$4-$5"));
                } catch (IllegalArgumentException ignored) {
                    return null;
                }
            }
            return null;
        }
    }
}
