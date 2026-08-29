package com.angkorsmp.angkorstore.player;

import com.angkorsmp.angkorstore.config.PluginConfig;
import com.angkorsmp.angkorstore.util.MainThread;
import org.bukkit.OfflinePlayer;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Pattern;

/**
 * Name normalisation and player resolution.
 *
 * Bedrock players reach this Java server through Floodgate, which prefixes
 * their gamertag and turns spaces into underscores. The website already
 * normalises names with this exact rule before it ever calls the plugin, so
 * this must agree with it character for character or coins land on the
 * wrong account. Ported straight from the website's normalizeServerName().
 */
public final class PlayerLookup {

    private static final Pattern JAVA_NAME = Pattern.compile("^[A-Za-z0-9_]{2,16}$");
    private static final Pattern BEDROCK_BODY = Pattern.compile("^[A-Za-z0-9_]{2,20}$");

    private final JavaPlugin plugin;
    private final String bedrockPrefix;

    public PlayerLookup(JavaPlugin plugin, PluginConfig config) {
        this.plugin = plugin;
        this.bedrockPrefix = config.bedrockPrefix;
    }

    public String normalize(String rawName, String edition) {
        String trimmed = rawName == null ? "" : rawName.trim();
        if (!"bedrock".equals(edition)) return trimmed;
        String withoutPrefix = trimmed.replaceFirst("^" + Pattern.quote(bedrockPrefix) + "+", "");
        String underscored = withoutPrefix.replaceAll("\\s+", "_");
        return underscored.isEmpty() ? "" : bedrockPrefix + underscored;
    }

    public boolean isValid(String normalized, String edition) {
        if ("bedrock".equals(edition)) {
            if (!normalized.startsWith(bedrockPrefix)) return false;
            return BEDROCK_BODY.matcher(normalized.substring(bedrockPrefix.length())).matches();
        }
        return JAVA_NAME.matcher(normalized).matches();
    }

    /** Non-blocking: resolves from the server's own local player cache only, never Mojang. */
    public CompletableFuture<Optional<OfflinePlayer>> resolve(String normalizedName) {
        return MainThread.supply(plugin, () -> {
            OfflinePlayer player = plugin.getServer().getOfflinePlayerIfCached(normalizedName);
            return Optional.ofNullable(player);
        });
    }

    public CompletableFuture<Optional<OfflinePlayer>> resolveByUuid(UUID uuid) {
        return MainThread.supply(plugin, () -> {
            OfflinePlayer player = plugin.getServer().getOfflinePlayer(uuid);
            return player.hasPlayedBefore() ? Optional.of(player) : Optional.<OfflinePlayer>empty();
        });
    }
}
