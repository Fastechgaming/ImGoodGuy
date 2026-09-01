package com.angkorsmp.angkorstore.commands;

import com.angkorsmp.angkorstore.AngkorStorePlugin;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;

import java.util.List;

public final class AngkorStoreCommand implements CommandExecutor, TabCompleter {

    private static final List<String> SUBCOMMANDS = List.of("reload", "status", "test");

    private final AngkorStorePlugin plugin;

    public AngkorStoreCommand(AngkorStorePlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        String sub = args.length > 0 ? args[0].toLowerCase() : "status";
        switch (sub) {
            case "reload" -> {
                plugin.boot();
                sender.sendMessage(ChatColor.YELLOW + "[AngkorStore] Config reloaded.");
            }
            case "test" -> runTest(sender);
            default -> runStatus(sender);
        }
        return true;
    }

    private void runStatus(CommandSender sender) {
        var config = plugin.config();
        sender.sendMessage(ChatColor.GOLD + "=== AngkorStore status ===");
        sender.sendMessage(status("API server", plugin.apiRunning(), plugin.apiRunning()
                ? "listening on " + config.bind + ":" + config.port
                : "not running - see console for why"));
        sender.sendMessage(status("Vault economy", plugin.vaultHook().available(),
                plugin.vaultHook().available() ? plugin.vaultHook().providerName() : "no economy plugin registered"));
        sender.sendMessage(status("LuckPerms", plugin.luckPermsHook().available(), null));
        sender.sendMessage(status("LiteBans", plugin.liteBansHook().available(), plugin.liteBansHook().available() ? null
                : ("mysql".equalsIgnoreCase(config.litebansStorageType)
                        ? "could not connect - see config.yml litebans.mysql.*"
                        : "database not found - see config.yml litebans.database-path")));
        sender.sendMessage(ChatColor.GRAY + "Pending deliveries queued: "
                + ChatColor.WHITE + plugin.pendingDeliveries().size());
        sender.sendMessage(ChatColor.GRAY + "Rank ladder: " + ChatColor.WHITE
                + config.ladder.stream().map(r -> r.id()).reduce((a, b) -> a + ", " + b).orElse("(empty)"));
    }

    private void runTest(CommandSender sender) {
        sender.sendMessage(ChatColor.GOLD + "=== AngkorStore self-test ===");
        sender.sendMessage(status("HTTP server bound", plugin.apiRunning(), null));
        sender.sendMessage(status("Economy read", plugin.vaultHook().available(), null));
        sender.sendMessage(status("Rank read (LuckPerms)", plugin.luckPermsHook().available(), null));
        sender.sendMessage(status("Ban list read (LiteBans)", plugin.liteBansHook().available(), null));
        if (plugin.config().secret.isBlank() || "CHANGE-ME".equals(plugin.config().secret)) {
            sender.sendMessage(ChatColor.RED + "api.secret is still the default - the website cannot be trusted until you change it.");
        }
    }

    private String status(String label, boolean ok, String detail) {
        String mark = ok ? ChatColor.GREEN + "✓" : ChatColor.RED + "✗";
        return mark + ChatColor.GRAY + " " + label + (detail != null ? ChatColor.DARK_GRAY + " (" + detail + ")" : "");
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1) return SUBCOMMANDS;
        return List.of();
    }
}
