package com.angkorsmp.angkorstore.hooks;

import com.angkorsmp.angkorstore.config.PluginConfig;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
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
 * Reads LiteBans' own database directly for the website's "Banned Players"
 * page. LiteBans has no runtime Java API for listing punishments (its
 * public API only fires events on new ones), so reading its own database
 * is the integration method LiteBans' own wiki recommends for external
 * tools like this.
 *
 * Three storage shapes are handled. If `litebans.storage-type` is set to
 * "mysql" (matching LiteBans' own storage.type: MYSQL setting), this
 * connects straight to that database over the network - the cleanest
 * option where it's available: no local file, no locking, always live,
 * and it's the same schema (verified against LiteBans' own external-tool
 * ecosystem, e.g. the litebans-php project's queries - uuid/reason/
 * banned_by_name/time/until/active are plain columns, uuid stored as an
 * ordinary 36-character string, not raw bytes, on every backend LiteBans
 * supports) so the exact same query in queryBans() below works unchanged.
 *
 * Otherwise (the default, "file") this auto-detects from what's actually
 * on disk: H2 (a "*.mv.db" file - LiteBans' current default for a
 * standalone, non-networked server) and classic SQLite (a plain "*.db"
 * file - older LiteBans installs, or a server that switched storage-mode
 * by hand). Point litebans.database-path at whichever one you have; this
 * looks for both shapes next to it.
 *
 * The two file shapes need genuinely different handling, not just a
 * different JDBC URL: SQLite is a lock-file-based format explicitly
 * designed for a second, independent library instance to open the same
 * file read-only while another instance (LiteBans itself) has it open for
 * writing - so a direct "?mode=ro" connection to the live file works. H2's
 * embedded engine is not - a second, independent H2 instance (this one;
 * LiteBans almost certainly shades its own separate copy of H2, exactly
 * like this plugin does) opening the same *.mv.db file while another
 * instance has it open throws "Database may be already in use", even in
 * read-only mode - confirmed against a real two-process test while
 * writing this, including that H2's own AUTO_SERVER escape hatch doesn't
 * help here either (it needs the *original* connection to have opened
 * with AUTO_SERVER=TRUE, which LiteBans doesn't). The reliable fix, and
 * apparently the standard one for reading a live embedded H2 database from
 * a second process: copy the file first, then open an ordinary connection
 * against the copy - a plain filesystem copy of it is safe to read even
 * mid-write (also confirmed against a real running instance), so the copy
 * is always a valid, just possibly slightly-stale, snapshot.
 *
 * Runs on whatever thread calls it (the HTTP worker pool - see
 * http.ApiServer); neither path ever touches Bukkit, so unlike everything
 * else that reaches into the server this does NOT need util.MainThread.
 */
public final class LiteBansHook {

    public record BanEntry(UUID uuid, String reason, String bannedByName, long time, long until) {
        /** LiteBans' own convention: until <= 0 means no expiry. */
        public boolean permanent() {
            return until <= 0;
        }
    }

    private enum Kind { H2, SQLITE, MYSQL, NONE }

    private final JavaPlugin plugin;
    private final Logger log;
    private final PluginConfig config;
    private final File h2File;
    private final File sqliteFile;
    private volatile Boolean sqliteDriverAvailable;
    private volatile Boolean h2DriverAvailable;
    private volatile Boolean mysqlDriverAvailable;

    public LiteBansHook(JavaPlugin plugin, PluginConfig config) {
        this.plugin = plugin;
        this.log = plugin.getLogger();
        this.config = config;

        File configured = resolvePath(plugin, config.litebansDatabasePath);
        if (configured.getName().endsWith(".mv.db")) {
            this.h2File = configured;
            this.sqliteFile = siblingWithExtension(configured, ".mv.db", ".db");
        } else {
            this.sqliteFile = configured;
            this.h2File = siblingWithExtension(configured, ".db", ".mv.db");
        }
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

    private static File siblingWithExtension(File file, String stripSuffix, String addSuffix) {
        String name = file.getName();
        String base = name.endsWith(stripSuffix) ? name.substring(0, name.length() - stripSuffix.length()) : name;
        return new File(file.getParentFile(), base + addSuffix);
    }

    private Kind detect() {
        if (!config.litebansEnabled) return Kind.NONE;
        if ("mysql".equalsIgnoreCase(config.litebansStorageType)) return Kind.MYSQL;
        if (h2File.exists()) return Kind.H2;
        if (sqliteFile.exists()) return Kind.SQLITE;
        return Kind.NONE;
    }

    public boolean available() {
        return switch (detect()) {
            case H2 -> ensureH2Driver();
            case SQLITE -> ensureSqliteDriver();
            case MYSQL -> ensureMysqlDriver();
            case NONE -> false;
        };
    }

    private boolean ensureSqliteDriver() {
        if (sqliteDriverAvailable != null) return sqliteDriverAvailable;
        synchronized (this) {
            if (sqliteDriverAvailable != null) return sqliteDriverAvailable;
            sqliteDriverAvailable = tryLoadDriver("org.sqlite.JDBC", "SQLite");
            return sqliteDriverAvailable;
        }
    }

    private boolean ensureH2Driver() {
        if (h2DriverAvailable != null) return h2DriverAvailable;
        synchronized (this) {
            if (h2DriverAvailable != null) return h2DriverAvailable;
            h2DriverAvailable = tryLoadDriver("org.h2.Driver", "H2");
            return h2DriverAvailable;
        }
    }

    private boolean ensureMysqlDriver() {
        if (mysqlDriverAvailable != null) return mysqlDriverAvailable;
        synchronized (this) {
            if (mysqlDriverAvailable != null) return mysqlDriverAvailable;
            mysqlDriverAvailable = tryLoadDriver("org.mariadb.jdbc.Driver", "MySQL/MariaDB");
            return mysqlDriverAvailable;
        }
    }

    private boolean tryLoadDriver(String className, String label) {
        try {
            Class.forName(className);
            return true;
        } catch (ClassNotFoundException e) {
            log.warning("[AngkorStore] " + label + " JDBC driver not found - the banned-players list is disabled. "
                    + "This should be bundled in the plugin jar; if you built it yourself, make sure you ran "
                    + "'./gradlew build' (the Shadow plugin wires the shaded jar into it automatically).");
            return false;
        }
    }

    /** Currently-active bans, most recent first. Blocking (file I/O). */
    public List<BanEntry> activeBans(int limit) {
        Kind kind = detect();
        try {
            return switch (kind) {
                case SQLITE -> readSqlite(limit);
                case H2 -> readH2(limit);
                case MYSQL -> readMysql(limit);
                case NONE -> List.of();
            };
        } catch (Exception e) {
            log.warning("[AngkorStore] Could not read LiteBans database: " + e.getMessage());
            return List.of();
        }
    }

    private List<BanEntry> readSqlite(int limit) throws Exception {
        if (!ensureSqliteDriver()) return List.of();
        // The plain "jdbc:sqlite:<path>?mode=ro" form doesn't parse "?mode=ro"
        // as a query parameter at all - it's taken as part of the literal
        // filename, silently creating a stray "<name>?mode=ro" file next to
        // the real one and connecting to that empty database instead
        // (confirmed against a real sqlite-jdbc build while writing this).
        // The "file:" URI form is required for the mode parameter to work.
        // SQLite (unlike H2 below) is fine being read directly off the live
        // file: it's designed for a second, independent reader instance
        // alongside a writer.
        String url = "jdbc:sqlite:file:" + sqliteFile.getAbsolutePath().replace('\\', '/') + "?mode=ro";
        try (Connection conn = DriverManager.getConnection(url)) {
            // A LiteBans write mid-read shouldn't fail this query outright -
            // wait briefly for the lock instead of erroring immediately.
            try (Statement pragma = conn.createStatement()) {
                pragma.execute("PRAGMA busy_timeout = 3000");
            }
            return queryBans(conn, limit);
        }
    }

    private List<BanEntry> readH2(int limit) throws Exception {
        if (!ensureH2Driver()) return List.of();
        // Unlike SQLite, a second independent H2 instance can't open the
        // live file while LiteBans has it open (throws "Database may be
        // already in use" even read-only - see the class doc). Copy it to
        // a private, uniquely-named snapshot first and read that instead;
        // a plain filesystem copy of a live H2 file is a safe, if possibly
        // slightly-stale, valid database on its own.
        File snapshotDir = new File(plugin.getDataFolder(), "litebans-snapshot");
        snapshotDir.mkdirs();
        File snapshot = new File(snapshotDir, "snap-" + System.nanoTime() + ".mv.db");
        try {
            Files.copy(h2File.toPath(), snapshot.toPath(), StandardCopyOption.REPLACE_EXISTING);
            // H2 wants the path WITHOUT the ".mv.db" suffix - it appends its own.
            String base = snapshot.getAbsolutePath().replace('\\', '/');
            base = base.substring(0, base.length() - ".mv.db".length());
            String url = "jdbc:h2:file:" + base + ";ACCESS_MODE_DATA=r;IFEXISTS=TRUE";
            try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
                return queryBans(conn, limit);
            }
        } finally {
            //noinspection ResultOfMethodCallIgnored
            snapshot.delete();
        }
    }

    private List<BanEntry> readMysql(int limit) throws Exception {
        if (!ensureMysqlDriver()) return List.of();
        // No file-locking workaround needed here at all - this is a normal,
        // live network connection to whatever database LiteBans itself is
        // writing to, same as LiteBans' own connection pool. Always current,
        // never a stale snapshot.
        String sslMode = config.litebansMysqlUseSsl ? "TRUST" : "DISABLE";
        String url = "jdbc:mariadb://" + config.litebansMysqlHost + ":" + config.litebansMysqlPort
                + "/" + config.litebansMysqlDatabase + "?sslMode=" + sslMode + "&connectTimeout=5000";
        try (Connection conn = DriverManager.getConnection(url, config.litebansMysqlUsername, config.litebansMysqlPassword)) {
            return queryBans(conn, limit);
        }
    }

    /** Same query, same row shape - H2, SQLite and MySQL all understand this SQL. */
    private List<BanEntry> queryBans(Connection conn, int limit) throws Exception {
        List<BanEntry> results = new ArrayList<>();
        String sql = "SELECT uuid, reason, banned_by_name, time, until FROM " + config.litebansTablePrefix
                + "bans WHERE active = 1 AND (until = -1 OR until > ?) ORDER BY time DESC LIMIT ?";
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
